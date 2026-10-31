'use client';

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';

/**
 * Sizes the canvas to its box at the device pixel ratio and keeps it sized. A resize keeps the
 * drawn mark; a first sizing without a mark resets the pad through `onReset`.
 */
function observeSignatureCanvasSize(
  canvas: HTMLCanvasElement,
  hasMarkRef: RefObject<boolean>,
  onReset: () => void,
): () => void {
  let [previousWidth, previousHeight] = [0, 0];
  const applySize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height || (width === previousWidth && height === previousHeight)) return;
    const snapshot =
      hasMarkRef.current && previousWidth && previousHeight ? document.createElement('canvas') : null;
    if (snapshot) {
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.getContext('2d')?.drawImage(canvas, 0, 0);
    }
    previousWidth = width;
    previousHeight = height;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 2;
    context.strokeStyle = getComputedStyle(canvas).color;
    if (snapshot) {
      context.drawImage(snapshot, 0, 0, snapshot.width, snapshot.height, 0, 0, width, height);
      return;
    }
    onReset();
  };
  applySize();
  const observer = new ResizeObserver(applySize);
  observer.observe(canvas);
  return () => observer.disconnect();
}

function canvasPoint(event: PointerEvent<HTMLCanvasElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

/** Captures the pointer and starts a stroke at it; false when the canvas has no 2D context. */
function beginStroke(event: PointerEvent<HTMLCanvasElement>): boolean {
  event.currentTarget.setPointerCapture(event.pointerId);
  const context = event.currentTarget.getContext('2d');
  if (!context) return false;
  const start = canvasPoint(event);
  context.beginPath();
  context.moveTo(start.x, start.y);
  return true;
}

/** Draws the stroke on to the pointer; false when the canvas has no 2D context. */
function extendStroke(event: PointerEvent<HTMLCanvasElement>): boolean {
  const context = event.currentTarget.getContext('2d');
  if (!context) return false;
  const next = canvasPoint(event);
  context.lineTo(next.x, next.y);
  context.stroke();
  return true;
}

type SignaturePadProps = {
  disabled?: boolean;
  onChange: (file: File | null) => void;
};

export function SignaturePad({ disabled, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasMarkRef = useRef(false);
  const [hasMark, setHasMark] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return observeSignatureCanvasSize(canvas, hasMarkRef, () => {
      hasMarkRef.current = false;
      setHasMark(false);
      onChange(null);
    });
  }, [onChange]);

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    if (beginStroke(event)) drawingRef.current = true;
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) return;
    if (!extendStroke(event)) return;
    hasMarkRef.current = true;
    setHasMark(true);
  }

  function finish(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!hasMarkRef.current) {
      onChange(null);
      return;
    }
    event.currentTarget.toBlob((blob) => {
      onChange(blob ? new File([blob], 'Unterschrift.png', { type: 'image/png' }) : null);
    }, 'image/png');
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    hasMarkRef.current = false;
    setHasMark(false);
    setUploadError(null);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        className="h-36 w-full touch-none rounded-md border bg-background text-foreground"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        aria-label="Unterschrift zeichnen"
        aria-describedby="artifact-signature-hint"
      />
      <p id="artifact-signature-hint" className="text-xs text-muted-foreground">
        Ohne Zeigegerät kannst du unten stattdessen ein Bild der Unterschrift auswählen.
      </p>
      <div className="flex justify-end">
        {/* eslint-disable-next-line ui/action-disabled-only-while-pending -- availability: an empty pad has nothing to reset */}
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={disabled || !hasMark}>
          Zurücksetzen
        </Button>
      </div>
      <SignatureImageField
        disabled={disabled}
        uploadError={uploadError}
        setUploadError={setUploadError}
        onChange={onChange}
      />
    </div>
  );
}

/** The file alternative to drawing; only an image file becomes the signature. */
function SignatureImageField({
  disabled,
  uploadError,
  setUploadError,
  onChange,
}: {
  disabled: boolean | undefined;
  uploadError: string | null;
  setUploadError: (message: string | null) => void;
  onChange: (file: File | null) => void;
}) {
  return (
    <Field
      label="Oder Unterschrift als Bild auswählen"
      htmlFor="artifact-signature-upload"
      error={uploadError}
    >
      <Input
        type="file"
        accept="image/*"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          if (file && !file.type.startsWith('image/')) {
            setUploadError('Bitte wähle eine Bilddatei aus.');
            event.target.value = '';
            onChange(null);
            return;
          }
          setUploadError(null);
          onChange(file);
        }}
      />
    </Field>
  );
}
