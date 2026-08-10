import destination from "@turf/destination";

/**
 * Static airspace: airports, runway geometry, and published frequencies.
 *
 * This data is generated at build time by `scripts/build-airspace.mts` from
 * OurAirports and committed as a static asset. It changes on the order of
 * months, so fetching it at runtime would add a network dependency and a
 * failure mode in exchange for freshness nobody would notice.
 */

/** GeoJSON position order: longitude first. */
export type LonLat = [number, number];

export type AirportSize = "large" | "medium" | "small";

export interface RunwayEndInput {
  ident: string;
  lat: number | null;
  lon: number | null;
  headingTrue: number | null;
  elevationFt: number | null;
}

export interface AirportProperties {
  /** Local identifier. For US fields this is often the FAA code, not an ICAO. */
  ident: string;
  /** ICAO code where one exists. Null for most small fields — and weather lookups need it. */
  icao: string | null;
  name: string;
  size: AirportSize;
  elevationFt: number | null;
  municipality: string | null;
  hasTower: boolean;
  /**
   * Longest published runway, in feet.
   */
  longestRunwayFt: number | null;
  /** Number of runways whose geometry could be located. Often zero for small fields. */
  drawnRunways: number;
}

export interface RunwayProperties {
  airport: string;
  /** Both ends, low first: "12/30". */
  designator: string;
  lengthFt: number | null;
  widthFt: number | null;
  surface: string | null;
  lighted: boolean;
  /**
   * True when the geometry came from published threshold coordinates rather
   * than being projected from the airport reference point. Surveyed thresholds
   * are metres-accurate; derived ones assume the runway is centred on the
   * reference point, which is only roughly true.
   */
  surveyed: boolean;
}

export interface Frequency {
  /** TWR, GND, ATIS, CTAF, APP, DEP, UNIC… as published. */
  type: string;
  description: string;
  mhz: number;
}

/** Exact, by definition of the international nautical mile. */
export const FEET_PER_NAUTICAL_MILE = 6076.11548556;

export function feetToNauticalMiles(feet: number): number {
  return feet / FEET_PER_NAUTICAL_MILE;
}

function project(from: LonLat, bearingTrue: number, distanceNm: number): LonLat {
  const point = destination(from, distanceNm, bearingTrue, { units: "nauticalmiles" });
  const [lon, lat] = point.geometry.coordinates;
  return [lon, lat];
}

export interface RunwayGeometry {
  ends: [LonLat, LonLat];
  surveyed: boolean;
}

/**
 * Work out where a runway actually lies.
 *
 * OurAirports publishes surveyed threshold coordinates for most significant
 * runways and nothing at all for many small ones, so this fills the gaps in
 * descending order of trust:
 *
 *   1. Both thresholds surveyed — use them.
 *   2. One threshold surveyed, plus a true heading and length — project the
 *      other end from the known one.
 *   3. Neither surveyed — centre the runway on the airport reference point and
 *      project both ends. Approximate, and flagged as such.
 *
 * Returns null when the runway is underdetermined. That happens when there is
 * no true heading, and the temptation there is to infer one from the runway
 * number — runway 12 is *about* 120 degrees. That would be wrong by the local
 * magnetic variation, which is 13 degrees in the Bay Area and over 20 in parts
 * of the US: enough to draw a runway visibly askew on a chart that shows the
 * real one underneath. Better to omit it.
 */
export function deriveRunwayGeometry(
  airport: { lat: number; lon: number },
  low: RunwayEndInput,
  high: RunwayEndInput,
  lengthFt: number | null,
): RunwayGeometry | null {
  const lowSurveyed = low.lat !== null && low.lon !== null;
  const highSurveyed = high.lat !== null && high.lon !== null;

  if (lowSurveyed && highSurveyed) {
    return {
      ends: [
        [low.lon as number, low.lat as number],
        [high.lon as number, high.lat as number],
      ],
      surveyed: true,
    };
  }

  // Either end's heading determines the runway's axis; they differ by 180.
  const heading =
    low.headingTrue ??
    (high.headingTrue !== null ? (high.headingTrue + 180) % 360 : null);

  if (heading === null || lengthFt === null || lengthFt <= 0) return null;
  const lengthNm = feetToNauticalMiles(lengthFt);

  if (lowSurveyed) {
    const start: LonLat = [low.lon as number, low.lat as number];
    return { ends: [start, project(start, heading, lengthNm)], surveyed: false };
  }

  if (highSurveyed) {
    const end: LonLat = [high.lon as number, high.lat as number];
    return {
      ends: [project(end, (heading + 180) % 360, lengthNm), end],
      surveyed: false,
    };
  }

  const centre: LonLat = [airport.lon, airport.lat];
  const half = lengthNm / 2;
  return {
    ends: [
      project(centre, (heading + 180) % 360, half),
      project(centre, heading, half),
    ],
    surveyed: false,
  };
}

/** "12" and "30" become "12/30"; a lone end stays as itself. */
export function runwayDesignator(lowIdent: string, highIdent: string): string {
  const low = lowIdent.trim();
  const high = highIdent.trim();
  if (!low) return high;
  if (!high) return low;
  return `${low}/${high}`;
}
