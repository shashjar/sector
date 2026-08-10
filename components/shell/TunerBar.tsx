"use client";

import { useNow } from "@/components/useNow";
import type { TunerState } from "@/components/scope/useTuner";

/**
 * Bottom region. The transport for the tuned feed, and it persists across
 * panning so moving the scope never drops audio.
 */
export function TunerBar({ tuner }: { tuner: TunerState }) {
  return (
    <footer className="flex h-12 shrink-0 items-center justify-between gap-4 border-t border-border bg-surface px-4">
      {tuner.feed ? <Transport tuner={tuner} /> : <Idle />}

      <p className="shrink-0 text-[0.7rem] leading-tight text-text-faint">
        Audio via{" "}
        <a
          href="https://www.liveatc.net"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-dim underline decoration-border underline-offset-2 hover:text-text"
        >
          LiveATC.net
        </a>
      </p>
    </footer>
  );
}

function Idle() {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="text-[0.82rem] text-text-dim">No frequency tuned</span>
      <span className="truncate text-[0.82rem] text-text-faint">
        Airports with a receiver carry an amber dot — click one to listen
      </span>
    </div>
  );
}

const STATE_COPY: Record<
  TunerState["status"],
  { text: string; dot: string; tone: string }
> = {
  idle: { text: "Idle", dot: "bg-unknown", tone: "text-text-dim" },
  connecting: { text: "Connecting", dot: "bg-accent animate-pulse", tone: "text-text-dim" },
  live: { text: "Live", dot: "bg-vfr", tone: "text-text" },
  offline: { text: "Receiver offline", dot: "bg-ifr", tone: "text-ifr" },
  dropped: { text: "Reconnecting", dot: "bg-accent animate-pulse", tone: "text-accent" },
};

function Transport({ tuner }: { tuner: TunerState }) {
  const now = useNow(1000);
  const state = STATE_COPY[tuner.status];

  const elapsed =
    now === 0 || tuner.tunedAt === null
      ? null
      : Math.max(0, Math.floor((now - tuner.tunedAt) / 1000));

  return (
    <div className="flex min-w-0 items-center gap-3">
      <button
        type="button"
        onClick={tuner.stop}
        className="shrink-0 rounded border border-border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-text-dim hover:border-border-strong hover:text-text"
      >
        Stop
      </button>

      <span className="flex shrink-0 items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${state.dot}`}
          aria-hidden="true"
        />
        <span className={`font-mono text-[0.72rem] tracking-[0.08em] ${state.tone}`}>
          {state.text.toUpperCase()}
        </span>
      </span>

      <span className="truncate font-mono text-[0.82rem] text-text">
        {tuner.liveLabel ?? tuner.feed?.label}
      </span>

      <span className="shrink-0 text-[0.75rem] text-text-faint">
        {tuner.feed?.positions}
      </span>

      {elapsed !== null && tuner.status === "live" ? (
        <span className="tnum shrink-0 text-[0.75rem] text-text-faint">
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
        </span>
      ) : null}

      {tuner.status === "offline" ? (
        <button
          type="button"
          onClick={tuner.retry}
          className="shrink-0 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-accent hover:text-accent-bright"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
