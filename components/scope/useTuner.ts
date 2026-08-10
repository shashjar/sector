"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Feed } from "@/lib/feeds";

export type TunerStatus =
  | "idle"
  | "connecting"
  /** Audio is arriving. Note this says nothing about anyone talking. */
  | "live"
  /** The receiver is listed but not currently serving. */
  | "offline"
  /** We had audio and lost it. Reconnecting. */
  | "dropped";

/**
 * Delay before reconnecting, growing with consecutive failures.
 *
 * A feed that is genuinely down should not be hammered, but a stream cut short
 * by the platform's function limit should come back promptly — that one is
 * expected and frequent, so the first retry is fast.
 */
const RETRY_DELAYS_MS = [750, 2000, 5000, 15000];

export interface TunerState {
  feed: Feed | null;
  status: TunerStatus;
  /** Epoch ms of when this feed was first tuned, across reconnects. */
  tunedAt: number | null;
  /** What LiveATC calls this receiver, once it has told us. */
  liveLabel: string | null;
  tune: (feed: Feed) => void;
  stop: () => void;
  retry: () => void;
}

/**
 * Play a LiveATC feed, and be honest about what is happening to it.
 *
 * The audio element is created imperatively rather than rendered, because the
 * transport outlives any one component: tuning survives panning the map, and
 * reconnecting must not depend on something staying mounted.
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
  }, []);

  /**
   * Tell an offline receiver apart from a dropped connection.
   *
   * The audio element reports both as a bare "error" with no status, so the
   * only way to know is to ask the route directly. It matters: "this feed is
   * down" is a fact about the world, while "we lost the connection" is a fact
   * about us, and only one of them is worth retrying hard.
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
      // Attached rather than detached. A detached element plays perfectly well,
      // but it is invisible to devtools and to the browser's media controls,
      // which makes "is audio actually arriving" impossible to answer without
      // guessing. Hidden, so it contributes no UI of its own.
      audio.hidden = true;
      audio.dataset.feed = target.mount;
      document.body.append(audio);
      audioRef.current = audio;
      setStatus("connecting");

      audio.addEventListener("playing", () => {
        attempts.current = 0;
        setStatus("live");
      });

      // Buffer starvation mid-stream. Not a failure yet — the element recovers
      // on its own more often than not.
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
      // A stream that "ends" has not finished — it was cut, usually by the
      // serverless function reaching its limit. Same handling as an error.
      audio.addEventListener("ended", handleLoss);

      void audio.play().catch(() => {
        // Autoplay refusal. Tuning is always user-initiated so this is rare,
        // but surfacing it as dropped gives the user a retry rather than
        // silence with no explanation.
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

      // The feed's own name for itself comes back as a header, so it needs a
      // separate request. Cosmetic, and must never block audio.
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

  return { feed, status, tunedAt, liveLabel, tune, stop, retry };
}
