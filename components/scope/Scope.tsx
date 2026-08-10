"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { ErrorEvent, Map as MapLibreMap } from "maplibre-gl";
import type { MapLayerMouseEvent } from "react-map-gl/maplibre";
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
  AIRPORT_LAYER,
  AIRPORT_SOURCE,
  airportLabelLayer,
  airportRingHaloLayer,
  airportRingLayer,
  feedBadgeLayer,
  RUNWAY_SOURCE,
  runwayLayer,
  TRAFFIC_SOURCE,
  trafficLabelLayer,
  trafficLayer,
} from "./layers";
import { buildTargetIcons } from "./trafficIcon";
import type { TrafficState, TrafficStatus } from "./useTraffic";

/**
 * Number of failed basemap tiles before we tell the user the ground is
 * missing rather than letting them wonder.
 */
const COVERAGE_GAP_THRESHOLD = 4;

interface ScopeProps {
  mapRef: React.RefObject<MapRef | null>;
  onReady: (ready: boolean) => void;
  onSelectAirport: (airport: { ident: string; name: string } | null) => void;
  traffic: TrafficState;
}

export function Scope({ mapRef, onReady, onSelectAirport, traffic }: ScopeProps) {
  const [basemapId, setBasemapId] = useState<BasemapId>(DEFAULT_BASEMAP);
  const [coverageGap, setCoverageGap] = useState(false);
  const tileFailures = useRef(0);

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

  const handleError = useCallback((event: ErrorEvent) => {
    const { sourceId } = event as ErrorEvent & { sourceId?: string };

    if (sourceId === "basemap") {
      tileFailures.current += 1;
      if (tileFailures.current >= COVERAGE_GAP_THRESHOLD) setCoverageGap(true);
      return;
    }

    // Anything that is not a basemap tile is a genuine fault — unparseable
    // GeoJSON, a rejected layer, a missing glyph range.
    console.error("[scope]", sourceId ? `source "${sourceId}":` : "", event.error ?? event);
  }, []);

  /**
   * Register the target symbols with the map.
   *
   * Runs on load and again on every style change: switching basemap replaces
   * the whole style, and MapLibre discards registered images along with it. A
   * symbol layer whose icon has gone missing renders nothing.
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

  /**
   * Selecting an airport.
   */
  const handleClick = useCallback(
    (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const ident = feature?.properties?.ident;
      if (typeof ident !== "string") {
        onSelectAirport(null);
        return;
      }
      const name = feature?.properties?.name;
      onSelectAirport({ ident, name: typeof name === "string" ? name : ident });
    },
    [onSelectAirport],
  );

  return (
    <div className="relative h-full w-full">
      <Map
        initialViewState={{
          longitude: DEFAULT_CENTER.lon,
          latitude: DEFAULT_CENTER.lat,
          zoom: DEFAULT_ZOOM,
        }}
        mapStyle={style}
        attributionControl={false}
        ref={mapRef}
        onError={handleError}
        onMoveStart={resetCoverage}
        onLoad={registerIcons}
        interactiveLayerIds={[AIRPORT_LAYER]}
        onClick={handleClick}
        cursor="auto"
        onStyleData={registerIcons}
        style={{ width: "100%", height: "100%" }}
      >
        {/*
          Runways are suppressed on the sectional, which already draws them.
        */}
        <Source id={RUNWAY_SOURCE} type="geojson" data="/data/runways.geojson">
          <Layer {...runwayLayer(!basemap.drawsOwnRunways)} />
        </Source>

        <Source
          id={AIRPORT_SOURCE}
          type="geojson"
          data="/data/airports.geojson"
          promoteId="ident"
        >
          <Layer {...airportRingHaloLayer} />
          <Layer {...airportRingLayer} />
          <Layer {...airportLabelLayer} />
          <Layer {...feedBadgeLayer} />
        </Source>

        <Source id={TRAFFIC_SOURCE} type="geojson" data={traffic.features}>
          <Layer {...trafficLayer} />
          <Layer {...trafficLabelLayer} />
        </Source>

        <NavigationControl position="bottom-right" showCompass={false} />
        <ScaleControl position="bottom-left" unit="nautical" />
        <AttributionControl position="bottom-right" compact />
      </Map>

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
 */
function TrafficStatus({
  status,
  count,
}: {
  status: TrafficStatus;
  count: number;
}) {
  if (status === "ok") {
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
