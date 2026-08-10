import type { ExpressionSpecification } from "maplibre-gl";
import type { LayerProps } from "react-map-gl/maplibre";

import { AIRPORTS_WITH_FEEDS } from "@/lib/feeds";

import { TARGET_ICON } from "./trafficIcon";

/**
 * Map layer definitions for Sector's own data.
 */
const RUNWAY = "#c2cede";
const AIRPORT_RING = "#c8d3dd"; // --text
const HALO = "#070a0e"; // --bg
const LABEL = "#e4ecf3";
const TARGET_LABEL = "#dce6f0";
const ACCENT = "#f0a202"; // --accent

/**
 * Flight-category colours, matching --vfr/--mvfr/--ifr/--lifr.
 */
const CATEGORY_COLOR: ExpressionSpecification = [
  "match",
  ["coalesce", ["feature-state", "category"], "NONE"],
  "VFR",
  "#3fb950",
  "MVFR",
  "#58a6ff",
  "IFR",
  "#f85149",
  "LIFR",
  "#d2a8ff",
  // Airports with no station, or a station that has not reported, keep the
  // neutral ring.
  AIRPORT_RING,
];

export const AIRPORT_SOURCE = "airports";
export const RUNWAY_SOURCE = "runways";
export const AIRPORT_LAYER = "airport-rings";

/**
 * Marker size in pixels. Independent of airport size on purpose.
 */
const RING_RADIUS: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 6, 3, 12, 7, 16, 12];

/**
 * Which airports are visible at which zoom, at a given peak opacity.
 */
const ringOpacity = (peak: number): ExpressionSpecification => [
  "step",
  ["zoom"],
  ["match", ["get", "size"], "large", peak, 0],
  7,
  ["match", ["get", "size"], ["large", "medium"], peak, 0],
  9,
  peak,
];

/** Towered fields read heavier: that is where a controller is, and where there is something to hear. */
const RING_WIDTH: ExpressionSpecification = ["case", ["get", "hasTower"], 2, 1.4];

/**
 * Runway centerlines.
 */
export function runwayLayer(visible: boolean): LayerProps {
  return {
    id: "runway-lines",
    type: "line",
    source: RUNWAY_SOURCE,
    minzoom: 10,
    layout: {
      "line-cap": "butt",
      visibility: visible ? "visible" : "none",
    },
    paint: {
      "line-color": RUNWAY,
      "line-opacity": 0.85,
      "line-width": [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        10,
        0.6,
        16,
        14,
      ],
    },
  };
}

/**
 * A dark ring drawn underneath the marker.
 */
export const airportRingHaloLayer: LayerProps = {
  id: "airport-ring-halo",
  type: "circle",
  source: AIRPORT_SOURCE,
  paint: {
    "circle-color": "rgba(0,0,0,0)",
    "circle-stroke-color": HALO,
    "circle-stroke-width": ["+", RING_WIDTH, 2] as ExpressionSpecification,
    "circle-radius": RING_RADIUS,
    "circle-stroke-opacity": ringOpacity(0.55),
  },
};

/**
 * Airport markers.
 */
export const airportRingLayer: LayerProps = {
  id: AIRPORT_LAYER,
  type: "circle",
  source: AIRPORT_SOURCE,
  paint: {
    "circle-color": "rgba(0,0,0,0)",
    "circle-stroke-color": CATEGORY_COLOR,
    "circle-stroke-width": RING_WIDTH,
    "circle-radius": RING_RADIUS,
    "circle-stroke-opacity": ringOpacity(1),
  },
};

/**
 * Airport identifiers.
 */
export const airportLabelLayer: LayerProps = {
  id: "airport-labels",
  type: "symbol",
  source: AIRPORT_SOURCE,
  minzoom: 9,
  layout: {
    "text-field": ["get", "ident"],
    "text-font": ["Noto Sans Bold"],
    "text-size": ["interpolate", ["linear"], ["zoom"], 9, 10, 14, 12],
    "text-offset": [0, 1.1],
    "text-anchor": "top",
    "text-padding": 4,
  },
  paint: {
    "text-color": LABEL,
    "text-halo-color": HALO,
    "text-halo-width": 1.4,
    "text-halo-blur": 0.2,
  },
};

export const TRAFFIC_SOURCE = "traffic";
export const TRAFFIC_LAYER = "traffic-targets";

/**
 * Aircraft.
 */
export const trafficLayer: LayerProps = {
  id: TRAFFIC_LAYER,
  type: "symbol",
  source: TRAFFIC_SOURCE,
  layout: {
    "icon-image": TARGET_ICON,
    "icon-rotate": ["get", "track"],
    "icon-rotation-alignment": "map",
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
    "icon-size": ["interpolate", ["linear"], ["zoom"], 7, 0.6, 12, 0.85, 16, 1.1],
  },
  paint: {
    "icon-opacity": ["get", "freshness"],
  },
};

/**
 * Aircraft data blocks.
 */
export const trafficLabelLayer: LayerProps = {
  id: "traffic-labels",
  type: "symbol",
  source: TRAFFIC_SOURCE,
  minzoom: 9,
  layout: {
    "text-field": [
      "format",
      ["get", "primary"],
      {},
      ["get", "trend"],
      { "font-scale": 1.45 },
      ["get", "secondary"],
      {},
    ],
    "text-font": ["Noto Sans Bold"],
    "text-size": 10,
    "text-offset": [1.1, 0],
    "text-anchor": "left",
    "text-justify": "left",
    "text-padding": 3,
    "text-line-height": 1.15,
    "text-optional": true,
  },
  paint: {
    "text-color": TARGET_LABEL,
    "text-halo-color": HALO,
    "text-halo-width": 1.5,
    "text-opacity": ["get", "freshness"],
  },
};

/**
 * Which airports have a feed.
 */
export const feedBadgeLayer: LayerProps = {
  id: "airport-feed-badge",
  type: "circle",
  source: AIRPORT_SOURCE,
  minzoom: 7,
  filter: ["in", ["get", "ident"], ["literal", AIRPORTS_WITH_FEEDS]],
  paint: {
    "circle-color": ACCENT,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 1.6, 12, 2.6, 16, 4],
    "circle-stroke-color": HALO,
    "circle-stroke-width": 1,
  },
};
