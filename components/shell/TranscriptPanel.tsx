"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { SegmenterState, Transmission } from "@/components/scope/useSegmenter";
import type {
  GroundedTransmission,
  TranscriptEntry,
} from "@/components/scope/useTranscripts";
import type { TunerState } from "@/components/scope/useTuner";
import { useNow } from "@/components/useNow";

const STICK_THRESHOLD_PX = 48;

/**
 * Right region of the app. One card per transmission, oldest at the top.
 */
export function TranscriptPanel({
  tuner,
  segmenter,
  transcripts,
  transcribing,
  onTranscribingChange,
}: {
  tuner: TunerState;
  segmenter: SegmenterState;
  transcripts: Map<string, TranscriptEntry>;
  transcribing: boolean;
  onTranscribingChange: (transcribing: boolean) => void;
}) {
  const { transmissions, level, capturing, error } = segmenter;

  const playerRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const playing =
    playingId && transmissions.some((transmission) => transmission.id === playingId)
      ? playingId
      : null;

  const toggle = useCallback(
    (transmission: Transmission) => {
      const player = playerRef.current;
      if (!player) return;

      if (playing === transmission.id) {
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
    [playing],
  );

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const clear = () => setPlayingId(null);
    player.addEventListener("ended", clear);
    return () => player.removeEventListener("ended", clear);
  }, []);

  useEffect(() => {
    if (playingId && !playing) playerRef.current?.pause();
  }, [playingId, playing]);

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

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !stick.current) return;
    list.scrollTop = list.scrollHeight;
  }, [transmissions.length]);

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <span className="label truncate">Transmissions</span>
        <span className="flex shrink-0 items-center gap-2">
          <TranscribeSwitch value={transcribing} onChange={onTranscribingChange} />
          {tuner.feed ? <LevelMeter level={level} capturing={capturing} /> : null}
        </span>
      </div>

      {transmissions.length > 0 ? (
        <ol
          ref={listRef}
          onScroll={onScroll}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          {transmissions.map((transmission) => (
            <TransmissionCard
              key={transmission.id}
              transmission={transmission}
              transcript={transcripts.get(transmission.id)}
              playing={playing === transmission.id}
              onToggle={toggle}
            />
          ))}
        </ol>
      ) : !tuner.feed ? (
        <Empty
          title="Nothing tuned"
          body="Pick a feed from an airport on the scope. Transmissions appear here as they happen, split out one at a time."
        />
      ) : error ? (
        <Empty
          title="Cannot process audio"
          body={`The browser refused to build the audio graph: ${error}. Playback still works; splitting does not.`}
        />
      ) : (
        <Empty
          title="Listening"
          body="Nothing has been said yet."
        />
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

/**
 * Transcription on or off.
 */
function TranscribeSwitch({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      title={
        value
          ? "Every transmission is transcribed and matched to traffic. Click to record only."
          : "Transmissions are captured for replay only — no transcription, no model calls. Click to resume."
      }
      className="flex items-center gap-1.5 rounded px-1 py-1 transition-colors hover:bg-surface-2"
    >
      <span
        className={`relative flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors ${
          value ? "bg-accent" : "bg-border-strong"
        }`}
      >
        <span
          className={`absolute h-2.5 w-2.5 rounded-full bg-surface transition-transform ${
            value ? "translate-x-[0.75rem]" : "translate-x-[0.125rem]"
          }`}
        />
      </span>
      <span className={`label ${value ? "text-text" : "text-text-faint"}`}>
        Transcribe
      </span>
    </button>
  );
}

function TransmissionCard({
  transmission,
  transcript,
  playing,
  onToggle,
}: {
  transmission: Transmission;
  transcript: TranscriptEntry | undefined;
  playing: boolean;
  onToggle: (transmission: Transmission) => void;
}) {
  // Ticks every second. Every card shares one clock.
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

      <Transcript entry={transcript} />
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

/**
 * The transcript, or an account of why there isn't one.
 */
function Transcript({ entry }: { entry: TranscriptEntry | undefined }) {
  if (entry?.status === "skipped") return null;

  if (!entry || entry.status === "transcribing") {
    return <Note>Transcribing…</Note>;
  }

  if (entry.status === "failed") {
    return (
      <p className="mt-1.5 text-[0.75rem] leading-snug text-ifr">{entry.error}</p>
    );
  }

  if (entry.status === "grounding") {
    return <Note>Matching to traffic…</Note>;
  }

  if (!entry.raw) {
    return <Note>No speech recognised</Note>;
  }

  if (entry.error) {
    return (
      <>
        <p className="mt-1.5 text-[0.82rem] leading-snug text-text">{entry.raw}</p>
        <Note>Not matched to traffic: {entry.error}</Note>
      </>
    );
  }

  if (!entry.grounded) {
    return (
      <p className="mt-1.5 text-[0.82rem] leading-snug text-text">{entry.raw}</p>
    );
  }

  if (entry.grounded.length === 0) {
    return <Note>Not a transmission</Note>;
  }

  return (
    <div className="mt-1.5 flex flex-col gap-2">
      {entry.grounded.map((grounded, index) => (
        <GroundedCard key={index} grounded={grounded} />
      ))}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 text-[0.78rem] italic leading-snug text-text-faint">
      {children}
    </p>
  );
}

function GroundedCard({ grounded }: { grounded: GroundedTransmission }) {
  const chips = instructionChips(grounded.instructions);

  return (
    <div className="border-l-2 border-border-strong pl-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded-sm px-1.5 py-0.5 font-mono text-[0.62rem] uppercase tracking-[0.08em] ${
            grounded.speaker === "controller"
              ? "bg-accent-wash text-accent"
              : "bg-surface-2 text-text-dim"
          }`}
        >
          {grounded.speaker === "controller"
            ? "Tower"
            : grounded.speaker === "aircraft"
              ? "Aircraft"
              : "Unknown"}
        </span>

        {grounded.callsign ? (
          <span className="rounded-sm bg-accent-wash px-1.5 py-0.5 font-mono text-[0.68rem] tracking-[0.04em] text-accent-bright">
            {grounded.callsign}
          </span>
        ) : (
          <span
            className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-text-faint"
            title={
              grounded.rejectedCallsign
                ? `Heard “${grounded.rejectedCallsign}”, which is not an aircraft in range. Most likely no ADS-B Out.`
                : "No aircraft in range matched what was said."
            }
          >
            Unmatched
          </span>
        )}

        {grounded.callsign && grounded.confidence < 0.75 ? (
          <span className="tnum font-mono text-[0.62rem] text-text-faint">
            {Math.round(grounded.confidence * 100)}%
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-[0.82rem] leading-snug text-text">{grounded.corrected}</p>

      {chips.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chips.map((chip, index) => (
            <span
              key={index}
              className="tnum rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-[0.64rem] tracking-[0.04em] text-text-dim"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** What a controller actually said, reduced to the numbers worth glancing at. */
const INSTRUCTION_LABELS: Record<string, string> = {
  landing_clearance: "Cleared to land",
  takeoff_clearance: "Cleared for takeoff",
  line_up_and_wait: "Line up and wait",
  taxi: "Taxi",
  hold_short: "Hold short",
  heading: "Heading",
  altitude: "Altitude",
  speed: "Speed",
  squawk: "Squawk",
  frequency_change: "Contact",
  traffic_advisory: "Traffic",
  readback: "Readback",
  other: "",
};

function instructionChips(
  instructions: GroundedTransmission["instructions"],
): string[] {
  const chips: string[] = [];
  for (const instruction of instructions) {
    const parts: string[] = [];
    const label = INSTRUCTION_LABELS[instruction.type] ?? instruction.type;
    if (label) parts.push(label);
    if (instruction.runway) parts.push(`RWY ${instruction.runway}`);
    if (instruction.headingDeg !== null)
      parts.push(`${String(Math.round(instruction.headingDeg)).padStart(3, "0")}°`);
    if (instruction.altitudeFt !== null)
      parts.push(`${instruction.altitudeFt.toLocaleString()} ft`);
    if (instruction.speedKt !== null) parts.push(`${instruction.speedKt} kt`);
    if (instruction.squawk) parts.push(`SQ ${instruction.squawk}`);
    if (instruction.frequencyMhz !== null)
      parts.push(instruction.frequencyMhz.toFixed(3));
    if (parts.length > 0) chips.push(parts.join(" "));
  }
  return chips;
}
