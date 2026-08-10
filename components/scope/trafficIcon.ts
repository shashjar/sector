/**
 * The target symbol.
 *
 * Drawn at runtime rather than shipped as a file. A chevron is a dozen lines of
 * canvas, and generating it means the colours come from the same place as the
 * rest of the scope instead of being baked into an asset nobody can grep for.
 *
 * The shape is the radar convention: a triangle with a notched tail, pointing
 * along the aircraft's track. It reads as directional at sizes where a plain
 * triangle looks like a smudge.
 */

/** Logical size in CSS pixels; the bitmap is drawn at twice this for retina. */
const SIZE = 22;
const SCALE = 2;

export interface ChevronImage {
  id: string;
  data: ImageData;
  pixelRatio: number;
}

function drawChevron(fill: string, outline: string): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE * SCALE;
  canvas.height = SIZE * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable — cannot build target symbol");

  ctx.scale(SCALE, SCALE);
  ctx.translate(SIZE / 2, SIZE / 2);

  // Points north; MapLibre rotates it to the reported track.
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(6, 7);
  ctx.lineTo(0, 3.5);
  ctx.lineTo(-6, 7);
  ctx.closePath();

  // Outline first and wider, so the symbol survives both a bright sectional and
  // dark satellite imagery — the same reason the airport rings carry a halo.
  ctx.lineJoin = "round";
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = fill;
  ctx.fill();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export const TARGET_ICON = "target-chevron";
export const TARGET_ICON_SELECTED = "target-chevron-selected";

/**
 * Both target symbols.
 *
 * Two baked images rather than one recoloured at draw time: MapLibre can tint
 * an icon through `icon-color`, but only for signed-distance-field images, and
 * a true SDF for this shape is more machinery than two small bitmaps are worth.
 */
export function buildTargetIcons(): ChevronImage[] {
  return [
    { id: TARGET_ICON, data: drawChevron("#dce6f0", "#05080b"), pixelRatio: SCALE },
    {
      id: TARGET_ICON_SELECTED,
      data: drawChevron("#f0a202", "#05080b"),
      pixelRatio: SCALE,
    },
  ];
}
