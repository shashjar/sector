import type { ExpressionSpecification } from "maplibre-gl";
import type { LayerProps } from "react-map-gl/maplibre";

import { TARGET_ICON } from "./trafficIcon";

/**
 * Map layer definitions for Sector's own data.
 *
 * Colours are literals rather than CSS variables because a MapLibre style is
 * data, not a stylesheet — it never sees the cascade. These mirror the tokens
 * in app/globals.css and must be kept in step with them by hand.
 */
const RUNWAY = "#c2cede";
const AIRPORT_RING = "#c8d3dd"; // --text
const HALO = "#070a0e"; // --bg
const LABEL = "#e4ecf3";
const TARGET_LABEL = "#dce6f0";

export const AIRPORT_SOURCE = "airports";
export const RUNWAY_SOURCE = "runways";
export const AIRPORT_LAYER = "airport-rings";

/**
 * Marker size in pixels. Independent of airport size on purpose — the ring
 * marks *where to look*, and scaling it by runway length would make small
 * fields, which is most of general aviation, the hardest ones to hit.
 */
const RING_RADIUS: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 6, 3, 12, 7, 16, 12];

/**
 * Which airports are visible at which zoom, at a given peak opacity.
 *
 * Opacity rather than a filter, because MapLibre filters cannot read zoom.
 * Below 7 only large fields; medium join at 7; everything at 9.
 *
 * This is a factory rather than one constant scaled arithmetically, because
 * MapLibre requires a "zoom" expression to be the outermost one — wrapping it
 * in a multiply produces a style the runtime rejects, and the layer then fails
 * to add with no visible symptom beyond nothing being drawn.
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
 * Runway centrelines.
 *
 * Hidden on the sectional, which draws its own — see `drawsOwnRunways`. Below
 * zoom 10 a runway is under a pixel long, so there is nothing to show.
 *
 * The exponential-2 interpolation is what keeps the line locked to the ground:
 * doubling width per zoom level matches the map's own scaling, so a runway
 * looks like a fixed physical width rather than growing or shrinking as you
 * zoom.
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
 *
 * The same trick as a text halo, and needed for the same reason: the basemap
 * underneath ranges from a bright sectional to dark satellite imagery, so a
 * single-colour ring is guaranteed to disappear against one of them. Two rings
 * — dark under light — read on any ground.
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
 *
 * A ring rather than a filled dot, drawn in every basemap mode. The sectional
 * already draws an airport symbol, so a solid dot would simply cover it — the
 * ring annotates what is there. The stroke colour is deliberately neutral
 * because it is reserved for flight category once weather lands, which is the
 * whole reason these markers exist: a 56-day chart cannot know today's
 * conditions, or which fields have a live feed.
 */
export const airportRingLayer: LayerProps = {
  id: AIRPORT_LAYER,
  type: "circle",
  source: AIRPORT_SOURCE,
  paint: {
    "circle-color": "rgba(0,0,0,0)",
    "circle-stroke-color": AIRPORT_RING,
    "circle-stroke-width": RING_WIDTH,
    "circle-radius": RING_RADIUS,
    "circle-stroke-opacity": ringOpacity(1),
  },
};

/**
 * Airport identifiers.
 *
 * `text-allow-overlap` stays at its default of false, which is the entire
 * reason this is a MapLibre symbol layer rather than hand-drawn: labels that
 * would collide are dropped automatically, and dense terminal areas stay
 * readable without any decluttering logic of our own.
 *
 * The halo is not decoration. A sectional is a bright, busy chart and pale text
 * on it is unreadable without one.
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
 *
 * `icon-rotate` is bound straight to the reported track and aligned to the map,
 * so a target points where it is actually going as the map rotates or tilts.
 * `icon-allow-overlap` is true because a target that vanishes because another
 * target is near it would be a lie about the traffic picture — and near-misses
 * are exactly when you most need to see both.
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
    // Targets fade as they go unheard rather than blinking out, so a receiver
    // dropping is visible as it happens.
    "icon-opacity": ["get", "freshness"],
  },
};

/**
 * Data blocks.
 *
 * Unlike the icons these *do* collide: overlapping blocks are unreadable, and
 * dropping one is better than printing two on top of each other. The symbol
 * stays regardless, so a target is never hidden — only its label.
 */
export const trafficLabelLayer: LayerProps = {
  id: "traffic-labels",
  type: "symbol",
  source: TRAFFIC_SOURCE,
  minzoom: 9,
  layout: {
    "text-field": ["get", "label"],
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
