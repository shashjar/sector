"use client";

import { useEffect, useRef, useState } from "react";

import type { CandidateSet } from "@/lib/candidates";

import type { Transmission } from "./useSegmenter";

/**
 * How many clips to process at once.
 */
const CONCURRENCY = 2;

export type TranscriptStatus =
  | "transcribing"
  | "grounding"
  | "done"
  | "failed"
  /** Captured with transcription switched off. No request was ever made. */
  | "skipped";

/** One radio transmission, after grounding. */
export interface GroundedTransmission {
  speaker: "controller" | "aircraft" | "unknown";
  /** Guaranteed to be an aircraft that was in range, or null. */
  callsign: string | null;
  confidence: number;
  corrected: string;
  instructions: {
    type: string;
    runway: string | null;
    headingDeg: number | null;
    altitudeFt: number | null;
    speedKt: number | null;
    squawk: string | null;
    frequencyMhz: number | null;
  }[];
  /**
   * A callsign the model produced that we refused to accept.
   */
  rejectedCallsign: string | null;
}

export interface TranscriptEntry {
  status: TranscriptStatus;
  /** Raw model output, before grounding. */
  raw?: string;
  grounded?: GroundedTransmission[];
  error?: string;
}

/**
 * Turn each clip into grounded transmissions.
 *
 * Two steps, deliberately separate. Transcription is unassisted — the speech
 * model gets audio and nothing else — so the raw text is an honest baseline for
 * what the grounding step is worth. Grounding then gets that text plus the
 * aircraft actually in range and decides which one was addressed.
 *
 * The candidate set is captured at the moment the clip arrives, not when the
 * request resolves: it describes who was on frequency when the words were
 * spoken, and a set gathered ten seconds later is about a different sky.
 *
 * With `enabled` false a clip is recorded and nothing else — no transcription,
 * no grounding, no request of any kind.
 */
export function useTranscripts(
  transmissions: Transmission[],
  getCandidates: () => CandidateSet | null,
  enabled: boolean,
): Map<string, TranscriptEntry> {
  const [entries, setEntries] = useState<Map<string, TranscriptEntry>>(new Map());
  /** Ids already dispatched. Prevents a re-render from re-requesting. */
  const seen = useRef(new Set<string>());
  const queue = useRef<{ transmission: Transmission; candidates: CandidateSet | null }[]>([]);
  const active = useRef(0);
  const candidatesRef = useRef(getCandidates);

  useEffect(() => {
    candidatesRef.current = getCandidates;
  });

  useEffect(() => {
    const update = (id: string, entry: TranscriptEntry) =>
      setEntries((previous) => new Map(previous).set(id, entry));

    const pump = () => {
      while (active.current < CONCURRENCY && queue.current.length > 0) {
        const job = queue.current.shift();
        if (!job) break;
        active.current += 1;

        void (async () => {
          const { transmission, candidates } = job;
          try {
            const blob = await (await fetch(transmission.audioUrl)).blob();
            const response = await fetch("/api/transcribe", {
              method: "POST",
              headers: { "content-type": "audio/wav" },
              body: blob,
            });
            const payload = (await response.json()) as { text?: string; error?: string };

            if (!response.ok || payload.text === undefined) {
              update(transmission.id, {
                status: "failed",
                error: payload.error ?? "transcription failed",
              });
              return;
            }

            const raw = payload.text.trim();
            if (raw === "") {
              update(transmission.id, { status: "done", raw, grounded: [] });
              return;
            }

            update(transmission.id, { status: "grounding", raw });

            if (!candidates) {
              // No traffic picture means no candidate set, and without one the
              // grounding step has nothing to choose from. Show the raw text
              // rather than pretending it was verified.
              update(transmission.id, { status: "done", raw });
              return;
            }

            const grounding = await fetch("/api/ground", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ transcript: raw, candidates }),
            });
            const result = (await grounding.json()) as {
              transmissions?: GroundedTransmission[];
              error?: string;
            };

            update(
              transmission.id,
              grounding.ok && result.transmissions
                ? { status: "done", raw, grounded: result.transmissions }
                : { status: "done", raw, error: result.error ?? "grounding failed" },
            );
          } catch {
            update(transmission.id, {
              status: "failed",
              error: "could not reach the transcription service",
            });
          } finally {
            active.current -= 1;
            pump();
          }
        })();
      }
    };

    /*
     * Drop anything whose clip is gone — evicted off the end of the list, or
     * cleared by a retune.
     */
    const live = new Set(transmissions.map((transmission) => transmission.id));
    const stale = [...seen.current].filter((id) => !live.has(id));
    if (stale.length > 0) {
      for (const id of stale) seen.current.delete(id);
      queue.current = queue.current.filter((job) => live.has(job.transmission.id));
      setEntries((previous) => {
        const next = new Map<string, TranscriptEntry>();
        for (const [id, entry] of previous) {
          if (live.has(id)) next.set(id, entry);
        }
        return next;
      });
    }

    const fresh = transmissions.filter((t) => !seen.current.has(t.id));
    if (fresh.length === 0) return;

    for (const transmission of fresh) seen.current.add(transmission.id);

    if (!enabled) {
      setEntries((previous) => {
        const next = new Map(previous);
        for (const transmission of fresh) {
          next.set(transmission.id, { status: "skipped" });
        }
        return next;
      });
      return;
    }

    // Snapshot the sky now, while it still describes the moment these words
    // were spoken.
    const candidates = candidatesRef.current();
    queue.current.push(...fresh.map((transmission) => ({ transmission, candidates })));

    setEntries((previous) => {
      const next = new Map(previous);
      for (const transmission of fresh) {
        next.set(transmission.id, { status: "transcribing" });
      }
      return next;
    });
    pump();
  }, [transmissions, enabled]);

  return entries;
}
