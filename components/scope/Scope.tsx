"use client";

/*
 * maplibre-gl is pinned to an exact 5.x in package.json. Do not float it to 6.
 *
 * react-map-gl 8.1.2 — the current release — declares `maplibre-gl >=4.0.0`,
 * which is wrong: against 6.x its <Source> and <Layer> children silently never
 * create anything and event props such as onLoad never fire. Nothing throws and
 * nothing logs. The basemap still renders, because that comes from the style
 * object passed at construction, so the map looks like it is working while
 * every layer of our own is missing.
 *
 * Diagnosed by watching the network: with 6.x the app never requested
 * airports.geojson at all. On 5.24.0 the sources, layers, and glyph ranges all
 * load. Revisit when react-map-gl declares real support for 6.
 */
import "maplibre-gl/dist/maplibre-gl.css";

import type { ErrorEvent, Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import Map, {
  AttributionControl,
  Layer,
  NavigationControl,
  ScaleControl,
  Source,
} from "react-map-gl/maplibre";

import {
  BASEMAPS,
  buildStyle,
  DEFAULT_BASEMAP,
  type BasemapId,
} from "@/lib/basemaps";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/constants";

import { BasemapSwitcher } from "./BasemapSwitcher";
import {
  AIRPORT_SOURCE,
  airportLabelLayer,
  airportRingHaloLayer,
  airportRingLayer,
  RUNWAY_SOURCE,
  runwayLayer,
  TRAFFIC_SOURCE,
  trafficLabelLayer,
  trafficLayer,
} from "./layers";
import { buildTargetIcons } from "./trafficIcon";
import { useTraffic, type TrafficStatus } from "./useTraffic";

/**
 * Number of failed basemap tiles before we tell the user the ground is
 * missing rather than letting them wonder.
 *
 * A single failure is a flaky request and self-corrects on retry; a viewport
 * genuinely outside coverage fails every tile it asks for, which at any
 * reasonable window size is a lot more than four.
 */
const COVERAGE_GAP_THRESHOLD = 4;

interface ScopeProps {
  mapRef: React.RefObject<MapRef | null>;
  mapReady: boolean;
  onReady: (ready: boolean) => void;
}

export function Scope({ mapRef, mapReady, onReady }: ScopeProps) {
  const [basemapId, setBasemapId] = useState<BasemapId>(DEFAULT_BASEMAP);
  const [coverageGap, setCoverageGap] = useState(false);
  const tileFailures = useRef(0);

  const traffic = useTraffic(mapRef, mapReady);

  const basemap = BASEMAPS[basemapId];
  const style = useMemo(() => buildStyle(basemap), [basemap]);

  const resetCoverage = useCallback(() => {
    tileFailures.current = 0;
    setCoverageGap(false);
  }, []);

  const selectBasemap = useCallback(
    (id: BasemapId) => {
      resetCoverage();
      setBasemapId(id);
    },
    [resetCoverage],
  );

  /**
   * MapLibre only logs errors to the console when nothing is listening, so
   * handling them here serves two purposes: it drives the coverage notice, and
   * it keeps a pan outside chart coverage from filling the console with 404s.
   */
  const handleError = useCallback((event: ErrorEvent) => {
    // MapLibre copies the failing source onto the event at runtime but does
    // not declare it, so narrow rather than assume every error is a tile.
    const { sourceId } = event as ErrorEvent & { sourceId?: string };

    if (sourceId === "basemap") {
      tileFailures.current += 1;
      if (tileFailures.current >= COVERAGE_GAP_THRESHOLD) setCoverageGap(true);
      return;
    }

    // Anything that is not a basemap tile is a genuine fault — unparseable
    // GeoJSON, a rejected layer, a missing glyph range. Attaching any error
    // listener stops MapLibre logging these itself, so swallowing them here
    // would make the map fail silently.
    console.error("[scope]", sourceId ? `source "${sourceId}":` : "", event.error ?? event);
  }, []);

  /**
   * Register the target symbols with the map.
   *
   * Runs on load and again on every style change: switching basemap replaces
   * the whole style, and MapLibre discards registered images along with it. A
   * symbol layer whose icon has gone missing renders nothing and says nothing.
   */
  const registerIcons = useCallback((event: { target: MapLibreMap }) => {
    const map = event.target;
    for (const icon of buildTargetIcons()) {
      if (!map.hasImage(icon.id)) {
        map.addImage(icon.id, icon.data, { pixelRatio: icon.pixelRatio });
      }
    }
    onReady(true);
  }, [onReady]);

  return (
    <div className="relative h-full w-full">
      <Map
        initialViewState={{
          longitude: DEFAULT_CENTER.lon,
          latitude: DEFAULT_CENTER.lat,
          zoom: DEFAULT_ZOOM,
        }}
        mapStyle={style}
        // Attribution is added explicitly below so it can be compact; the
        // default control renders expanded and crowds a small scope.
        attributionControl={false}
        ref={mapRef}
        onError={handleError}
        onMoveStart={resetCoverage}
        onLoad={registerIcons}
        // Switching basemap swaps the whole style, which discards registered
        // images along with it. Re-adding on styledata keeps targets drawn.
        onStyleData={registerIcons}
        style={{ width: "100%", height: "100%" }}
      >
        {/*
          Runways are suppressed on the sectional, which already draws them —
          ours would double-image on top. Airport rings stay in every mode:
          they are not a duplicate symbol, they carry state the chart cannot.
        */}
        <Source id={RUNWAY_SOURCE} type="geojson" data="/data/runways.geojson">
          <Layer {...runwayLayer(!basemap.drawsOwnRunways)} />
        </Source>

        {/* promoteId makes each airport's identifier usable as a feature id,
            which is what lets weather be applied as feature state instead of
            rewriting a megabyte of GeoJSON every time an observation lands. */}
        <Source
          id={AIRPORT_SOURCE}
          type="geojson"
          data="/data/airports.geojson"
          promoteId="ident"
        >
          <Layer {...airportRingHaloLayer} />
          <Layer {...airportRingLayer} />
          <Layer {...airportLabelLayer} />
        </Source>

        {/* Traffic sits above the static airspace: it is what moves, and what
            the eye should find first. */}
        <Source id={TRAFFIC_SOURCE} type="geojson" data={traffic.features}>
          <Layer {...trafficLayer} />
          <Layer {...trafficLabelLayer} />
        </Source>

        <NavigationControl position="bottom-right" showCompass={false} />
        <ScaleControl position="bottom-left" unit="nautical" />
        <AttributionControl position="bottom-right" compact />
      </Map>

      {/* Controls float over the map; the wrapper must not eat map gestures. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto">
          {coverageGap ? (
            <div className="max-w-xs rounded border border-border-strong bg-surface/95 px-3 py-2 backdrop-blur-sm">
              <p className="text-[0.8rem] text-text">
                No {basemap.label.toLowerCase()} coverage here
              </p>
              <p className="mt-0.5 text-[0.75rem] leading-snug text-text-dim">
                {basemapId === "sectional"
                  ? "FAA charts cover the United States only. Satellite works worldwide."
                  : "This area has no tiles at the current zoom."}
              </p>
              {basemapId !== "satellite" ? (
                <button
                  type="button"
                  onClick={() => selectBasemap("satellite")}
                  className="mt-1.5 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-accent hover:text-accent-bright"
                >
                  Switch to satellite
                </button>
              ) : null}
            </div>
          ) : null}

          <TrafficStatus status={traffic.status} count={traffic.count} />
        </div>

        <BasemapSwitcher value={basemapId} onChange={selectBasemap} />
      </div>
    </div>
  );
}

/**
 * What the traffic feed is doing, when it is doing something other than working.
 *
 * Silence is not an option for any of these. An empty scope looks identical
 * whether the airspace is quiet, the query was declined, or the feed is down —
 * and those are three completely different things to a pilot.
 */
function TrafficStatus({
  status,
  count,
}: {
  status: TrafficStatus;
  count: number;
}) {
  if (status === "ok") {
    // Needs its own ground. Bare text sits directly on a sectional and is
    // illegible over dense areas — which is exactly where the count matters.
    return (
      <p className="mt-2 inline-block rounded border border-border bg-surface/90 px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-text-dim backdrop-blur-sm">
        {count} contact{count === 1 ? "" : "s"}
      </p>
    );
  }

  const message = {
    loading: ["Acquiring traffic", "Asking the receiver network for this area."],
    empty: [
      "No aircraft in view",
      "Coverage comes from volunteer receivers, so quiet areas may simply be unheard rather than empty.",
    ],
    "too-wide": [
      "Zoomed out too far for traffic",
      "The feed serves a 250 nm radius at most. Zoom in to see contacts.",
    ],
    unreachable: [
      "Traffic feed unreachable",
      "Showing the last known picture. Retrying every few seconds.",
    ],
  }[status];

  return (
    <div className="mt-2 max-w-xs rounded border border-border-strong bg-surface/95 px-3 py-2 backdrop-blur-sm">
      <p className="text-[0.8rem] text-text">{message[0]}</p>
      <p className="mt-0.5 text-[0.75rem] leading-snug text-text-dim">{message[1]}</p>
    </div>
  );
}
