/**
 * Build the static airspace index from OurAirports.
 *
 * Run with `npm run build:airspace`. Output lands in `public/data/` and is
 * committed: the source data changes on the order of months, and committing the
 * artefact keeps deploys from depending on a third party being reachable.
 *
 * Node strips the types natively, so this needs no build step of its own.
 */
import { parse } from "csv-parse/sync";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  deriveRunwayGeometry,
  runwayDesignator,
  type AirportProperties,
  type AirportSize,
  type Frequency,
  type RunwayProperties,
} from "../lib/airspace.ts";

const SOURCE = "https://davidmegginson.github.io/ourairports-data";
const CACHE_DIR = ".cache/ourairports";
const OUT_DIR = "public/data";

/** Coordinates to five decimal places — about a metre, well past what we draw. */
const COORD_PRECISION = 5;

const SIZES: Record<string, AirportSize> = {
  large_airport: "large",
  medium_airport: "medium",
  small_airport: "small",
};

type Row = Record<string, string>;

/**
 * Fetch a CSV, caching it on disk.
 *
 * The three files total ~18MB. Caching makes iterating on the transform fast
 * and lets the script run offline once primed.
 */
async function fetchCsv(name: string): Promise<Row[]> {
  const cached = join(CACHE_DIR, `${name}.csv`);
  if (!existsSync(cached)) {
    process.stdout.write(`  downloading ${name}.csv… `);
    const response = await fetch(`${SOURCE}/${name}.csv`);
    if (!response.ok) {
      throw new Error(`${name}.csv: HTTP ${response.status}`);
    }
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cached, await response.text());
    process.stdout.write("done\n");
  }
  // OurAirports quotes fields that contain commas — airport names routinely do
  // — so this needs a real parser, not a split.
  return parse(await readFile(cached), { columns: true, skip_empty_lines: true });
}

const num = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const round = (value: number, places = COORD_PRECISION): number =>
  Number(value.toFixed(places));

async function main() {
  console.log("Building airspace index from OurAirports\n");

  const [airportRows, runwayRows, frequencyRows] = await Promise.all([
    fetchCsv("airports"),
    fetchCsv("runways"),
    fetchCsv("airport-frequencies"),
  ]);

  console.log(
    `  read ${airportRows.length} airports, ${runwayRows.length} runways, ${frequencyRows.length} frequencies\n`,
  );

  // US only. The chart basemap, the ATC feeds, and the weather source are all
  // US-centric, so shipping the rest of the world would be dead weight.
  const usAirports = airportRows.filter(
    (row) => row.iso_country === "US" && row.type in SIZES,
  );

  const frequenciesByAirport = new Map<string, Frequency[]>();
  for (const row of frequencyRows) {
    const mhz = num(row.frequency_mhz);
    if (mhz === null) continue;
    const list = frequenciesByAirport.get(row.airport_ident) ?? [];
    list.push({
      type: row.type,
      description: row.description || row.type,
      mhz,
    });
    frequenciesByAirport.set(row.airport_ident, list);
  }

  /*
   * Which airports ship.
   *
   * There are 16,162 US airports of these types and most are private grass
   * strips. Including them all costs 574KB gzipped, and — more to the point —
   * would be pointless: the sectional basemap already draws every airport
   * itself. Sector's markers are not there to duplicate the chart. They exist
   * to carry things the chart cannot, because it is a static 56-day product:
   * current flight category, and whether a live ATC feed exists. They also give
   * MapLibre something to hit-test, since a raster chart is just pixels and
   * nothing on it can be clicked.
   *
   * So the set is airports that can plausibly carry that state: a published
   * radio frequency, an ICAO code (which is what the weather API keys on), or
   * enough size to matter. Everything else is a strip in a field with no tower,
   * no weather station, and nothing to listen to.
   */
  const airports = usAirports.filter(
    (row) =>
      frequenciesByAirport.has(row.ident) ||
      row.icao_code !== "" ||
      row.type === "large_airport" ||
      row.type === "medium_airport",
  );
  const kept = new Set(airports.map((row) => row.ident));

  const runwaysByAirport = new Map<string, Row[]>();
  for (const row of runwayRows) {
    // Runways only ship for airports that ship, and are drawn only on the
    // basemaps that lack their own — see `drawsOwnRunways` in lib/basemaps.ts.
    if (!kept.has(row.airport_ident)) continue;
    // Closed runways still appear on charts as X-marked, but drawing them as
    // active would be actively misleading on a traffic display.
    if (row.closed === "1") continue;
    const list = runwaysByAirport.get(row.airport_ident) ?? [];
    list.push(row);
    runwaysByAirport.set(row.airport_ident, list);
  }

  const airportFeatures: GeoJSON.Feature<GeoJSON.Point, AirportProperties>[] = [];
  const runwayFeatures: GeoJSON.Feature<GeoJSON.LineString, RunwayProperties>[] = [];
  const frequencies: Record<string, Frequency[]> = {};

  let surveyedCount = 0;
  let derivedCount = 0;
  let underdetermined = 0;
  let airportsWithoutGeometry = 0;

  for (const row of airports) {
    const lat = num(row.latitude_deg);
    const lon = num(row.longitude_deg);
    if (lat === null || lon === null) continue;

    const ident = row.ident;
    const airportRunways = runwaysByAirport.get(ident) ?? [];
    const airportFrequencies = frequenciesByAirport.get(ident) ?? [];

    const geometries = airportRunways
      .map((runway) => {
        const lengthFt = num(runway.length_ft);
        const geometry = deriveRunwayGeometry(
          { lat, lon },
          {
            ident: runway.le_ident,
            lat: num(runway.le_latitude_deg),
            lon: num(runway.le_longitude_deg),
            headingTrue: num(runway.le_heading_degT),
            elevationFt: num(runway.le_elevation_ft),
          },
          {
            ident: runway.he_ident,
            lat: num(runway.he_latitude_deg),
            lon: num(runway.he_longitude_deg),
            headingTrue: num(runway.he_heading_degT),
            elevationFt: num(runway.he_elevation_ft),
          },
          lengthFt,
        );
        if (geometry === null) {
          underdetermined += 1;
          return null;
        }
        if (geometry.surveyed) surveyedCount += 1;
        else derivedCount += 1;
        return { runway, geometry, lengthFt };
      })
      .filter((entry) => entry !== null);

    if (geometries.length === 0 && airportRunways.length > 0) {
      airportsWithoutGeometry += 1;
    }

    const hasTower = airportFrequencies.some((frequency) => frequency.type === "TWR");
    const lengths = airportRunways
      .map((runway) => num(runway.length_ft))
      .filter((length): length is number => length !== null && length > 0);
    const longestRunwayFt = lengths.length > 0 ? Math.max(...lengths) : null;

    airportFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [round(lon), round(lat)] },
      properties: {
        ident,
        icao: row.icao_code || null,
        name: row.name,
        size: SIZES[row.type],
        elevationFt: num(row.elevation_ft),
        municipality: row.municipality || null,
        hasTower,
        longestRunwayFt,
        drawnRunways: geometries.length,
      },
    });

    for (const { runway, geometry, lengthFt } of geometries) {
      runwayFeatures.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: geometry.ends.map(([x, y]) => [round(x), round(y)]),
        },
        properties: {
          airport: ident,
          designator: runwayDesignator(runway.le_ident, runway.he_ident),
          lengthFt,
          widthFt: num(runway.width_ft),
          surface: runway.surface || null,
          lighted: runway.lighted === "1",
          surveyed: geometry.surveyed,
        },
      });
    }

    if (airportFrequencies.length > 0) {
      frequencies[ident] = airportFrequencies;
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeFile(
      join(OUT_DIR, "airports.geojson"),
      JSON.stringify({ type: "FeatureCollection", features: airportFeatures }),
    ),
    writeFile(
      join(OUT_DIR, "runways.geojson"),
      JSON.stringify({ type: "FeatureCollection", features: runwayFeatures }),
    ),
    writeFile(join(OUT_DIR, "frequencies.json"), JSON.stringify(frequencies)),
  ]);

  const towered = airportFeatures.filter((f) => f.properties.hasTower).length;
  const size = async (file: string) =>
    `${((await readFile(join(OUT_DIR, file))).byteLength / 1_048_576).toFixed(2)} MB`;

  console.log("Wrote public/data/");
  console.log(
    `  airports.geojson    ${airportFeatures.length} (${towered} towered)  ${await size("airports.geojson")}`,
  );
  console.log(
    `  runways.geojson     ${runwayFeatures.length}  ${await size("runways.geojson")}`,
  );
  console.log(`    surveyed thresholds  ${surveyedCount}`);
  console.log(`    projected            ${derivedCount}`);
  console.log(
    `  frequencies.json    ${Object.keys(frequencies).length} airports  ${await size("frequencies.json")}`,
  );
  console.log();
  console.log(
    `  ${underdetermined} runways have neither surveyed coordinates nor a published`,
  );
  console.log(
    `  heading and cannot be drawn; ${airportsWithoutGeometry} airports show as a point only.`,
  );
  console.log("  This is a gap in the source data, not a filter.");
}

await main();
