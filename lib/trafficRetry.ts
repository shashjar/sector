/** Retry-After can be a number of seconds or an HTTP date. */
export function retryAfterMs(value: string | null, fallbackMs: number, now = Date.now()): number {
  if (!value?.trim()) return fallbackMs;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) && delay > 0 ? delay : fallbackMs;
}
