"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";

import { Scope } from "@/components/scope/Scope";
import { useSegmenter } from "@/components/scope/useSegmenter";
import { useTuner } from "@/components/scope/useTuner";
import { useWeather } from "@/components/scope/useWeather";
import {
  AirportPicker,
  type SelectedAirport,
} from "@/components/shell/AirportPicker";
import { TranscriptPanel } from "@/components/shell/TranscriptPanel";
import { TunerBar } from "@/components/shell/TunerBar";
import { WeatherBar } from "@/components/shell/WeatherBar";
import type { Frequency } from "@/lib/airspace";
import type { Feed } from "@/lib/feeds";

/**
 * Published frequencies, loaded once and shared.
 *
 * Only needed when an airport is selected, which is why it is not part of the
 * initial payload — most sessions never open the panel.
 */
let frequenciesCache: Promise<Record<string, Frequency[]>> | null = null;
function loadFrequencies(): Promise<Record<string, Frequency[]>> {
  frequenciesCache ??= fetch("/data/frequencies.json")
    .then((response) => response.json() as Promise<Record<string, Frequency[]>>)
    .catch(() => {
      frequenciesCache = null;
      return {};
    });
  return frequenciesCache;
}

/**
 * The four regions, and the map they all read from.
 *
 * The map reference lives here rather than inside the scope because the regions
 * around it are not decoration — they are views onto the same viewport. The
 * weather bar reports the field the scope is centred on; the tuner plays a feed
 * chosen by clicking the scope and keeps playing as it is panned. Sharing one
 * map is what makes "the viewport is the query" true rather than a slogan.
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
  const [selected, setSelected] = useState<SelectedAirport | null>(null);
  const [frequencies, setFrequencies] = useState<Frequency[]>([]);

  const weather = useWeather(mapRef, mapReady);
  const tuner = useTuner();
  const segmenter = useSegmenter(tuner.audioEl, tuner.feed?.mount ?? null);

  useEffect(() => {
    if (!selected) return;
    let current = true;
    void loadFrequencies().then((all) => {
      if (current) setFrequencies(all[selected.ident] ?? []);
    });
    return () => {
      current = false;
    };
  }, [selected]);

  const handleTune = useCallback(
    (feed: Feed) => {
      tuner.tune(feed);
      // The panel has done its job. Closing it returns the scope, which is
      // where the transmissions will point once transcription lands.
      setSelected(null);
    },
    [tuner],
  );

  return (
    <div className="flex h-full flex-col">
      <WeatherBar weather={weather} />

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 bg-scope-void">
          <Scope
            mapRef={mapRef}
            mapReady={mapReady}
            onReady={setMapReady}
            onSelectAirport={setSelected}
          />

          {selected ? (
            <div className="pointer-events-none absolute bottom-3 left-3 z-10">
              <AirportPicker
                airport={selected}
                frequencies={frequencies}
                tunedMount={tuner.feed?.mount ?? null}
                onTune={handleTune}
                onClose={() => setSelected(null)}
              />
            </div>
          ) : null}
        </main>

        <TranscriptPanel tuner={tuner} segmenter={segmenter} />
      </div>

      <TunerBar tuner={tuner} />
    </div>
  );
}
