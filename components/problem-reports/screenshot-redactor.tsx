'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';

import {
  boxFromDrag,
  drawRedacted,
  imagePoint,
  type ImagePoint,
  type RedactionBox,
} from '@/lib/problem-reports/redaction';
import { cn } from '@/lib/utils';

type ScreenshotRedactorProps = {
  image: ImageBitmap;
  boxes: readonly RedactionBox[];
  onBoxesChange: (boxes: RedactionBox[]) => void;
  /** While sending, and once the image left the device, no box can be drawn. */
  disabled: boolean;
  /** The accessible name, which tells the dialog's preview from the large view. */
  label: string;
  /**
   * The drawn size in CSS pixels, with the image's proportions; without it the
   * preview fits the dialog's width and at most 60 % of the window's height.
   */
  size?: { width: number; height: number };
};

/**
 * The screenshot preview, on which a drag with the finger or the mouse draws
 * a covered box. The canvas holds the image at its full size and the browser
 * only scales it for display; a pointer is read as a fraction of the canvas's
 * drawn box, so a box lands on the same area of the image at any display size.
 * The preview shows exactly what the upload will hold.
 */
export function ScreenshotRedactor({
  image,
  boxes,
  onBoxesChange,
  disabled,
  label,
  size,
}: ScreenshotRedactorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStart = useRef<ImagePoint | null>(null);
  const [draft, setDraft] = useState<RedactionBox | null>(null);

  useEffect(() => {
    if (canvasRef.current) drawRedacted(canvasRef.current, image, draft ? [...boxes, draft] : boxes);
  }, [image, boxes, draft]);

  // The image fills the canvas's content box, inside its border.
  const pointOf = (event: PointerEvent<HTMLCanvasElement>): ImagePoint => {
    const canvas = event.currentTarget;
    const box = canvas.getBoundingClientRect();
    return imagePoint(
      { x: event.clientX, y: event.clientY },
      {
        left: box.left + canvas.clientLeft,
        top: box.top + canvas.clientTop,
        width: box.width - 2 * canvas.clientLeft,
        height: box.height - 2 * canvas.clientTop,
      },
    );
  };

  const endDrag = (event: PointerEvent<HTMLCanvasElement>): void => {
    const start = dragStart.current;
    dragStart.current = null;
    setDraft(null);
    if (!start) return;
    const box = boxFromDrag(start, pointOf(event));
    if (box) onBoxesChange([...boxes, box]);
  };

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      style={size}
      className={cn(
        'block touch-none rounded-md border',
        !size && 'mx-auto h-auto max-h-[60dvh] w-auto max-w-full',
        disabled ? 'opacity-70' : 'cursor-crosshair',
      )}
      onPointerDown={(event) => {
        if (disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragStart.current = pointOf(event);
      }}
      onPointerMove={(event) => {
        const start = dragStart.current;
        if (start) setDraft(boxFromDrag(start, pointOf(event)));
      }}
      onPointerUp={endDrag}
      onPointerCancel={() => {
        dragStart.current = null;
        setDraft(null);
      }}
    />
  );
}
