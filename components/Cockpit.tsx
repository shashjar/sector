"use client";

import { useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";

import { Scope } from "@/components/scope/Scope";
import { useWeather } from "@/components/scope/useWeather";
import { TranscriptPanel } from "@/components/shell/TranscriptPanel";
import { TunerBar } from "@/components/shell/TunerBar";
import { WeatherBar } from "@/components/shell/WeatherBar";

/**
 * The four regions, and the map they all read from.
 *
 * The map reference lives here rather than inside the scope because the regions
 * around it are not decoration — they are views onto the same viewport. The
 * weather bar reports the field the scope is centred on; the tuner will offer
 * the frequencies of airports the scope is showing. Sharing one map means the
 * viewport really is the query, rather than each panel asking its own question.
 *
 *   ┌──────────────────────────────────────┐
 *   │ WeatherBar                           │
 *   ├───────────────────────┬──────────────┤
 *   │ Scope                 │ Transcript   │
 *   ├───────────────────────┴──────────────┤
 *   │ TunerBar                             │
 *   └──────────────────────────────────────┘
 */
export function Cockpit() {
  const mapRef = useRef<MapRef>(null);
  const [mapReady, setMapReady] = useState(false);

  const weather = useWeather(mapRef, mapReady);

  return (
    <div className="flex h-full flex-col">
      <WeatherBar weather={weather} />
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 bg-scope-void">
          <Scope mapRef={mapRef} mapReady={mapReady} onReady={setMapReady} />
        </main>
        <TranscriptPanel />
      </div>
      <TunerBar />
    </div>
  );
}
