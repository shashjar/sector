"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { SegmenterState, Transmission } from "@/components/scope/useSegmenter";
import type { TunerState } from "@/components/scope/useTuner";
import { useNow } from "@/components/useNow";

/** Distance from the bottom still counted as "following the feed". */
const STICK_THRESHOLD_PX = 48;

/**
 * Right region. One card per transmission, oldest at the top.
 *
 * Cards rather than a scrolling transcript because a transmission is the unit
 * everything downstream attaches to: the aircraft it was addressed to, the
 * instruction it carried, the eight seconds you want to hear again. A wall of
 * text has nowhere to hang any of that.
 */
export function TranscriptPanel({
  tuner,
  segmenter,
}: {
  tuner: TunerState;
  segmenter: SegmenterState;
}) {
  const { transmissions, level, capturing, error } = segmenter;

  /**
   * One element for the whole list rather than one per card.
   *
   * That is what makes playback exclusive: starting a clip necessarily stops
   * whichever was playing, because there is only ever one thing to stop. Two
   * transmissions talking over each other is the one thing this panel exists
   * to prevent.
   */
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const toggle = useCallback(
    (transmission: Transmission) => {
      const player = playerRef.current;
      if (!player) return;

      if (playingId === transmission.id) {
        player.pause();
        setPlayingId(null);
        return;
      }

      player.src = transmission.audioUrl;
      player.currentTime = 0;
      void player.play().then(
        () => setPlayingId(transmission.id),
        () => setPlayingId(null),
      );
    },
    [playingId],
  );

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const clear = () => setPlayingId(null);
    player.addEventListener("ended", clear);
    return () => player.removeEventListener("ended", clear);
  }, []);

  const listRef = useRef<HTMLOListElement | null>(null);
  /**
   * Whether to follow new arrivals.
   *
   * True while the user is at the bottom. Scrolling up to re-read something
   * turns it off, so a new transmission never yanks the view away mid-sentence
   * — and returning to the bottom turns it back on.
   */
  const stick = useRef(true);

  const onScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
    stick.current = distance <= STICK_THRESHOLD_PX;
  }, []);

  // Layout effect so the scroll lands in the same frame the card appears in,
  // rather than showing the old position for a beat first.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !stick.current) return;
    list.scrollTop = list.scrollHeight;
  }, [transmissions.length]);

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <span className="label">Transmissions</span>
        {tuner.feed ? <LevelMeter level={level} capturing={capturing} /> : null}
      </div>

      {!tuner.feed ? (
        <Empty
          title="Nothing tuned"
          body="Pick a feed from an airport on the scope. Transmissions appear here as they happen, split out one at a time."
        />
      ) : error ? (
        <Empty
          title="Cannot process audio"
          body={`The browser refused to build the audio graph: ${error}. Playback still works; splitting does not.`}
        />
      ) : transmissions.length === 0 ? (
        <Empty
          title="Listening"
          body="Nothing has been said yet. A quiet frequency is normal — most of an hour on tower is silence."
        />
      ) : (
        <ol
          ref={listRef}
          onScroll={onScroll}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          {transmissions.map((transmission) => (
            <TransmissionCard
              key={transmission.id}
              transmission={transmission}
              playing={playingId === transmission.id}
              onToggle={toggle}
            />
          ))}
        </ol>
      )}

      <audio ref={playerRef} hidden />
    </aside>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-[0.9rem] text-text-dim">{title}</p>
      <p className="text-[0.82rem] leading-relaxed text-text-faint">{body}</p>
    </div>
  );
}

/**
 * A live level meter.
 *
 * Present because "live" and "silent" are indistinguishable otherwise: a tuned
 * frequency with nobody talking looks exactly like a broken one. The meter is
 * the difference between waiting and wondering.
 */
function LevelMeter({ level, capturing }: { level: number; capturing: boolean }) {
  return (
    <span className="flex items-center gap-1.5" title={capturing ? "Receiving" : "Quiet"}>
      <span className="flex h-3 w-16 items-end overflow-hidden rounded-sm bg-surface-2">
        <span
          className={`h-full transition-[width] duration-100 ${capturing ? "bg-accent" : "bg-border-strong"}`}
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </span>
    </span>
  );
}

function TransmissionCard({
  transmission,
  playing,
  onToggle,
}: {
  transmission: Transmission;
  playing: boolean;
  onToggle: (transmission: Transmission) => void;
}) {
  // Ticks every second. Every card shares one clock, so this costs one timer
  // for the whole list rather than one each.
  const now = useNow(1000);
  const ageSec =
    now === 0 ? 0 : Math.max(0, Math.round((now - transmission.receivedAt) / 1000));

  return (
    <li className="border-b border-border px-4 py-2.5 hover:bg-surface-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onToggle(transmission)}
          aria-pressed={playing}
          className={`flex items-center gap-2 rounded border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.08em] transition-colors ${
            playing
              ? "border-accent bg-accent-wash text-accent"
              : "border-border text-text-dim hover:border-border-strong hover:text-text"
          }`}
        >
          <span aria-hidden="true">{playing ? "■" : "▶"}</span>
          {playing ? "Stop" : "Replay"}
        </button>

        <span className="tnum shrink-0 font-mono text-[0.72rem] text-text-dim">
          {transmission.durationSec.toFixed(1)}s
        </span>

        <span className="tnum shrink-0 text-[0.72rem] text-text-faint">
          {now === 0 ? "" : formatAge(ageSec)}
        </span>
      </div>

      {transmission.reason === "max-length" ? (
        <p className="mt-1 text-[0.72rem] text-text-faint">
          Cut at the length limit — a stuck mic, or an unusually long exchange.
        </p>
      ) : null}

      {/* Transcription lands next; until then the clip is the content. */}
      <p className="mt-1.5 text-[0.78rem] italic leading-snug text-text-faint">
        Not yet transcribed
      </p>
    </li>
  );
}

/** Seconds while it still reads as recent, then minutes. */
function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
