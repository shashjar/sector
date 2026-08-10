"use client";

import distance from "@turf/distance";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";

import { MAX_QUERY_RADIUS_NM, type Aircraft } from "@/lib/adsb";
import {
  deadReckon,
  TARGET_FADE_AFTER_SEC,
  TARGET_STALE_AFTER_SEC,
} from "@/lib/aviation";

/** How often to ask the feed for a new picture. */
const POLL_INTERVAL_MS = 3000;

/**
 * How often dead-reckoned positions are recomputed.
 *
 * Not every frame. An aircraft at 200 knots covers about 1.7 screen pixels per
 * second at the default zoom, so five updates a second is already smoother than
 * the eye can resolve, and it keeps the source from being rewritten sixty times
 * a second for no visible gain.
 */
const INTERPOLATE_INTERVAL_MS = 200;

export type TrafficStatus =
  | "loading"
  | "ok"
  | "empty"
  | "too-wide"
  | "unreachable";

export interface TrafficState {
  status: TrafficStatus;
  /**
   * The raw targets behind the rendered features.
   *
   * Exposed because the grounding step needs to know who is actually in the
   * air, not just where to draw them — the callsigns here are the candidate
   * set a transcript gets matched against.
   */
  aircraft: Aircraft[];
  /** Dead-reckoned positions, ready to hand to a GeoJSON source. */
  features: GeoJSON.FeatureCollection<GeoJSON.Point>;
  count: number;
  /** Nulled until the first successful response. */
  lastUpdated: number | null;
}

const EMPTY: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  type: "FeatureCollection",
  features: [],
};

/**
 * Format a data block the way a controller's scope does: identity on the first
 * line, then altitude in hundreds of feet, vertical trend, and groundspeed.
 *
 * "130 ↑ 310" is thirteen thousand feet, climbing, three hundred and ten knots.
 */
interface DataBlock {
  /** Callsign line, then altitude — everything before the arrow. */
  primary: string;
  /** The climb/descent arrow alone, so the layer can size it separately. */
  trend: string;
  /** Groundspeed, with the space that separates it from the arrow. */
  secondary: string;
}

function dataBlock(aircraft: Aircraft): DataBlock {
  if (aircraft.onGround) {
    return { primary: `${aircraft.callsign}\nGND`, trend: "", secondary: "" };
  }

  const altitude =
    aircraft.altitudeFt !== null
      ? String(Math.round(aircraft.altitudeFt / 100)).padStart(3, "0")
      : "";
  const rate = aircraft.verticalRateFpm ?? 0;
  // Below 100 fpm an aircraft is level for display purposes; ADS-B reports
  // small nonzero rates constantly and an arrow that flickers is worse than none.
  const trend = rate > 100 ? "↑" : rate < -100 ? "↓" : "";
  const speed =
    aircraft.groundSpeedKt !== null ? String(Math.round(aircraft.groundSpeedKt)) : "";

  if (altitude === "" && trend === "" && speed === "") {
    return { primary: aircraft.callsign, trend: "", secondary: "" };
  }

  /*
   * The arrow is handed over separately so the layer can scale it on its own.
   * It is the one glyph in the block that is read as a shape rather than as a
   * value, and at label size it disappears among the digits beside it. The
   * spaces around it therefore belong to the neighbouring pieces.
   */
  return {
    primary: `${aircraft.callsign}\n${altitude}${altitude && trend ? " " : ""}`,
    trend,
    secondary: `${speed && (trend || altitude) ? " " : ""}${speed}`,
  };
}

function toFeatures(
  aircraft: Aircraft[],
  fetchedAt: number,
  now: number,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const elapsed = (now - fetchedAt) / 1000;

  return {
    type: "FeatureCollection",
    features: aircraft.flatMap((target) => {
      // Age is measured from when the receiver heard it, not when we asked, so
      // a target already stale on arrival is never drawn.
      const age = target.positionAgeSec + elapsed;
      if (age > TARGET_STALE_AFTER_SEC) return [];

      const [lon, lat] = deadReckon(
        [target.lon, target.lat],
        target.trackDeg,
        target.groundSpeedKt,
        elapsed,
      );

      return [
        {
          type: "Feature" as const,
          id: target.id,
          geometry: { type: "Point" as const, coordinates: [lon, lat] },
          properties: {
            id: target.id,
            callsign: target.callsign,
            ...dataBlock(target),
            // Stationary targets have no meaningful track; pointing them north
            // would assert a heading the aircraft is not reporting.
            track: target.trackDeg ?? 0,
            hasTrack: target.trackDeg !== null,
            onGround: target.onGround,
            // Fades toward zero as a target goes unheard, so a feed dropping out
            // is visible before the target vanishes outright.
            freshness:
              age <= TARGET_FADE_AFTER_SEC
                ? 1
                : Math.max(
                    0,
                    1 -
                      (age - TARGET_FADE_AFTER_SEC) /
                        (TARGET_STALE_AFTER_SEC - TARGET_FADE_AFTER_SEC),
                  ),
          },
        },
      ];
    }),
  };
}

/**
 * Poll live traffic for whatever the map is currently showing.
 *
 * The viewport is the query: every pan or zoom re-centres it. adsb.lol takes a
 * point and a radius rather than a bounding box, so the radius is measured to
 * the viewport's *corner* — which over-fetches along the edges on purpose, so
 * aircraft are already on screen instead of popping in as you pan toward them.
 */
export function useTraffic(mapRef: React.RefObject<MapRef | null>, ready: boolean) {
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [status, setStatus] = useState<TrafficStatus>("loading");
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  /**
   * The clock the interpolation reads.
   *
   * Held in state rather than read during render: calling Date.now() while
   * rendering makes the output depend on when React happens to re-render, which
   * is exactly the impurity that produces targets jittering on unrelated state
   * changes. Advancing it on a timer makes each frame a pure function of it.
   */
  const [now, setNow] = useState(0);
  const inFlight = useRef<AbortController | null>(null);

  const poll = useCallback(async () => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const centre = map.getCenter();
    const bounds = map.getBounds();
    const radiusNm = distance(
      [centre.lng, centre.lat],
      [bounds.getEast(), bounds.getNorth()],
      { units: "nauticalmiles" },
    );

    if (radiusNm > MAX_QUERY_RADIUS_NM) {
      // Deliberately not a silent empty result: an empty map at this zoom would
      // read as empty airspace rather than as a query we declined to make.
      setStatus("too-wide");
      setAircraft([]);
      return;
    }

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    try {
      const response = await fetch(
        `/api/traffic?lat=${centre.lat.toFixed(5)}&lon=${centre.lng.toFixed(5)}&radius=${Math.ceil(radiusNm)}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        setStatus("unreachable");
        return;
      }
      const payload = (await response.json()) as {
        aircraft: Aircraft[];
        fetchedAt: number;
      };
      setAircraft(payload.aircraft);
      setFetchedAt(payload.fetchedAt);
      setNow(Date.now());
      setStatus(payload.aircraft.length > 0 ? "ok" : "empty");
    } catch (error) {
      // An abort is us superseding our own request, not a failure. Treating it
      // as one would flash "unreachable" on every pan.
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("unreachable");
    }
  }, [mapRef]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    map.on("moveend", poll);

    return () => {
      clearInterval(interval);
      map.off("moveend", poll);
      inFlight.current?.abort();
    };
  }, [mapRef, poll, ready]);

  // Advances the clock between polls, which is what moves the targets.
  useEffect(() => {
    if (fetchedAt === null) return;
    const interval = setInterval(() => setNow(Date.now()), INTERPOLATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchedAt]);

  const features = useMemo(
    () => (fetchedAt === null ? EMPTY : toFeatures(aircraft, fetchedAt, now)),
    [aircraft, fetchedAt, now],
  );

  return {
    status,
    aircraft,
    features,
    count: features.features.length,
    lastUpdated: fetchedAt,
  } satisfies TrafficState;
}
