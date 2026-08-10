"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { encodeWav } from "@/lib/wav";

/** How many transmissions to keep. Older clips are revoked, not just dropped. */
const MAX_TRANSMISSIONS = 60;

export interface Transmission {
  id: string;
  /** When the transmission ended, which is when we learned about it. */
  receivedAt: number;
  durationSec: number;
  /** Object URL for replay. Revoked when the clip falls off the end. */
  audioUrl: string;
  /** Feed this came from, so a retune does not mix two fields together. */
  mount: string;
  /** Why capture stopped — a stuck mic reads differently from a normal end. */
  reason: "silence" | "max-length";
}

export interface SegmenterState {
  transmissions: Transmission[];
  /** Smoothed level, 0 to 1, for the meter. */
  level: number;
  /** True while a transmission is in progress. */
  capturing: boolean;
  /** Set when the audio graph could not be built at all. */
  error: string | null;
  clear: () => void;
}

interface WorkletMessage {
  type: "transmission" | "level" | "open";
  samples?: Float32Array;
  sampleRate?: number;
  durationSec?: number;
  reason?: "silence" | "max-length";
  value?: number;
  open?: boolean;
}

/**
 * Split the tuned feed into individual transmissions.
 *
 * This runs in the browser, on the audio already playing, rather than on the
 * server against a tee'd copy. The server-side version needs a process that
 * outlives a serverless function, which is a real architecture and not one that
 * fits here. The cost of doing it client-side is that transcription only
 * happens while someone is listening, and two listeners duplicate the work —
 * both of which are exactly the problems shared server-side ingest solves, and
 * neither of which a single listener has.
 */
export function useSegmenter(
  audio: HTMLAudioElement | null,
  mount: string | null,
): SegmenterState {
  const [transmissions, setTransmissions] = useState<Transmission[]>([]);
  const [level, setLevel] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contextRef = useRef<AudioContext | null>(null);
  const urlsRef = useRef<string[]>([]);
  const counter = useRef(0);

  const clear = useCallback(() => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
    setTransmissions([]);
  }, []);

  useEffect(() => {
    if (!audio || !mount) return;

    let cancelled = false;
    let context: AudioContext | null = null;
    let node: AudioWorkletNode | null = null;

    const start = async () => {
      try {
        context = new AudioContext();
        contextRef.current = context;
        await context.audioWorklet.addModule("/worklets/segmenter.js");
        if (cancelled) return;

        // A media element routed into Web Audio no longer reaches the speakers
        // on its own, so the graph must connect through to the destination or
        // tuning goes silent — a failure that looks like a broken feed.
        const source = context.createMediaElementSource(audio);
        node = new AudioWorkletNode(context, "segmenter");
        source.connect(node);
        node.connect(context.destination);

        node.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
          const message = event.data;

          if (message.type === "level") {
            setLevel(Math.min(1, (message.value ?? 0) * 12));
            setCapturing(Boolean(message.open));
            return;
          }

          if (message.type === "open") {
            setCapturing(true);
            return;
          }

          if (message.type !== "transmission" || !message.samples) return;

          const url = URL.createObjectURL(
            encodeWav(message.samples, message.sampleRate ?? context!.sampleRate),
          );
          urlsRef.current.push(url);
          counter.current += 1;

          setTransmissions((previous) => {
            // Appended, so the list reads in the order things were said —
            // oldest at the top, newest arriving at the bottom, the way a
            // conversation does.
            const next = [
              ...previous,
              {
                id: `${mount}-${counter.current}`,
                receivedAt: Date.now(),
                durationSec: message.durationSec ?? 0,
                audioUrl: url,
                mount,
                reason: message.reason ?? "silence",
              },
            ];
            // Revoke what falls off the front. Object URLs hold their blob in
            // memory until released, and an hour on a busy frequency is
            // hundreds of clips.
            const overflow = Math.max(0, next.length - MAX_TRANSMISSIONS);
            for (const dropped of next.slice(0, overflow)) {
              URL.revokeObjectURL(dropped.audioUrl);
              urlsRef.current = urlsRef.current.filter((u) => u !== dropped.audioUrl);
            }
            return next.slice(overflow);
          });
        };

        // Browsers start a context suspended unless it was created inside a
        // gesture. Tuning is a click, but a reconnect is not.
        if (context.state === "suspended") await context.resume();
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "audio graph unavailable");
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      node?.port.close();
      node?.disconnect();
      void context?.close();
      contextRef.current = null;
      setCapturing(false);
      setLevel(0);
    };
  }, [audio, mount]);

  useEffect(() => {
    const urls = urlsRef;
    return () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
    };
  }, []);

  return { transmissions, level, capturing, error, clear };
}
