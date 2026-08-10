import destination from "@turf/destination";

import type { LonLat } from "./airspace";

/**
 * Advance a position along a track.
 *
 * Traffic is polled every few seconds but the map redraws continuously. Without
 * this, targets would sit still and then jump on each poll — which reads as a
 * broken map rather than as a slow feed.
 *
 * The extrapolation is a straight line, deliberately. It is wrong for an
 * aircraft in a turn, and wrong in exactly the way the next poll corrects.
 * Modelling turn rate would look smoother while being confidently wrong for
 * longer, and an aircraft's position on a scope is not the place to prefer
 * smoothness over honesty.
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
 *
 * Receivers drop out and aircraft fly beyond coverage; both look identical from
 * here. Thirty seconds is long enough to ride out a gap in reception and short
 * enough that a target which has genuinely left does not linger as a ghost.
 */
export const TARGET_STALE_AFTER_SEC = 30;

/**
 * Point at which a target starts fading rather than being drawn at full
 * strength, so a feed going quiet is visible before the target disappears.
 */
export const TARGET_FADE_AFTER_SEC = 12;
