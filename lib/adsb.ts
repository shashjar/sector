/**
 * ADS-B traffic, normalised.
 *
 * The upstream is adsb.lol.
 */

/** What the scope actually needs to know about a target. */
export interface Aircraft {
  /** ICAO 24-bit address in hex. Stable, and the only reliable identity. */
  id: string;
  callsign: string;
  registration: string | null;
  /** ICAO type designator — C172, B738. Null for targets without a lookup. */
  type: string | null;
  lat: number;
  lon: number;
  /** Barometric altitude in feet. Null when the aircraft is on the ground. */
  altitudeFt: number | null;
  onGround: boolean;
  groundSpeedKt: number | null;
  /** Degrees true. Null for stationary targets, which have no meaningful track. */
  trackDeg: number | null;
  verticalRateFpm: number | null;
  squawk: string | null;
  /** Seconds since this position was reported. */
  positionAgeSec: number;
}

export interface RawAircraft {
  hex?: string;
  flight?: string;
  r?: string;
  t?: string;
  lat?: number;
  lon?: number;
  /** Number of feet, or the literal string "ground". */
  alt_baro?: number | string;
  gs?: number;
  track?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  seen_pos?: number;
}

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Convert one upstream record, or reject it.
 *
 * Returns null for anything the scope cannot draw. That is mostly targets with
 * no position.
 */
export function normalizeAircraft(raw: RawAircraft): Aircraft | null {
  const lat = finite(raw.lat);
  const lon = finite(raw.lon);
  if (lat === null || lon === null) return null;

  const id = raw.hex?.trim();
  if (!id) return null;

  const flight = raw.flight?.trim() || null;
  const registration = raw.r?.trim() || null;

  const onGround = raw.alt_baro === "ground";
  const altitudeFt = onGround ? null : finite(raw.alt_baro);

  return {
    id,
    callsign: flight ?? registration ?? id,
    registration,
    type: raw.t?.trim() || null,
    lat,
    lon,
    altitudeFt,
    onGround,
    groundSpeedKt: finite(raw.gs),
    trackDeg: finite(raw.track),
    verticalRateFpm: finite(raw.baro_rate) ?? finite(raw.geom_rate),
    squawk: raw.squawk?.trim() || null,
    positionAgeSec: finite(raw.seen_pos) ?? 0,
  };
}

export function normalizeResponse(payload: { ac?: RawAircraft[] }): Aircraft[] {
  return (payload.ac ?? [])
    .map(normalizeAircraft)
    .filter((aircraft): aircraft is Aircraft => aircraft !== null);
}

/**
 * Largest radius the upstream will serve, in nautical miles.
 */
export const MAX_QUERY_RADIUS_NM = 250;
