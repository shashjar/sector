import bearing from "@turf/bearing";

import type { RunwayEnd } from "./metar";

/**
 * Runway headings, indexed by airport.
 *
 * Fetched directly rather than read off the map's runway source, which was the
 * first attempt and was wrong: MapLibre does not tile a source when no visible
 * layer uses it, and the runway layer is hidden on the sectional — the default
 * basemap. So the lookup silently returned nothing exactly where it mattered
 * most. A data question should not depend on what happens to be drawn.
 *
 * The file is the same one the map loads for satellite and street, so on those
 * basemaps this costs nothing beyond a cache hit.
 */

let cache: Promise<Map<string, RunwayEnd[]>> | null = null;

interface RunwayFeature {
  geometry: { type: string; coordinates: [number, number][] };
  properties: { airport?: string; designator?: string };
}

/**
 * Headings are derived from the drawn geometry rather than read from a field.
 *
 * That is deliberate: 99% of these runways come from surveyed threshold
 * coordinates, which pin the true bearing more precisely than the published
 * whole-degree heading does. Both ends come from one line, so they can never
 * disagree by anything other than exactly 180 degrees.
 */
function endsFrom(feature: RunwayFeature): RunwayEnd[] {
  if (feature.geometry.type !== "LineString") return [];
  const [low, high] = feature.geometry.coordinates;
  if (!low || !high) return [];

  const [lowIdent, highIdent] = String(feature.properties.designator ?? "").split("/");
  if (!lowIdent || !highIdent) return [];

  return [
    { ident: lowIdent, headingTrue: (bearing(low, high) + 360) % 360 },
    { ident: highIdent, headingTrue: (bearing(high, low) + 360) % 360 },
  ];
}

/** Loads once per session; every caller after the first awaits the same promise. */
export function loadRunwayIndex(): Promise<Map<string, RunwayEnd[]>> {
  cache ??= fetch("/data/runways.geojson")
    .then((response) => {
      if (!response.ok) throw new Error(`runways: HTTP ${response.status}`);
      return response.json() as Promise<{ features: RunwayFeature[] }>;
    })
    .then((collection) => {
      const index = new Map<string, RunwayEnd[]>();
      for (const feature of collection.features) {
        const airport = feature.properties.airport;
        if (!airport) continue;
        const ends = endsFrom(feature);
        if (ends.length === 0) continue;
        index.set(airport, [...(index.get(airport) ?? []), ...ends]);
      }
      return index;
    })
    .catch(() => {
      // A failure here costs the runway readout and nothing else, so it must
      // not take the weather bar down with it. Clearing the cache lets a later
      // focus change retry.
      cache = null;
      return new Map<string, RunwayEnd[]>();
    });

  return cache;
}
