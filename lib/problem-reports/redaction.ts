// Redaction boxes on a report screenshot. The person draws boxes over the
// preview; before the upload they are burned into the pixels, so the stored
// image holds the opaque cover where the boxes were and nothing underneath.

/** A box as fractions of the image's width and height, so it fits every preview size. */
export type RedactionBox = { x: number; y: number; width: number; height: number };

/** A point as fractions of the image, clamped into it. */
export type ImagePoint = { x: number; y: number };

const MIN_BOX_FRACTION = 0.005;

function clampFraction(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/** The point of a pointer position inside the preview's box. */
export function imagePoint(
  client: { x: number; y: number },
  preview: { left: number; top: number; width: number; height: number },
): ImagePoint {
  return {
    x: clampFraction((client.x - preview.left) / preview.width),
    y: clampFraction((client.y - preview.top) / preview.height),
  };
}

/** The box a drag spans, whichever corner it started at; null for a tap that spans almost nothing. */
export function boxFromDrag(start: ImagePoint, end: ImagePoint): RedactionBox | null {
  const box = {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
  return box.width < MIN_BOX_FRACTION || box.height < MIN_BOX_FRACTION ? null : box;
}

/**
 * The cover's two colours: the brand's deep and light purple, which keep their
 * values in both themes, so a box reads the same on a light and a dark page.
 */
const COVER_TOKENS = { base: '--brand-purple-deep', stripe: '--brand-purple-light' } as const;

/**
 * A token's value as an opaque canvas colour. The canvas reports an opaque
 * colour as `#rrggbb` and any other as `rgba(…)`; a token that is missing,
 * invalid or not fully opaque gives black, so the cover never lets the image
 * through, whatever the stylesheet holds.
 */
function opaqueToken(context: CanvasRenderingContext2D, name: string): string {
  context.fillStyle = 'black';
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (value) context.fillStyle = value;
  const drawn = context.fillStyle;
  return typeof drawn === 'string' && /^#[0-9a-f]{6}$/i.test(drawn) ? drawn : 'black';
}

/**
 * Covers one box: an opaque base over the whole box first, then diagonal
 * stripes on it, both at full opacity. The clip sits on whole pixels, so the
 * box's edges are hard; a stripe's smoothed edge mixes only the two cover
 * colours, never the image.
 */
function coverBox(
  context: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  colors: { base: string; stripe: string },
  period: number,
): void {
  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
  context.fillStyle = colors.base;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.fillStyle = colors.stripe;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  // A stripe is the band between the lines x + y = k·period and x + y = k·period + period / 2,
  // counted from the image's corner, so neighbouring boxes continue one pattern.
  const first = Math.floor((rect.x + top) / period) - 1;
  const last = Math.ceil((rect.x + rect.width + bottom) / period) + 1;
  context.beginPath();
  for (let k = first; k <= last; k += 1) {
    const start = k * period;
    const end = start + period / 2;
    context.moveTo(start - top, top);
    context.lineTo(end - top, top);
    context.lineTo(end - bottom, bottom);
    context.lineTo(start - bottom, bottom);
    context.closePath();
  }
  context.fill();
  context.restore();
}

/** Draws the image and every box covered over it, at the image's full size. */
export function drawRedacted(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource & { width: number; height: number },
  boxes: readonly RedactionBox[],
): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The device cannot draw the screenshot.');
  // Setting the size resets the context: full opacity, plain source-over drawing, no clip.
  canvas.width = image.width;
  canvas.height = image.height;
  context.drawImage(image, 0, 0);
  if (boxes.length === 0) return;
  const colors = { base: opaqueToken(context, COVER_TOKENS.base), stripe: opaqueToken(context, COVER_TOKENS.stripe) };
  const period = Math.max(12, Math.round(Math.max(image.width, image.height) / 64));
  for (const box of boxes) {
    coverBox(
      context,
      {
        x: Math.floor(box.x * image.width),
        y: Math.floor(box.y * image.height),
        width: Math.ceil(box.width * image.width) + 1,
        height: Math.ceil(box.height * image.height) + 1,
      },
      colors,
      period,
    );
  }
}

/** The screenshot with its boxes burned in, as a PNG at the image's full size. */
export async function burnRedactions(
  image: CanvasImageSource & { width: number; height: number },
  boxes: readonly RedactionBox[],
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  drawRedacted(canvas, image, boxes);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The device cannot encode the screenshot.'))),
      'image/png',
    ),
  );
}
