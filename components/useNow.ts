"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * A clock, as an external store.
 *
 * Anything showing an age — how old an observation is, how long since a target
 * was heard — needs the current time, and reading `Date.now()` while rendering
 * makes the output depend on when React happens to re-render rather than on
 * elapsed time.
 *
 * `useSyncExternalStore` rather than state-plus-effect because that is exactly
 * what this is: a mutable value outside React that components subscribe to. It
 * also gives a server snapshot for free, which matters — the server has no idea
 * what time it is on the client, and rendering a real timestamp during SSR
 * guarantees a hydration mismatch.
 */
function createClock(intervalMs: number) {
  let now = 0;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (timer === undefined) {
        // First subscriber: start the clock now rather than a full interval
        // from now, so ages are right on the first paint after mount.
        now = Date.now();
        timer = setInterval(() => {
          now = Date.now();
          for (const notify of listeners) notify();
        }, intervalMs);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== undefined) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
    // Cached between ticks. React requires a snapshot that changes only when
    // the store does; returning a fresh Date.now() per call would re-render
    // forever.
    getSnapshot: () => now,
  };
}

/** Returns 0 until mounted. Callers treat 0 as "not known yet". */
export function useNow(intervalMs: number): number {
  const clock = useMemo(() => createClock(intervalMs), [intervalMs]);
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, () => 0);
}
