import bearing from "@turf/bearing";

import type { RunwayEnd } from "./metar";

/**
 * Runway headings, indexed by airport.
 */

let cache: Promise<Map<string, RunwayEnd[]>> | null = null;

interface RunwayFeature {
  geometry: { type: string; coordinates: [number, number][] };
  properties: { airport?: string; designator?: string };
}

/**
 * Headings are derived from the drawn geometry rather than read from a field.
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
      cache = null;
      return new Map<string, RunwayEnd[]>();
    });

  return cache;
}
