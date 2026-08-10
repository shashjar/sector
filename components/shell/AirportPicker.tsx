"use client";

import { feedsFor, isAirbandFrequency, type Feed } from "@/lib/feeds";
import type { Frequency } from "@/lib/airspace";

export interface SelectedAirport {
  ident: string;
  name: string;
}

interface AirportPickerProps {
  airport: SelectedAirport;
  frequencies: Frequency[];
  tunedMount: string | null;
  onTune: (feed: Feed) => void;
  onClose: () => void;
}

/**
 * What you can hear at an airport, and what is published there.
 *
 * These are two different lists and the panel keeps them apart on purpose.
 * LiveATC publishes receivers, not frequencies — one mount often carries tower
 * and ground together — so presenting a published frequency as something you
 * can click would promise audio that does not exist for it. Feeds are tunable;
 * frequencies are reference.
 */
export function AirportPicker({
  airport,
  frequencies,
  tunedMount,
  onTune,
  onClose,
}: AirportPickerProps) {
  const feeds = feedsFor(airport.ident);
  // Anything outside the civil VHF air band cannot be tuned on an aircraft
  // radio, and the source data contains a few. See lib/feeds.ts.
  const tunable = frequencies.filter((frequency) => isAirbandFrequency(frequency.mhz));

  return (
    <section className="pointer-events-auto w-72 rounded border border-border-strong bg-surface/95 backdrop-blur-sm">
      <header className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="font-mono text-[0.82rem] text-text">{airport.ident}</p>
          <p className="truncate text-[0.75rem] text-text-dim">{airport.name}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 px-1 font-mono text-[0.8rem] text-text-faint hover:text-text"
        >
          ✕
        </button>
      </header>

      <div className="px-3 py-2">
        <p className="label mb-1.5">Live audio</p>
        {feeds.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {feeds.map((feed) => {
              const tuned = feed.mount === tunedMount;
              return (
                <li key={feed.mount}>
                  <button
                    type="button"
                    onClick={() => onTune(feed)}
                    aria-pressed={tuned}
                    className={`flex w-full items-baseline justify-between gap-2 rounded border px-2 py-1.5 text-left transition-colors ${
                      tuned
                        ? "border-accent bg-accent-wash text-accent"
                        : "border-border text-text hover:border-border-strong hover:bg-surface-2"
                    }`}
                  >
                    <span className="truncate text-[0.8rem]">{feed.label}</span>
                    <span className="shrink-0 font-mono text-[0.66rem] uppercase tracking-[0.08em] text-text-faint">
                      {tuned ? "tuned" : "listen"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[0.78rem] leading-snug text-text-dim">
            No receiver here. Feeds are volunteer-run, so most fields have none —
            look for airports carrying an amber dot.
          </p>
        )}
      </div>

      {tunable.length > 0 ? (
        <div className="border-t border-border px-3 py-2">
          <p className="label mb-1.5">Published frequencies</p>
          <ul className="flex flex-col gap-0.5">
            {tunable.map((frequency) => (
              <li
                key={`${frequency.type}-${frequency.mhz}`}
                className="flex items-baseline justify-between gap-2 text-[0.78rem]"
              >
                <span className="truncate text-text-dim">{frequency.description}</span>
                <span className="tnum shrink-0 font-mono text-text">
                  {frequency.mhz.toFixed(3)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
