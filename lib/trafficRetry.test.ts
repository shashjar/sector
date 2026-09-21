import { describe, expect, it } from "vitest";
import { retryAfterMs } from "./trafficRetry";

describe("traffic Retry-After", () => {
  const now = Date.parse("2026-09-12T18:00:00Z");
  it("accepts seconds and HTTP dates", () => {
    expect(retryAfterMs("45", 30_000, now)).toBe(45_000);
    expect(retryAfterMs("Sat, 12 Sep 2026 18:00:45 GMT", 30_000, now)).toBe(45_000);
  });
  it.each([null, "", " ", "invalid", "0", "-1", "Sat, 12 Sep 2026 17:00:00 GMT"])(
    "uses backoff for missing, invalid or expired values: %s", (value) => {
      expect(retryAfterMs(value, 30_000, now)).toBe(30_000);
    },
  );
});
