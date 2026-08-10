import { describe, expect, it } from "vitest";

import {
  categoryFrom,
  ceilingFrom,
  favoredRunway,
  latestPerStation,
  normalizeObservation,
  parseVisibility,
  type RawMetar,
} from "./metar";

/** KSFO as the Aviation Weather Center returned it, trimmed to fields we read. */
const KSFO: RawMetar = {
  icaoId: "KSFO",
  obsTime: 1786312560,
  rawOb: "KSFO 092200Z 30020G27KT 10SM FEW015 21/14 A2984",
  temp: 20.6,
  dewp: 14.4,
  wdir: 300,
  wspd: 20,
  wgst: 27,
  visib: "10+",
  altim: 1010.6,
  fltCat: "VFR",
  clouds: [{ cover: "FEW", base: 1500 }],
};

describe("visibility", () => {
  it("reads plain numbers and the ten-or-more marker", () => {
    expect(parseVisibility(3)).toBe(3);
    expect(parseVisibility("10+")).toBe(10);
    expect(parseVisibility("6")).toBe(6);
  });

  it("reads the fractions low visibility is reported in", () => {
    expect(parseVisibility("1/2")).toBe(0.5);
    expect(parseVisibility("1/4")).toBe(0.25);
    expect(parseVisibility("1 1/2")).toBe(1.5);
    expect(parseVisibility("2 3/4")).toBe(2.75);
  });

  it("rejects anything it cannot read", () => {
    expect(parseVisibility(null)).toBeNull();
    expect(parseVisibility(undefined)).toBeNull();
    expect(parseVisibility("")).toBeNull();
    expect(parseVisibility("M")).toBeNull();
  });
});

describe("ceiling", () => {
  it("is the lowest broken or overcast layer", () => {
    expect(
      ceilingFrom([
        { cover: "FEW", baseFt: 1000 },
        { cover: "BKN", baseFt: 3500 },
        { cover: "OVC", baseFt: 8000 },
      ]),
    ).toBe(3500);
  });

  it("ignores few and scattered however low they sit", () => {
    // A pilot can climb through scattered cloud; it is not a ceiling, and
    // treating it as one would report an open field as IFR.
    expect(
      ceilingFrom([
        { cover: "FEW", baseFt: 200 },
        { cover: "SCT", baseFt: 400 },
      ]),
    ).toBeNull();
  });

  it("counts vertical visibility as a ceiling", () => {
    // An obscured sky has no layer above it to climb into.
    expect(ceilingFrom([{ cover: "VV", baseFt: 200 }])).toBe(200);
  });

  it("is absent for a clear sky", () => {
    expect(ceilingFrom([])).toBeNull();
    expect(ceilingFrom([{ cover: "CLR", baseFt: null }])).toBeNull();
  });
});

describe("flight category", () => {
  it("applies the regulatory thresholds", () => {
    expect(categoryFrom(5000, 10)).toBe("VFR");
    expect(categoryFrom(2000, 10)).toBe("MVFR");
    expect(categoryFrom(800, 10)).toBe("IFR");
    expect(categoryFrom(300, 10)).toBe("LIFR");
  });

  it("lets visibility alone drive the category", () => {
    expect(categoryFrom(null, 4)).toBe("MVFR");
    expect(categoryFrom(null, 2)).toBe("IFR");
    expect(categoryFrom(null, 0.5)).toBe("LIFR");
  });

  it("takes whichever of ceiling and visibility is worse", () => {
    // A clear sky does not rescue a field sitting in fog.
    expect(categoryFrom(10000, 0.5)).toBe("LIFR");
    expect(categoryFrom(300, 10)).toBe("LIFR");
  });

  it("treats a missing value as unrestricting rather than as zero", () => {
    // Most stations report no cloud layers on a clear day. Reading that as a
    // zero-foot ceiling would paint every clear airport magenta.
    expect(categoryFrom(null, 10)).toBe("VFR");
    expect(categoryFrom(5000, null)).toBe("VFR");
  });

  it("is unknown when the station reports neither", () => {
    expect(categoryFrom(null, null)).toBe("UNKNOWN");
  });
});

describe("normalizing observations", () => {
  it("reads a full report", () => {
    const observation = normalizeObservation(KSFO);
    expect(observation).toMatchObject({
      icao: "KSFO",
      windDirDeg: 300,
      windSpeedKt: 20,
      windGustKt: 27,
      visibilitySm: 10,
      ceilingFt: null,
      category: "VFR",
    });
    // Seconds upstream, milliseconds everywhere here.
    expect(observation?.observedAt).toBe(1786312560 * 1000);
  });

  it("converts the altimeter from hectopascals to inches", () => {
    // 1010.6 hPa is 29.84 inHg — the number a pilot actually sets.
    expect(normalizeObservation(KSFO)?.altimeterInHg).toBeCloseTo(29.84, 2);
  });

  it("computes a category when the upstream omits one", () => {
    const partial = normalizeObservation({
      ...KSFO,
      fltCat: null,
      visib: 2,
      clouds: [{ cover: "OVC", base: 700 }],
    });
    expect(partial?.category).toBe("IFR");
  });

  it("prefers the upstream category over its own arithmetic", () => {
    expect(normalizeObservation(KSFO)?.category).toBe("VFR");
  });

  it("rejects records with no station or no time", () => {
    expect(normalizeObservation({ ...KSFO, icaoId: undefined })).toBeNull();
    expect(normalizeObservation({ ...KSFO, obsTime: undefined })).toBeNull();
  });
});

describe("reducing a batch", () => {
  it("keeps only the newest observation for each station", () => {
    // Requesting an hours window returns several reports per station, because
    // the default lookback drops any field that has not reported recently.
    const observations = latestPerStation([
      { ...KSFO, obsTime: 1786309000, rawOb: "older" },
      { ...KSFO, obsTime: 1786312560, rawOb: "newest" },
      { ...KSFO, obsTime: 1786311000, rawOb: "middle" },
      { ...KSFO, icaoId: "KSQL", obsTime: 1786312000 },
    ]);

    expect(observations).toHaveLength(2);
    expect(observations.find((o) => o.icao === "KSFO")?.raw).toBe("newest");
  });

  it("survives an empty or unusable batch", () => {
    expect(latestPerStation([])).toEqual([]);
    expect(latestPerStation([{ rawOb: "junk" }])).toEqual([]);
  });
});

describe("favored runway", () => {
  /** KSQL runway 12/30, true headings as published. */
  const KSQL_ENDS = [
    { ident: "12", headingTrue: 138 },
    { ident: "30", headingTrue: 318 },
  ];

  it("picks the end the wind is blowing down", () => {
    // A north-westerly favors runway 30, which points 318 true.
    const result = favoredRunway(320, 11, KSQL_ENDS);
    expect(result?.ident).toBe("30");
    expect(result?.headwindKt).toBeCloseTo(11, 1);
    expect(result?.crosswindKt).toBeLessThan(1);
  });

  it("picks the opposite end when the wind reverses", () => {
    expect(favoredRunway(140, 11, KSQL_ENDS)?.ident).toBe("12");
  });

  it("splits a crosswind into its components", () => {
    // Wind 45 degrees off the runway: components are equal, and each is the
    // speed divided by the square root of two.
    const result = favoredRunway(318 + 45, 20, KSQL_ENDS);
    expect(result?.ident).toBe("30");
    expect(result?.offsetDeg).toBeCloseTo(45, 6);
    expect(result?.headwindKt).toBeCloseTo(14.14, 1);
    expect(result?.crosswindKt).toBeCloseTo(14.14, 1);
  });

  it("reports crosswind as a magnitude regardless of side", () => {
    const left = favoredRunway(318 - 40, 15, KSQL_ENDS);
    const right = favoredRunway(318 + 40, 15, KSQL_ENDS);
    expect(left?.crosswindKt).toBeGreaterThan(0);
    expect(left?.crosswindKt).toBeCloseTo(right?.crosswindKt as number, 6);
  });

  it("declines to favor a runway in calm or variable wind", () => {
    // Below three knots the direction is noise and every runway is equally fine.
    expect(favoredRunway(320, 2, KSQL_ENDS)).toBeNull();
    expect(favoredRunway(null, 10, KSQL_ENDS)).toBeNull();
    expect(favoredRunway(320, null, KSQL_ENDS)).toBeNull();
    expect(favoredRunway(320, 10, [])).toBeNull();
  });
});
