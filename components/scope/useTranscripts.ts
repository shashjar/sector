"use client";

import { useEffect, useRef, useState } from "react";

import type { Transmission } from "./useSegmenter";

/**
 * How many transcriptions to run at once.
 *
 * A busy tower can produce three transmissions in ten seconds, and firing every
 * request the instant a clip lands would put them in a race that finishes out
 * of order. Two at a time keeps the panel filling in roughly the order things
 * were said while still overlapping the network wait.
 */
const CONCURRENCY = 2;

export type TranscriptStatus = "pending" | "done" | "failed";

export interface TranscriptEntry {
  status: TranscriptStatus;
  text?: string;
  /** Shown verbatim on failure — a misconfiguration should be visible, not swallowed. */
  error?: string;
}

/**
 * Transcribe each transmission exactly once.
 *
 * Keyed by transmission id rather than held on the transmission itself, so the
 * segmenter stays unaware that transcription exists. It captures audio; this
 * turns audio into text; the next layer turns text into meaning. Each can fail
 * without taking the others down — a broken API key still leaves you with a
 * scope full of traffic and clips you can replay.
 */
export function useTranscripts(
  transmissions: Transmission[],
): Map<string, TranscriptEntry> {
  const [entries, setEntries] = useState<Map<string, TranscriptEntry>>(new Map());
  /** Ids already dispatched. Prevents a re-render from re-requesting. */
  const seen = useRef(new Set<string>());
  const queue = useRef<Transmission[]>([]);
  const active = useRef(0);

  useEffect(() => {
    const pump = () => {
      while (active.current < CONCURRENCY && queue.current.length > 0) {
        const transmission = queue.current.shift();
        if (!transmission) break;
        active.current += 1;

        void (async () => {
          try {
            // The clip is already in memory behind its object URL; reading it
            // back is cheaper than holding a second reference to every blob.
            const blob = await (await fetch(transmission.audioUrl)).blob();
            const response = await fetch("/api/transcribe", {
              method: "POST",
              headers: { "content-type": "audio/wav" },
              body: blob,
            });
            const payload = (await response.json()) as {
              text?: string;
              error?: string;
            };

            setEntries((previous) => {
              const next = new Map(previous);
              next.set(
                transmission.id,
                response.ok && payload.text !== undefined
                  ? { status: "done", text: payload.text }
                  : { status: "failed", error: payload.error ?? "transcription failed" },
              );
              return next;
            });
          } catch {
            setEntries((previous) => {
              const next = new Map(previous);
              next.set(transmission.id, {
                status: "failed",
                error: "could not reach the transcription service",
              });
              return next;
            });
          } finally {
            active.current -= 1;
            pump();
          }
        })();
      }
    };

    const fresh = transmissions.filter((t) => !seen.current.has(t.id));
    if (fresh.length === 0) return;

    for (const transmission of fresh) seen.current.add(transmission.id);
    queue.current.push(...fresh);
    setEntries((previous) => {
      const next = new Map(previous);
      for (const transmission of fresh) {
        next.set(transmission.id, { status: "pending" });
      }
      return next;
    });
    pump();
  }, [transmissions]);

  return entries;
}
