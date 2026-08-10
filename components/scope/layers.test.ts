import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { LayerProps } from "react-map-gl/maplibre";
import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";

import {
  AIRPORT_SOURCE,
  airportLabelLayer,
  airportRingHaloLayer,
  airportRingLayer,
  RUNWAY_SOURCE,
  runwayLayer,
} from "./layers";

/**
 * MapLibre validates layers at runtime and rejects invalid ones by firing an
 * error, not by throwing. A rejected layer simply never draws — which looks
 * exactly like a data problem, a zoom problem, or a colour that blends into the
 * basemap, and costs an hour to tell apart.
 *
 * This ran the real definitions through the same validator the runtime uses.
 * It exists because a nested zoom expression once shipped past both TypeScript
 * and the production build, and the only symptom was an empty map.
 */
function validate(layers: unknown[]) {
  const style = {
    version: 8,
    glyphs: "/fonts/{fontstack}/{range}.pbf",
    sources: {
      [AIRPORT_SOURCE]: { type: "geojson", data: "/data/airports.geojson" },
      [RUNWAY_SOURCE]: { type: "geojson", data: "/data/runways.geojson" },
    },
    layers,
  } as unknown as StyleSpecification;
  return validateStyleMin(style).map((error: { message: string }) => error.message);
}

/**
 * `LayerProps` is a union that includes custom WebGL layers, which have no
 * `layout`. Narrowing here keeps the assertions readable.
 */
const layoutOf = (layer: LayerProps): Record<string, unknown> | undefined =>
  (layer as { layout?: Record<string, unknown> }).layout;

describe("scope layers", () => {
  it("produces a style MapLibre accepts", () => {
    expect(
      validate([
        runwayLayer(true),
        airportRingHaloLayer,
        airportRingLayer,
        airportLabelLayer,
      ]),
    ).toEqual([]);
  });

  it("stays valid with runways hidden on the sectional", () => {
    expect(validate([runwayLayer(false)])).toEqual([]);
  });

  it("hides runways only when the basemap draws its own", () => {
    expect(layoutOf(runwayLayer(true))).toMatchObject({ visibility: "visible" });
    expect(layoutOf(runwayLayer(false))).toMatchObject({ visibility: "none" });
  });

  it("rejects a zoom expression nested inside arithmetic", () => {
    // The exact mistake this suite exists to catch: MapLibre requires "zoom" to
    // be the outermost expression, so scaling a zoom-driven value by a constant
    // is invalid however reasonable it looks.
    const errors = validate([
      {
        id: "nested-zoom",
        type: "circle",
        source: AIRPORT_SOURCE,
        paint: {
          "circle-stroke-opacity": ["*", ["step", ["zoom"], 0, 9, 1], 0.55],
        },
      },
    ]);
    expect(errors.join(" ")).toContain("zoom");
  });

  it("labels every airport by its identifier", () => {
    expect(layoutOf(airportLabelLayer)).toMatchObject({
      "text-field": ["get", "ident"],
      // Must match a directory under public/fonts, or no text renders at all.
      "text-font": ["Noto Sans Bold"],
    });
  });
});
