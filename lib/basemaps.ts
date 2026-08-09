import type { StyleSpecification } from "maplibre-gl";

/**
 * Ground layers the scope can draw on.
 *
 * All four raster sources happen to share the ArcGIS fused-map-cache
 * convention — `/tile/{z}/{y}/{x}` in Web Mercator at 256px, note the row
 * before the column, reversed from the usual XYZ ordering. That is why
 * supporting four basemaps is four entries in a table rather than four
 * integrations: none needs a key, a signup, or a provider SDK.
 */
export type BasemapId = "chart" | "sectional" | "satellite" | "street";

export interface Basemap {
  id: BasemapId;
  label: string;
  /** Shown in the switcher; says what the mode is *for*, not what it is. */
  hint: string;
  /** Absent for `chart`, which draws on bare ground. */
  tiles?: string;
  minZoom?: number;
  maxZoom?: number;
  attribution?: string;
  /**
   * How far the basemap is pushed back so overlaid data stays readable.
   *
   * Implemented as opacity over the void ground plus desaturation, rather than
   * a separate scrim layer — the raster paint properties are GPU-native and one
   * fewer layer to keep ordered. Brighter and busier basemaps get pushed back
   * harder: a street map is nearly white and would swallow amber chevrons whole.
   */
  dim: { opacity: number; saturation: number };
  /**
   * True when the basemap already draws airports and runways itself. Sector
   * suppresses its own airport symbology in those modes rather than
   * double-drawing on top of the chart's.
   */
  drawsOwnAirports: boolean;
}

const ARCGIS_ONLINE = "https://services.arcgisonline.com/ArcGIS/rest/services";
const FAA_CHARTS = "https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services";

export const BASEMAPS: Record<BasemapId, Basemap> = {
  chart: {
    id: "chart",
    label: "Chart",
    hint: "Bare ground. Maximum contrast for traffic and weather.",
    // Deliberately sourceless. Chart mode is the void plus Sector's own
    // symbology, which is what makes it a scope rather than a map — and until
    // the airport, runway, and traffic layers exist there is genuinely nothing
    // to draw on it.
    dim: { opacity: 1, saturation: 0 },
    drawsOwnAirports: false,
  },

  sectional: {
    id: "sectional",
    label: "Sectional",
    hint: "The VFR chart pilots navigate by. Airspace, terrain, obstacles.",
    tiles: `${FAA_CHARTS}/VFR_Sectional/MapServer/tile/{z}/{y}/{x}`,
    // Sectionals are drawn at 1:500,000 and the FAA publishes cache levels 8
    // through 12 — z13 and above return 404. Capping here makes MapLibre
    // upscale the z12 tile instead of requesting tiles that do not exist.
    minZoom: 0,
    maxZoom: 12,
    attribution: "VFR charts &copy; FAA Aeronautical Information Services",
    dim: { opacity: 0.72, saturation: -0.15 },
    drawsOwnAirports: true,
  },

  satellite: {
    id: "satellite",
    label: "Satellite",
    hint: "Visual references — VFR navigation follows highways and shorelines.",
    tiles: `${ARCGIS_ONLINE}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    minZoom: 0,
    maxZoom: 19,
    attribution: "Imagery &copy; Esri",
    dim: { opacity: 0.8, saturation: -0.1 },
    drawsOwnAirports: false,
  },
  street: {
    id: "street",
    label: "Street",
    hint: "Roads and place names, for orienting in unfamiliar country.",
    tiles: `${ARCGIS_ONLINE}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
    minZoom: 0,
    maxZoom: 19,
    attribution: "Street map &copy; Esri",
    dim: { opacity: 0.55, saturation: -0.4 },
    drawsOwnAirports: false,
  },
};

/** Ordered from Sector's own symbology outward to general-purpose reference. */
export const BASEMAP_ORDER: BasemapId[] = [
  "chart",
  "sectional",
  "satellite",
  "street",
];

/**
 * Sectional is the opening view.
 *
 * Chart mode has the better long-term claim — no network, no coverage limit,
 * most contrast for overlaid data — but it is bare ground until the airport,
 * runway, and traffic layers exist, and a black rectangle is a poor first
 * impression of an aviation tool. Sectional says what this is in one glance.
 *
 * Worth revisiting once traffic renders: the choice is between the mode that
 * is immediately legible and the one that is the product's signature.
 */
export const DEFAULT_BASEMAP: BasemapId = "sectional";

/** Matches `--scope-void`. Duplicated here because a style spec takes literals. */
const VOID = "#05080b";

export function isBasemapId(value: string): value is BasemapId {
  return value in BASEMAPS;
}

/**
 * Build the MapLibre style for a basemap.
 *
 * The ground layer is always painted, even under an opaque raster: it is what
 * the dimmed basemap composites against, and it is what shows through when
 * tiles are missing. That single decision is why an out-of-coverage sectional
 * degrades to the chart view on its own rather than to grey squares.
 */
export function buildStyle(basemap: Basemap): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [
      {
        id: "ground",
        type: "background",
        paint: { "background-color": VOID },
      },
    ],
  };

  if (basemap.tiles) {
    style.sources.basemap = {
      type: "raster",
      tiles: [basemap.tiles],
      tileSize: 256,
      minzoom: basemap.minZoom ?? 0,
      maxzoom: basemap.maxZoom ?? 19,
      attribution: basemap.attribution,
    };
    style.layers.push({
      id: "basemap",
      type: "raster",
      source: "basemap",
      paint: {
        "raster-opacity": basemap.dim.opacity,
        "raster-saturation": basemap.dim.saturation,
      },
    });
  }

  return style;
}
