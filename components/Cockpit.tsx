"use client";

import distance from "@turf/distance";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";

import { Scope } from "@/components/scope/Scope";
import { useSegmenter } from "@/components/scope/useSegmenter";
import { useTraffic } from "@/components/scope/useTraffic";
import { useTranscripts } from "@/components/scope/useTranscripts";
import { useTuner } from "@/components/scope/useTuner";
import { useWeather } from "@/components/scope/useWeather";
import {
  AirportPicker,
  type SelectedAirport,
} from "@/components/shell/AirportPicker";
import { TranscriptPanel } from "@/components/shell/TranscriptPanel";
import { TunerBar } from "@/components/shell/TunerBar";
import { WeatherBar } from "@/components/shell/WeatherBar";
import { loadAirportPositions } from "@/lib/airportIndex";
import type { Frequency } from "@/lib/airspace";
import {
  buildCandidateSet,
  runwayCandidates,
  type CandidateSet,
} from "@/lib/candidates";
import { isAirbandFrequency, type Feed } from "@/lib/feeds";
import { loadRunwayIndex } from "@/lib/runwayIndex";

/**
 * Published frequencies, loaded once and shared.
 *
 * Needed both for the airport panel and for the candidate set, so it is worth
 * caching across both rather than fetching per use.
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
 * State lives here rather than inside the scope because the regions around it
 * are views onto the same viewport — and because the transcript needs the
 * traffic picture. Which aircraft are actually in the air is what turns a
 * garbled transcript into a named target, so the two cannot live apart.
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
  /**
   * Whether arriving clips get transcribed.
   *
   * On by default — it is the point of the app. Off is for leaving a frequency
   * running in the background, where every transmission would otherwise cost
   * two model calls to tell you about an aircraft you are not watching.
   */
  const [transcribing, setTranscribing] = useState(true);

  const traffic = useTraffic(mapRef, mapReady);
  const weather = useWeather(mapRef, mapReady);
  const tuner = useTuner();
  const segmenter = useSegmenter(tuner.audioEl, tuner.feed?.mount ?? null);

  /**
   * Everything about the tuned field the grounding step needs.
   *
   * A ref rather than state because it is read at the instant a clip arrives,
   * not rendered — and re-rendering the cockpit every time an aircraft moves
   * would be absurd.
   */
  const tunedField = useRef<{
    ident: string;
    runways: { ident: string; headingTrue: number }[];
    frequencies: Frequency[];
    position: [number, number] | null;
  } | null>(null);

  const feedAirport = tuner.feed?.airport ?? null;

  useEffect(() => {
    if (!feedAirport) {
      tunedField.current = null;
      return;
    }
    let current = true;
    void Promise.all([
      loadRunwayIndex(),
      loadFrequencies(),
      loadAirportPositions(),
    ]).then(([runways, allFrequencies, positions]) => {
      if (!current) return;
      tunedField.current = {
        ident: feedAirport,
        runways: runways.get(feedAirport) ?? [],
        // Anything outside the civil VHF band cannot be what is being spoken.
        frequencies: (allFrequencies[feedAirport] ?? []).filter((frequency) =>
          isAirbandFrequency(frequency.mhz),
        ),
        position: positions.get(feedAirport) ?? null,
      };
    });
    return () => {
      current = false;
    };
  }, [feedAirport]);

  /**
   * Snapshot who is on frequency, right now.
   *
   * Distance is measured from the tuned field, not the map centre: the
   * controller is at the airport, and the aircraft they are talking to are the
   * ones near it — not the ones the user happens to be looking at.
   */
  const getCandidates = useCallback((): CandidateSet | null => {
    const field = tunedField.current;
    if (!field) return null;

    const distances = new Map<string, number>();
    if (field.position) {
      for (const aircraft of traffic.aircraft) {
        distances.set(
          aircraft.id,
          distance(field.position, [aircraft.lon, aircraft.lat], {
            units: "nauticalmiles",
          }),
        );
      }
    }

    return buildCandidateSet({
      aircraft: traffic.aircraft,
      distanceNm: field.position ? distances : undefined,
      runways: runwayCandidates(field.runways),
      airport: field.ident,
      facility: tuner.feed?.label ?? null,
      frequencies: field.frequencies.map((frequency) => ({
        role: frequency.description,
        mhz: frequency.mhz,
      })),
    });
  }, [traffic.aircraft, tuner.feed]);

  const transcripts = useTranscripts(segmenter.transmissions, getCandidates, transcribing);

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
      // where the transmissions point.
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
            onReady={setMapReady}
            onSelectAirport={setSelected}
            traffic={traffic}
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

        <TranscriptPanel
          tuner={tuner}
          segmenter={segmenter}
          transcripts={transcripts}
          transcribing={transcribing}
          onTranscribingChange={setTranscribing}
        />
      </div>

      <TunerBar tuner={tuner} />
    </div>
  );
}
