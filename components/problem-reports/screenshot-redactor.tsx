'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';

import {
  boxFromDrag,
  drawRedacted,
  imagePoint,
  type ImagePoint,
  type RedactionBox,
} from '@/lib/problem-reports/redaction';

type ScreenshotRedactorProps = {
  image: ImageBitmap;
  boxes: readonly RedactionBox[];
  onBoxesChange: (boxes: RedactionBox[]) => void;
};

/**
 * The screenshot preview, on which a drag with the finger or the mouse draws
 * a black box. The preview shows exactly what the upload will hold.
 */
export function ScreenshotRedactor({ image, boxes, onBoxesChange }: ScreenshotRedactorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStart = useRef<ImagePoint | null>(null);
  const [draft, setDraft] = useState<RedactionBox | null>(null);

  useEffect(() => {
    if (canvasRef.current) drawRedacted(canvasRef.current, image, draft ? [...boxes, draft] : boxes);
  }, [image, boxes, draft]);

  const pointOf = (event: PointerEvent<HTMLCanvasElement>): ImagePoint =>
    imagePoint({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect());

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
      aria-label="Vorschau des Screenshots mit deinen Schwärzungen"
      className="mx-auto block h-auto max-h-[60dvh] w-auto max-w-full cursor-crosshair touch-none rounded-md border"
      onPointerDown={(event) => {
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
