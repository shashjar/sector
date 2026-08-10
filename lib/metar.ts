/**
 * Aviation weather.
 *
 * NOAA's Aviation Weather Center publishes METARs already decoded — cloud
 * layers, wind, visibility, present weather, and usually the flight category
 * itself. So nothing here parses a METAR string. That is worth stating plainly
 * because the obvious move is to write a parser, or reach for one: the raw
 * observation is right there in the payload and the format is famously terse.
 * Both would be work spent re-deriving fields the upstream already computed,
 * with a new opportunity to disagree with it.
 *
 * What is left is the handful of things NOAA does not give us: a ceiling, a
 * category when the station reports too little for one, and which runway the
 * wind favors.
 */

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR" | "UNKNOWN";

export interface CloudLayer {
  /** FEW, SCT, BKN, OVC, CLR, SKC, OVX. */
  cover: string;
  /** Feet above ground. Null for clear skies and for layers of unknown height. */
  baseFt: number | null;
}

export interface Observation {
  icao: string;
  /** Epoch milliseconds. */
  observedAt: number;
  raw: string;
  tempC: number | null;
  dewpointC: number | null;
  /** Degrees true. METAR wind is true-referenced; a tower reads it magnetic. */
  windDirDeg: number | null;
  windSpeedKt: number | null;
  windGustKt: number | null;
  visibilitySm: number | null;
  /** Lowest broken or overcast layer, in feet AGL. Null when the sky is open. */
  ceilingFt: number | null;
  clouds: CloudLayer[];
  altimeterInHg: number | null;
  category: FlightCategory;
  /** Present weather as reported: "-RA BR". Null when nothing is happening. */
  wxString: string | null;
}

/** One entry from the Aviation Weather Center's JSON. Everything is optional. */
export interface RawMetar {
  icaoId?: string;
  obsTime?: number;
  rawOb?: string;
  temp?: number | null;
  dewp?: number | null;
  wdir?: number | string | null;
  wspd?: number | null;
  wgst?: number | null;
  visib?: number | string | null;
  altim?: number | null;
  fltCat?: string | null;
  wxString?: string | null;
  clouds?: { cover?: string; base?: number | null }[];
}

/** Hectopascals to inches of mercury. US altimeter settings are inHg. */
const HPA_PER_INHG = 33.86389;

const CEILING_COVERS = new Set(["BKN", "OVC", "OVX", "VV"]);

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Visibility as reported, in statute miles.
 *
 * The field is a number for most stations and a string for the rest: "10+"
 * means ten or more, and low visibilities arrive as fractions — "1/2", "1 1/2".
 */
export function parseVisibility(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const text = value.trim().replace("+", "");
  if (text === "") return null;

  // "1 1/2" — a whole number and a fraction.
  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);

  const fraction = text.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);

  const plain = Number(text);
  return Number.isFinite(plain) ? plain : null;
}

/**
 * The ceiling: the lowest broken, overcast, or obscured layer.
 *
 * Scattered and few layers are explicitly not a ceiling, however low they sit —
 * a pilot can legally and practically climb through them. Getting this wrong in
 * the permissive direction would report a field as IFR when it is open above.
 */
export function ceilingFrom(clouds: CloudLayer[]): number | null {
  const bases = clouds
    .filter((layer) => CEILING_COVERS.has(layer.cover.toUpperCase()))
    .map((layer) => layer.baseFt)
    .filter((base): base is number => base !== null);

  return bases.length > 0 ? Math.min(...bases) : null;
}

/**
 * Flight category from ceiling and visibility.
 *
 * The thresholds are regulatory, not a judgement call, which is exactly why no
 * model goes near this. Whichever of the two is worse decides the category — a
 * clear sky does not rescue a field sitting in half a mile of fog.
 *
 * A missing value means "not restricting", not "zero": most stations report no
 * cloud layers on a clear day, and treating that as a zero-foot ceiling would
 * paint every clear airport magenta.
 */
export function categoryFrom(
  ceilingFt: number | null,
  visibilitySm: number | null,
): FlightCategory {
  if (ceilingFt === null && visibilitySm === null) return "UNKNOWN";

  const ceiling = ceilingFt ?? Infinity;
  const visibility = visibilitySm ?? Infinity;

  if (ceiling < 500 || visibility < 1) return "LIFR";
  if (ceiling < 1000 || visibility < 3) return "IFR";
  if (ceiling <= 3000 || visibility <= 5) return "MVFR";
  return "VFR";
}

function isFlightCategory(value: unknown): value is FlightCategory {
  return (
    value === "VFR" || value === "MVFR" || value === "IFR" || value === "LIFR"
  );
}

/** Convert one upstream record, or reject it if it has no identity or time. */
export function normalizeObservation(raw: RawMetar): Observation | null {
  const icao = raw.icaoId?.trim();
  const obsTime = finite(raw.obsTime);
  if (!icao || obsTime === null) return null;

  const clouds: CloudLayer[] = (raw.clouds ?? [])
    .filter((layer) => typeof layer.cover === "string")
    .map((layer) => ({
      cover: layer.cover as string,
      baseFt: finite(layer.base),
    }));

  const ceilingFt = ceilingFrom(clouds);
  const visibilitySm = parseVisibility(raw.visib);
  const altimHpa = finite(raw.altim);

  return {
    icao,
    // The API reports seconds; everything downstream works in milliseconds.
    observedAt: obsTime * 1000,
    raw: raw.rawOb?.trim() ?? "",
    tempC: finite(raw.temp),
    dewpointC: finite(raw.dewp),
    // "VRB" arrives where a direction would be, for wind too variable to name.
    windDirDeg: finite(raw.wdir),
    windSpeedKt: finite(raw.wspd),
    windGustKt: finite(raw.wgst),
    visibilitySm,
    ceilingFt,
    clouds,
    altimeterInHg: altimHpa === null ? null : altimHpa / HPA_PER_INHG,
    // Prefer what NOAA published. Computing it ourselves is the fallback for
    // stations reporting too little for the upstream to classify.
    category: isFlightCategory(raw.fltCat)
      ? raw.fltCat
      : categoryFrom(ceilingFt, visibilitySm),
    wxString: raw.wxString?.trim() || null,
  };
}

/**
 * Reduce a batch to the latest observation per station.
 *
 * Necessary because the request has to carry an explicit `hours` window — the
 * API's default lookback silently drops any station whose last report is over
 * an hour old, which is exactly the small fields this app cares about. Asking
 * for a window returns *every* observation in it, several per station.
 */
export function latestPerStation(raws: RawMetar[]): Observation[] {
  const latest = new Map<string, Observation>();

  for (const raw of raws) {
    const observation = normalizeObservation(raw);
    if (!observation) continue;
    const existing = latest.get(observation.icao);
    if (!existing || observation.observedAt > existing.observedAt) {
      latest.set(observation.icao, observation);
    }
  }

  return [...latest.values()];
}

export interface RunwayEnd {
  ident: string;
  /** Degrees true, as published. */
  headingTrue: number;
}

export interface RunwayWind {
  /** The runway end the wind favors: "30". */
  ident: string;
  /** Positive is a headwind; negative means every option has a tailwind. */
  headwindKt: number;
  /** Always positive — the magnitude across the runway, regardless of side. */
  crosswindKt: number;
  /** Angle between wind and runway, 0 to 180. */
  offsetDeg: number;
}

/** Smallest angle between two bearings, accounting for the wrap at 360. */
function angleBetween(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360) + 360) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Which runway end the wind favors, and by how much.
 *
 * Both inputs are degrees true and stay that way. METAR wind is true-referenced
 * while a tower reads wind magnetic, so mixing the two sources without
 * converting is a real and easy mistake — 13 degrees of error in the Bay Area,
 * over 20 in parts of the country. These headings come from the runway table,
 * which is also true, so the comparison is sound.
 *
 * Returns null for calm or variable wind, where no runway is favored and
 * asserting one would be invention.
 */
export function favoredRunway(
  windDirDeg: number | null,
  windSpeedKt: number | null,
  ends: RunwayEnd[],
): RunwayWind | null {
  if (windDirDeg === null || windSpeedKt === null || ends.length === 0) return null;
  // Below three knots the direction is noise, and every runway is equally fine.
  if (windSpeedKt < 3) return null;

  let best: RunwayWind | null = null;
  for (const end of ends) {
    const offsetDeg = angleBetween(windDirDeg, end.headingTrue);
    const radians = (offsetDeg * Math.PI) / 180;
    const candidate: RunwayWind = {
      ident: end.ident,
      headwindKt: windSpeedKt * Math.cos(radians),
      crosswindKt: Math.abs(windSpeedKt * Math.sin(radians)),
      offsetDeg,
    };
    if (!best || candidate.headwindKt > best.headwindKt) best = candidate;
  }

  return best;
}
