"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Feed } from "@/lib/feeds";

export type TunerStatus =
  | "idle"
  | "connecting"
  /** Audio is arriving. */
  | "live"
  /** The receiver is listed but not currently serving. */
  | "offline"
  /** We had audio and lost it. Reconnecting. */
  | "dropped";

/**
 * Delay before reconnecting, growing with consecutive failures.
 */
const RETRY_DELAYS_MS = [750, 2000, 5000, 15000];

export interface TunerState {
  feed: Feed | null;
  status: TunerStatus;
  /** Epoch ms of when this feed was first tuned, across reconnects. */
  tunedAt: number | null;
  /** What LiveATC calls this receiver, once it has told us. */
  liveLabel: string | null;
  /**
   * The element currently playing, so the segmenter can tap it.
   *
   * State rather than a ref because it is replaced on every reconnect, and the
   * audio graph has to be rebuilt against the new one.
   */
  audioEl: HTMLAudioElement | null;
  tune: (feed: Feed) => void;
  stop: () => void;
  retry: () => void;
}

/**
 * Play a LiveATC feed.
 */
export function useTuner(): TunerState {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  /** Read inside listeners, which capture their scope at attach time. */
  const currentMount = useRef<string | null>(null);
  /**
   * Reconnecting means calling back into the function currently being defined.
   * Going through a ref keeps a retry scheduled minutes ago from invoking a
   * stale closure, rather than relying on the memo happening to be stable.
   */
  const connectRef = useRef<(feed: Feed) => void>(() => {});

  const [feed, setFeed] = useState<Feed | null>(null);
  const [status, setStatus] = useState<TunerStatus>("idle");
  const [tunedAt, setTunedAt] = useState<number | null>(null);
  const [liveLabel, setLiveLabel] = useState<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const teardown = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      // Detach the source before dropping the reference, or some browsers keep
      // the connection open and the upstream slot with it.
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
      audioRef.current = null;
    }
    setAudioEl(null);
  }, []);

  /**
   * Tell an offline receiver apart from a dropped connection.
   */
  const classifyFailure = useCallback(async (mount: string) => {
    try {
      const response = await fetch(`/api/stream/${mount}`, { method: "GET" });
      // Read nothing; we only wanted the status line.
      void response.body?.cancel();
      return response.status === 503 ? "offline" : "dropped";
    } catch {
      return "dropped";
    }
  }, []);

  const connect = useCallback(
    (target: Feed) => {
      teardown();
      currentMount.current = target.mount;

      const audio = new Audio(`/api/stream/${target.mount}`);
      audio.hidden = true;
      audio.dataset.feed = target.mount;
      document.body.append(audio);
      audioRef.current = audio;
      setAudioEl(audio);
      setStatus("connecting");

      audio.addEventListener("playing", () => {
        attempts.current = 0;
        setStatus("live");
      });

      // Buffer starvation mid-stream. The element may recover on its own.
      audio.addEventListener("waiting", () => setStatus("connecting"));

      const handleLoss = () => {
        if (currentMount.current !== target.mount) return;
        void classifyFailure(target.mount).then((reason) => {
          if (currentMount.current !== target.mount) return;
          setStatus(reason);
          const delay =
            RETRY_DELAYS_MS[Math.min(attempts.current, RETRY_DELAYS_MS.length - 1)];
          attempts.current += 1;
          retryTimer.current = setTimeout(() => connectRef.current(target), delay);
        });
      };

      audio.addEventListener("error", handleLoss);
      audio.addEventListener("ended", handleLoss);

      void audio.play().catch(() => {
        if (currentMount.current === target.mount) setStatus("dropped");
      });
    },
    [classifyFailure, teardown],
  );

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const tune = useCallback(
    (target: Feed) => {
      attempts.current = 0;
      setFeed(target);
      setTunedAt(Date.now());
      setLiveLabel(null);
      connect(target);

      void fetch(`/api/stream/${target.mount}`)
        .then((response) => {
          void response.body?.cancel();
          const label = response.headers.get("x-feed-label");
          if (label && currentMount.current === target.mount) setLiveLabel(label);
        })
        .catch(() => {});
    },
    [connect],
  );

  const stop = useCallback(() => {
    currentMount.current = null;
    attempts.current = 0;
    teardown();
    setFeed(null);
    setStatus("idle");
    setTunedAt(null);
    setLiveLabel(null);
  }, [teardown]);

  const retry = useCallback(() => {
    if (!feed) return;
    attempts.current = 0;
    connect(feed);
  }, [connect, feed]);

  useEffect(() => teardown, [teardown]);

  return { feed, status, tunedAt, liveLabel, audioEl, tune, stop, retry };
}
