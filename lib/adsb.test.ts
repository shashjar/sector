import distance from "@turf/distance";
import { describe, expect, it } from "vitest";

import { normalizeAircraft, normalizeResponse, type RawAircraft } from "./adsb";
import { deadReckon } from "./aviation";

/** A real record from adsb.lol, trimmed to the fields the app reads. */
const AIRBORNE: RawAircraft = {
  hex: "a857c9",
  flight: "N637AM  ",
  r: "N637AM",
  t: "C56X",
  alt_baro: 13000,
  gs: 310.3,
  track: 168.47,
  baro_rate: 2432,
  squawk: "3757",
  lat: 37.447411,
  lon: -122.467406,
  seen_pos: 0.331,
};

describe("normalizing ADS-B records", () => {
  it("reads an airborne target", () => {
    expect(normalizeAircraft(AIRBORNE)).toEqual({
      id: "a857c9",
      callsign: "N637AM",
      registration: "N637AM",
      type: "C56X",
      lat: 37.447411,
      lon: -122.467406,
      altitudeFt: 13000,
      onGround: false,
      groundSpeedKt: 310.3,
      trackDeg: 168.47,
      verticalRateFpm: 2432,
      squawk: "3757",
      positionAgeSec: 0.331,
    });
  });

  it("treats a ground target's altitude as absent, not as a number", () => {
    // The format uses the string "ground" where an altitude would be. Coercing
    // it produces NaN, which silently removes the target from the map.
    const parked = normalizeAircraft({ ...AIRBORNE, alt_baro: "ground", gs: 0 });
    expect(parked?.onGround).toBe(true);
    expect(parked?.altitudeFt).toBeNull();
    expect(Number.isNaN(parked?.altitudeFt as number)).toBe(false);
  });

  it("drops targets with no position", () => {
    // Receivers report aircraft they can hear but not locate.
    expect(normalizeAircraft({ hex: "abc123", flight: "SWA100" })).toBeNull();
    expect(normalizeAircraft({ ...AIRBORNE, lat: undefined })).toBeNull();
    expect(normalizeAircraft({ ...AIRBORNE, lon: undefined })).toBeNull();
  });

  it("drops targets with no identity", () => {
    expect(normalizeAircraft({ ...AIRBORNE, hex: undefined })).toBeNull();
  });

  it("falls back through callsign, registration, then hex", () => {
    expect(normalizeAircraft(AIRBORNE)?.callsign).toBe("N637AM");
    expect(
      normalizeAircraft({ ...AIRBORNE, flight: "   " })?.callsign,
    ).toBe("N637AM");
    expect(
      normalizeAircraft({ ...AIRBORNE, flight: undefined, r: undefined })?.callsign,
    ).toBe("a857c9");
  });

  it("keeps the tilde on non-ICAO addresses", () => {
    // "~" marks a TIS-B or otherwise non-ICAO source. It is not decoration —
    // it is the only identity these targets have.
    expect(normalizeAircraft({ ...AIRBORNE, hex: "~a7d831" })?.id).toBe("~a7d831");
  });

  it("uses geometric vertical rate when barometric is missing", () => {
    const aircraft = normalizeAircraft({
      ...AIRBORNE,
      baro_rate: undefined,
      geom_rate: -640,
    });
    expect(aircraft?.verticalRateFpm).toBe(-640);
  });

  it("survives an empty or malformed payload", () => {
    expect(normalizeResponse({})).toEqual([]);
    expect(normalizeResponse({ ac: [] })).toEqual([]);
    expect(normalizeResponse({ ac: [{ hex: "nopos" }, AIRBORNE] })).toHaveLength(1);
  });
});

describe("dead reckoning", () => {
  const position: [number, number] = [-122.250838, 37.51313];

  it("moves a target by groundspeed over time", () => {
    // 120 knots for 30 seconds is exactly one nautical mile.
    const moved = deadReckon(position, 90, 120, 30);
    expect(distance(position, moved, { units: "nauticalmiles" })).toBeCloseTo(1, 6);
  });

  it("moves along the reported track", () => {
    const north = deadReckon(position, 0, 120, 30);
    const east = deadReckon(position, 90, 120, 30);
    expect(north[1]).toBeGreaterThan(position[1]);
    expect(north[0]).toBeCloseTo(position[0], 6);
    expect(east[0]).toBeGreaterThan(position[0]);
  });

  it("leaves a target alone when there is nothing to extrapolate", () => {
    // A parked aircraft has no track, and a target reported this instant has no
    // elapsed time. Both must stay exactly where they were reported.
    expect(deadReckon(position, null, 120, 30)).toBe(position);
    expect(deadReckon(position, 90, null, 30)).toBe(position);
    expect(deadReckon(position, 90, 0, 30)).toBe(position);
    expect(deadReckon(position, 90, 120, 0)).toBe(position);
  });
});
