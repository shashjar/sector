import type { StyleSpecification } from "maplibre-gl";

/**
 * Ground layers the scope can draw on.
 *
 * All three raster sources happen to share the ArcGIS fused-map-cache
 * convention — `/tile/{z}/{y}/{x}` in Web Mercator at 256px, note the row
 * before the column, reversed from the usual XYZ ordering.
 */
export type BasemapId = "sectional" | "satellite" | "street";

export interface Basemap {
  id: BasemapId;
  label: string;
  hint: string;
  tiles: string;
  minZoom?: number;
  maxZoom?: number;
  attribution?: string;
  dim: { opacity: number; saturation: number };
  /**
   * True when the basemap already draws runway geometry itself.
   *
   * Scoped to runways deliberately. A sectional draws runways, so ours would
   * double-image on top of them — but it knows nothing about current weather or
   * which fields have a live ATC feed, so the airport dots stay in every mode.
   */
  drawsOwnRunways: boolean;
}

const ARCGIS_ONLINE = "https://services.arcgisonline.com/ArcGIS/rest/services";
const FAA_CHARTS = "https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services";

export const BASEMAPS: Record<BasemapId, Basemap> = {
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
    drawsOwnRunways: true,
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
    drawsOwnRunways: false,
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
    drawsOwnRunways: false,
  },
};

/** Ordered from the aviation reference outward to general-purpose maps. */
export const BASEMAP_ORDER: BasemapId[] = ["sectional", "satellite", "street"];
export const DEFAULT_BASEMAP: BasemapId = "sectional";

const VOID = "#05080b";

export function isBasemapId(value: string): value is BasemapId {
  return value in BASEMAPS;
}

/**
 * Build the MapLibre style for a basemap.
 */
export function buildStyle(basemap: Basemap): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    glyphs: "/fonts/{fontstack}/{range}.pbf",
    sources: {},
    layers: [
      {
        id: "ground",
        type: "background",
        paint: { "background-color": VOID },
      },
    ],
  };

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

  return style;
}
