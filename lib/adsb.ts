/**
 * ADS-B traffic, normalised.
 *
 * The upstream is adsb.lol, fed by volunteer receivers. Its response is the
 * readsb JSON format: dozens of fields, terse names, and several that change
 * type depending on the aircraft's state. Everything the app touches goes
 * through {@link normalizeAircraft} first, so swapping to airplanes.live or
 * adsb.fi — both of which serve the same shape — is a change to one file.
 */

/** What the scope actually needs to know about a target. */
export interface Aircraft {
  /** ICAO 24-bit address in hex. Stable, and the only reliable identity. */
  id: string;
  /**
   * What a controller would call this aircraft: the filed callsign where there
   * is one, otherwise the registration, otherwise the hex address.
   */
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
  /** Seconds since this position was reported. Drives staleness fading. */
  positionAgeSec: number;
}

/** A single entry in the upstream `ac` array. Every field is optional in practice. */
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
 * no position: receivers report aircraft they can hear but not locate, and a
 * target without coordinates is a row in a table, not something on a map.
 */
export function normalizeAircraft(raw: RawAircraft): Aircraft | null {
  const lat = finite(raw.lat);
  const lon = finite(raw.lon);
  if (lat === null || lon === null) return null;

  // Hex addresses are prefixed with "~" for non-ICAO sources such as TIS-B.
  // The prefix is not part of the address, but it is the only identity these
  // targets have, so it is kept rather than stripped.
  const id = raw.hex?.trim();
  if (!id) return null;

  // The upstream pads callsigns to eight characters.
  const flight = raw.flight?.trim() || null;
  const registration = raw.r?.trim() || null;

  // "ground" is the string the format uses instead of an altitude. Treating it
  // as a number would silently produce NaN and drop the target from the map.
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
    // Barometric rate is the primary source; geometric fills in for aircraft
    // that only report the latter.
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
 *
 * Past this the API rejects the request outright, so the scope stops querying
 * and says so rather than showing an empty map that looks like empty airspace.
 */
export const MAX_QUERY_RADIUS_NM = 250;
