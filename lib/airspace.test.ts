import distance from "@turf/distance";
import { describe, expect, it } from "vitest";

import {
  deriveRunwayGeometry,
  feetToNauticalMiles,
  runwayDesignator,
  type LonLat,
  type RunwayEndInput,
} from "./airspace";

/** San Carlos, and its single runway 12/30 as OurAirports publishes it. */
const KSQL = { lat: 37.51313, lon: -122.250838 };
const RUNWAY_12: RunwayEndInput = {
  ident: "12",
  lat: 37.514528,
  lon: -122.25256,
  headingTrue: 138,
  elevationFt: 5,
};
const RUNWAY_30: RunwayEndInput = {
  ident: "30",
  lat: 37.509198,
  lon: -122.246527,
  headingTrue: 318,
  elevationFt: 5,
};
const KSQL_LENGTH_FT = 2621;

const blank = (ident: string, headingTrue: number | null): RunwayEndInput => ({
  ident,
  lat: null,
  lon: null,
  headingTrue,
  elevationFt: null,
});

const nmApart = (a: LonLat, b: LonLat) =>
  distance(a, b, { units: "nauticalmiles" });

describe("unit conversion", () => {
  it("treats 6076.11548556 feet as one nautical mile", () => {
    expect(feetToNauticalMiles(6076.11548556)).toBeCloseTo(1, 12);
    expect(feetToNauticalMiles(0)).toBe(0);
  });
});

describe("runway designators", () => {
  it("joins both ends low-first", () => {
    expect(runwayDesignator("12", "30")).toBe("12/30");
    expect(runwayDesignator("10L", "28R")).toBe("10L/28R");
  });

  it("falls back to whichever end is published", () => {
    expect(runwayDesignator("18", "")).toBe("18");
    expect(runwayDesignator("", "36")).toBe("36");
  });
});

describe("runway geometry", () => {
  it("uses surveyed thresholds when both are published", () => {
    const result = deriveRunwayGeometry(KSQL, RUNWAY_12, RUNWAY_30, KSQL_LENGTH_FT);
    expect(result).not.toBeNull();
    expect(result!.surveyed).toBe(true);
    // Longitude first — GeoJSON order, not lat/lon.
    expect(result!.ends[0]).toEqual([-122.25256, 37.514528]);
    expect(result!.ends[1]).toEqual([-122.246527, 37.509198]);
  });

  it("projects the far end from a single surveyed threshold", () => {
    const result = deriveRunwayGeometry(
      KSQL,
      RUNWAY_12,
      blank("30", 318),
      KSQL_LENGTH_FT,
    );
    expect(result).not.toBeNull();
    expect(result!.surveyed).toBe(false);
    // The known end is kept exactly, and the projected end lands a runway
    // length away — within ~5 m of where the survey actually puts it.
    expect(result!.ends[0]).toEqual([-122.25256, 37.514528]);
    expect(nmApart(result!.ends[0], result!.ends[1])).toBeCloseTo(
      feetToNauticalMiles(KSQL_LENGTH_FT),
      6,
    );
    expect(nmApart(result!.ends[1], [-122.246527, 37.509198])).toBeLessThan(0.005);
  });

  it("derives the axis from the high end when only it publishes a heading", () => {
    const fromHigh = deriveRunwayGeometry(
      KSQL,
      blank("12", null),
      blank("30", 318),
      KSQL_LENGTH_FT,
    );
    const fromLow = deriveRunwayGeometry(
      KSQL,
      blank("12", 138),
      blank("30", null),
      KSQL_LENGTH_FT,
    );
    expect(fromHigh).not.toBeNull();
    // 318 minus 180 is 138: the two ends describe one axis, so either heading
    // must produce the same runway.
    expect(fromHigh!.ends[0][0]).toBeCloseTo(fromLow!.ends[0][0], 9);
    expect(fromHigh!.ends[0][1]).toBeCloseTo(fromLow!.ends[0][1], 9);
  });

  it("centres an unsurveyed runway on the airport reference point", () => {
    const result = deriveRunwayGeometry(
      KSQL,
      blank("12", 138),
      blank("30", null),
      KSQL_LENGTH_FT,
    );
    expect(result).not.toBeNull();
    expect(result!.surveyed).toBe(false);

    const [low, high] = result!.ends;
    const centre: LonLat = [KSQL.lon, KSQL.lat];
    const half = feetToNauticalMiles(KSQL_LENGTH_FT) / 2;
    expect(nmApart(centre, low)).toBeCloseTo(half, 6);
    expect(nmApart(centre, high)).toBeCloseTo(half, 6);
    expect(nmApart(low, high)).toBeCloseTo(half * 2, 6);
  });

  it("refuses to guess when no true heading is published", () => {
    // The temptation is to read the axis off the runway number — "12" is about
    // 120 degrees. That is magnetic, and the Bay Area's 13-degree variation
    // would draw the runway visibly askew on a chart showing the real one.
    expect(
      deriveRunwayGeometry(KSQL, blank("12", null), blank("30", null), KSQL_LENGTH_FT),
    ).toBeNull();
  });

  it("refuses to guess without a usable length", () => {
    expect(deriveRunwayGeometry(KSQL, blank("12", 138), blank("30", null), null)).toBeNull();
    expect(deriveRunwayGeometry(KSQL, blank("12", 138), blank("30", null), 0)).toBeNull();
  });

  it("keeps surveyed thresholds even when length is missing", () => {
    // Length only matters for projection; two known ends already define the line.
    const result = deriveRunwayGeometry(KSQL, RUNWAY_12, RUNWAY_30, null);
    expect(result).not.toBeNull();
    expect(result!.surveyed).toBe(true);
  });
});
