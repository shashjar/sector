/**
 * Airport positions, indexed by identifier.
 *
 * Same reasoning as the runway index: this is a data question, so it reads the
 * file rather than the map. Asking the map means asking what happens to be
 * drawn inside the current viewport, and the tuned field is frequently off
 * screen — you tune San Carlos and then pan up the peninsula to watch the
 * arrivals. The candidate set has to keep measuring from the field the whole
 * time.
 *
 * The map loads this same file on every basemap, so the fetch is a cache hit.
 */

let cache: Promise<Map<string, [number, number]>> | null = null;

interface AirportFeature {
  geometry: { type: string; coordinates: [number, number] };
  properties: { ident?: string };
}

/** Loads once per session; every caller after the first awaits the same promise. */
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
      // Without positions the candidate set simply keeps every tracked aircraft
      // instead of the ones near the field. Degraded, not broken — so clear the
      // cache and let the next tune try again.
      cache = null;
      return new Map<string, [number, number]>();
    });

  return cache;
}
