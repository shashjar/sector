"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { ErrorEvent } from "maplibre-gl";
import { useCallback, useMemo, useRef, useState } from "react";
import Map, {
  AttributionControl,
  NavigationControl,
  ScaleControl,
} from "react-map-gl/maplibre";

import {
  BASEMAPS,
  buildStyle,
  DEFAULT_BASEMAP,
  type BasemapId,
} from "@/lib/basemaps";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/constants";

import { BasemapSwitcher } from "./BasemapSwitcher";

/**
 * Number of failed basemap tiles before we tell the user the ground is
 * missing rather than letting them wonder.
 *
 * A single failure is a flaky request and self-corrects on retry; a viewport
 * genuinely outside coverage fails every tile it asks for, which at any
 * reasonable window size is a lot more than four.
 */
const COVERAGE_GAP_THRESHOLD = 4;

export function Scope() {
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

  /**
   * MapLibre only logs errors to the console when nothing is listening, so
   * handling them here serves two purposes: it drives the coverage notice, and
   * it keeps a pan outside chart coverage from filling the console with 404s.
   */
  const handleError = useCallback((event: ErrorEvent) => {
    // MapLibre copies the failing source onto the event at runtime but does
    // not declare it, so narrow rather than assume every error is a tile.
    const { sourceId } = event as ErrorEvent & { sourceId?: string };
    if (sourceId && sourceId !== "basemap") return;
    tileFailures.current += 1;
    if (tileFailures.current >= COVERAGE_GAP_THRESHOLD) setCoverageGap(true);
  }, []);

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
        onError={handleError}
        onMoveStart={resetCoverage}
        reuseMaps
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="bottom-right" showCompass={false} />
        <ScaleControl position="bottom-left" unit="nautical" />
        <AttributionControl position="bottom-right" compact />
      </Map>

      {/* Controls float over the map; the wrapper must not eat map gestures. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto">
          {coverageGap && basemap.tiles ? (
            <div className="max-w-xs rounded border border-border-strong bg-surface/95 px-3 py-2 backdrop-blur-sm">
              <p className="text-[0.8rem] text-text">
                No {basemap.label.toLowerCase()} coverage here
              </p>
              <p className="mt-0.5 text-[0.75rem] leading-snug text-text-dim">
                {basemapId === "sectional"
                  ? "FAA charts cover the United States only."
                  : "This area has no tiles at the current zoom."}{" "}
                Showing chart ground underneath.
              </p>
              <button
                type="button"
                onClick={() => selectBasemap("chart")}
                className="mt-1.5 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-accent hover:text-accent-bright"
              >
                Switch to chart
              </button>
            </div>
          ) : null}
        </div>

        <BasemapSwitcher value={basemapId} onChange={selectBasemap} />
      </div>
    </div>
  );
}
