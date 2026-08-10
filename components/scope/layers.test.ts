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
  TRAFFIC_SOURCE,
  trafficLabelLayer,
  trafficLayer,
} from "./layers";

/**
 * MapLibre validates layers at runtime and rejects invalid ones by firing an
 * error, not by throwing. A rejected layer simply never draws.
 */
function validate(layers: unknown[]) {
  const style = {
    version: 8,
    glyphs: "/fonts/{fontstack}/{range}.pbf",
    sources: {
      [AIRPORT_SOURCE]: { type: "geojson", data: "/data/airports.geojson" },
      [RUNWAY_SOURCE]: { type: "geojson", data: "/data/runways.geojson" },
      [TRAFFIC_SOURCE]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers,
  } as unknown as StyleSpecification;
  return validateStyleMin(style).map((error: { message: string }) => error.message);
}

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

  it("accepts the traffic layers, including the formatted data block", () => {
    expect(validate([trafficLayer, trafficLabelLayer])).toEqual([]);
  });

  it("scales the vertical trend arrow above the digits beside it", () => {
    const field = layoutOf(trafficLabelLayer)?.["text-field"] as unknown[];
    expect(field[0]).toBe("format");
    expect(field).toContainEqual({ "font-scale": expect.any(Number) });
    const scale = field.find(
      (section): section is { "font-scale": number } =>
        typeof section === "object" && section !== null && "font-scale" in section,
    );
    expect(scale?.["font-scale"]).toBeGreaterThan(1);
  });

  it("stays valid with runways hidden on the sectional", () => {
    expect(validate([runwayLayer(false)])).toEqual([]);
  });

  it("hides runways only when the basemap draws its own", () => {
    expect(layoutOf(runwayLayer(true))).toMatchObject({ visibility: "visible" });
    expect(layoutOf(runwayLayer(false))).toMatchObject({ visibility: "none" });
  });

  it("rejects a zoom expression nested inside arithmetic", () => {
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
