"use client";

import distance from "@turf/distance";
import { useCallback, useEffect, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";
import type { MapRef } from "react-map-gl/maplibre";

import { favoredRunway, type Observation, type RunwayWind } from "@/lib/metar";

import { loadRunwayIndex } from "@/lib/runwayIndex";

import { AIRPORT_SOURCE } from "./layers";

/** Observations are hourly; polling faster than this only costs requests. */
const POLL_INTERVAL_MS = 120_000;

/**
 * Stations requested per update.
 */
const MAX_STATIONS = 80;

/**
 * When an observation stops being presented as current.
 *
 * METARs are issued hourly, usually a few minutes before the hour, so an
 * observation is routinely 55 minutes old and perfectly good. Past 75 minutes a
 * station has missed a cycle, and that is worth showing rather than hiding.
 */
export const OBSERVATION_STALE_AFTER_MS = 75 * 60 * 1000;

export type WeatherStatus = "loading" | "ok" | "unreachable";

export interface WeatherState {
  status: WeatherStatus;
  /** Keyed by ICAO identifier. */
  byIcao: Map<string, Observation>;
  /** The reporting station nearest the centre of the view, if any. */
  focused: Observation | null;
  focusedName: string | null;
  /** Which of the focused field's runways the wind favors. */
  focusedRunway: RunwayWind | null;
}

const EMPTY = new Map<string, Observation>();

/**
 * Weather for whatever the map is showing.
 *
 * Station selection comes from the airport source rather than a separate query:
 * the airports are already loaded, already have ICAO codes, and MapLibre can be
 * asked which of them are in the current view.
 */
export function useWeather(mapRef: React.RefObject<MapRef | null>, ready: boolean) {
  const [byIcao, setByIcao] = useState<Map<string, Observation>>(EMPTY);
  const [status, setStatus] = useState<WeatherStatus>("loading");
  const [focusedIcao, setFocusedIcao] = useState<string | null>(null);
  const [focusedName, setFocusedName] = useState<string | null>(null);
  const [focusedIdent, setFocusedIdent] = useState<string | null>(null);
  /**
   * ICAO to local identifier.
   */
  const [identByIcao, setIdentByIcao] = useState<Map<string, string>>(new Map());
  const inFlight = useRef<AbortController | null>(null);
  const hasData = useRef(false);


  const poll = useCallback(async () => {
    const map = mapRef.current?.getMap();
    if (!map || !map.getSource(AIRPORT_SOURCE)) return;

    const centre = map.getCenter();
    const origin: [number, number] = [centre.lng, centre.lat];

    const features = map.querySourceFeatures(AIRPORT_SOURCE);

    const seen = new Set<string>();
    const candidates: {
      icao: string;
      ident: string;
      name: string;
      distanceNm: number;
    }[] = [];
    for (const feature of features) {
      const icao = feature.properties?.icao;
      const ident = feature.properties?.ident;
      if (typeof icao !== "string" || icao === "" || seen.has(icao)) continue;
      if (typeof ident !== "string" || ident === "") continue;
      if (feature.geometry.type !== "Point") continue;
      seen.add(icao);
      candidates.push({
        icao,
        ident,
        name: typeof feature.properties?.name === "string" ? feature.properties.name : icao,
        distanceNm: distance(origin, feature.geometry.coordinates as [number, number], {
          units: "nauticalmiles",
        }),
      });
    }

    if (candidates.length === 0) {
      setFocusedIcao(null);
      setFocusedName(null);
      setFocusedIdent(null);
      return;
    }

    candidates.sort((a, b) => a.distanceNm - b.distanceNm);
    const nearest = candidates.slice(0, MAX_STATIONS);

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    try {
      const response = await fetch(
        `/api/wx?ids=${nearest.map((c) => c.icao).join(",")}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        setStatus("unreachable");
        return;
      }
      const payload = (await response.json()) as { observations: Observation[] };
      const next = new Map(payload.observations.map((o) => [o.icao, o]));
      hasData.current = next.size > 0;
      setByIcao(next);
      setIdentByIcao(new Map(nearest.map((c) => [c.icao, c.ident])));
      setStatus("ok");

      const reporting = nearest.find((candidate) => next.has(candidate.icao));
      setFocusedIcao(reporting?.icao ?? null);
      setFocusedName(reporting?.name ?? null);
      setFocusedIdent(reporting?.ident ?? null);
    } catch (error) {
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

    /**
     * Retry once the airport data has actually tiled.
     */
    const onSourceData = (event: maplibregl.MapSourceDataEvent) => {
      if (!event.isSourceLoaded || event.sourceId !== AIRPORT_SOURCE) return;
      if (hasData.current) return;
      void poll();
    };
    map.on("sourcedata", onSourceData);

    return () => {
      clearInterval(interval);
      map.off("moveend", poll);
      map.off("sourcedata", onSourceData);
      inFlight.current?.abort();
    };
  }, [mapRef, poll, ready]);

  /**
   * Push categories onto the airport features as feature state.
   */
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !ready || !map.getSource(AIRPORT_SOURCE)) return;

    for (const [icao, observation] of byIcao) {
      const ident = identByIcao.get(icao);
      if (!ident) continue;
      map.setFeatureState(
        { source: AIRPORT_SOURCE, id: ident },
        { category: observation.category },
      );
    }
  }, [byIcao, identByIcao, mapRef, ready]);

  const focused = focusedIcao ? (byIcao.get(focusedIcao) ?? null) : null;

  /**
   * Which runway the wind favors at the focused field.
   */
  const [resolvedRunway, setResolvedRunway] = useState<{
    ident: string;
    wind: RunwayWind | null;
  } | null>(null);

  useEffect(() => {
    if (!focused || !focusedIdent) return;
    let current = true;
    void loadRunwayIndex().then((index) => {
      if (!current) return;
      setResolvedRunway({
        ident: focusedIdent,
        wind: favoredRunway(
          focused.windDirDeg,
          focused.windSpeedKt,
          index.get(focusedIdent) ?? [],
        ),
      });
    });
    return () => {
      current = false;
    };
  }, [focused, focusedIdent]);

  const focusedRunway =
    resolvedRunway && resolvedRunway.ident === focusedIdent
      ? resolvedRunway.wind
      : null;

  return {
    status,
    byIcao,
    focused,
    focusedName,
    focusedRunway,
  } satisfies WeatherState;
}
