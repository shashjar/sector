import destination from "@turf/destination";

import type { LonLat } from "./airspace";

/**
 * Advance a position along a track.
 *
 * The extrapolation is a straight line, deliberately. It is wrong for an
 * aircraft in a turn, and wrong in exactly the way the next poll corrects.
 */
export function deadReckon(
  position: LonLat,
  trackDeg: number | null,
  groundSpeedKt: number | null,
  seconds: number,
): LonLat {
  if (
    trackDeg === null ||
    groundSpeedKt === null ||
    groundSpeedKt <= 0 ||
    seconds <= 0
  ) {
    return position;
  }
  const point = destination(position, (groundSpeedKt * seconds) / 3600, trackDeg, {
    units: "nauticalmiles",
  });
  const [lon, lat] = point.geometry.coordinates;
  return [lon, lat];
}

/**
 * How long a target may go unheard before the scope stops drawing it.
 */
export const TARGET_STALE_AFTER_SEC = 30;

/**
 * Point at which a target starts fading rather than being drawn at full
 * strength, so a feed going quiet is visible before the target disappears.
 */
export const TARGET_FADE_AFTER_SEC = 12;
