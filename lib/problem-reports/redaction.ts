// Redaction boxes on a report screenshot. The person draws boxes over the
// preview; before the upload they are burned into the pixels, so the stored
// image holds black where the boxes were and nothing underneath.

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

/** Draws the image and every box in black over it, at the canvas's own size. */
export function drawRedacted(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource & { width: number; height: number },
  boxes: readonly RedactionBox[],
): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The device cannot draw the screenshot.');
  canvas.width = image.width;
  canvas.height = image.height;
  context.drawImage(image, 0, 0);
  // The fill is pure black on purpose: no theme colour, no transparency, so
  // nothing underneath survives the burn.
  context.fillStyle = 'black';
  for (const box of boxes) {
    context.fillRect(
      Math.floor(box.x * image.width),
      Math.floor(box.y * image.height),
      Math.ceil(box.width * image.width) + 1,
      Math.ceil(box.height * image.height) + 1,
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
