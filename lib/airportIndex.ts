/**
 * Airport positions, indexed by identifier.
 *
 * The map loads this same file on every basemap, so the fetch is a cache hit.
 */

let cache: Promise<Map<string, [number, number]>> | null = null;

interface AirportFeature {
  geometry: { type: string; coordinates: [number, number] };
  properties: { ident?: string };
}

export function loadAirportPositions(): Promise<Map<string, [number, number]>> {
  cache ??= fetch("/data/airports.geojson")
    .then((response) => {
      if (!response.ok) throw new Error(`airports: HTTP ${response.status}`);
      return response.json() as Promise<{ features: AirportFeature[] }>;
    })
    .then((collection) => {
      const index = new Map<string, [number, number]>();
      for (const feature of collection.features) {
        const ident = feature.properties.ident;
        if (!ident || feature.geometry.type !== "Point") continue;
        index.set(ident, feature.geometry.coordinates);
      }
      return index;
    })
    .catch(() => {
      cache = null;
      return new Map<string, [number, number]>();
    });

  return cache;
}
