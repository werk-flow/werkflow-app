'use client';

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FileInput } from '@/components/ui/file-input';

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

/**
 * The drawn mark on the pad's own background. The stroke takes the theme's
 * text color, so a transparent image drawn in dark mode would vanish on a
 * light page; with its background it reads in both themes.
 */
function signatureImage(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const image = document.createElement('canvas');
  image.width = canvas.width;
  image.height = canvas.height;
  const context = image.getContext('2d');
  if (!context) return canvas;
  context.fillStyle = getComputedStyle(canvas).backgroundColor;
  context.fillRect(0, 0, image.width, image.height);
  context.drawImage(canvas, 0, 0);
  return image;
}

type SignaturePadProps = {
  disabled?: boolean;
  onChange: (file: File | null) => void;
};

/**
 * The drawing on the pad: pointer strokes, the mark state, the sized canvas,
 * and the drawn image handed to `onChange` when a stroke ends.
 */
function useSignatureDrawing(disabled: boolean | undefined, onChange: (file: File | null) => void) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasMarkRef = useRef(false);
  const [hasMark, setHasMark] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // A resize keeps a drawn mark (the snapshot) and resets only an empty pad,
    // so a chosen image stays the signature.
    return observeSignatureCanvasSize(canvas, hasMarkRef, () => {
      hasMarkRef.current = false;
      setHasMark(false);
    });
  }, []);

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
    // A tap that drew nothing leaves the signature as it was, a chosen image included.
    if (!hasMarkRef.current) return;
    signatureImage(event.currentTarget).toBlob((blob) => {
      onChange(blob ? new File([blob], 'Unterschrift.png', { type: 'image/png' }) : null);
    }, 'image/png');
  }

  /** Erases the drawn mark. */
  function eraseMark() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    hasMarkRef.current = false;
    setHasMark(false);
  }

  const canvasProps = {
    ref: canvasRef,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
  };
  return { canvasProps, hasMark, eraseMark };
}

export function SignaturePad({ disabled, onChange }: SignaturePadProps) {
  const { canvasProps, hasMark, eraseMark } = useSignatureDrawing(disabled, onChange);
  // The chosen image, until a drawn mark or a reset replaces it.
  const [imageName, setImageName] = useState<string | null>(null);
  // A drawn mark replaces the chosen image.
  if (hasMark && imageName) setImageName(null);

  function clear() {
    eraseMark();
    setImageName(null);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <canvas
        {...canvasProps}
        className="h-36 w-full touch-none rounded-md border bg-background text-foreground"
        aria-label="Unterschrift zeichnen"
        aria-describedby="artifact-signature-hint"
      />
      <p id="artifact-signature-hint" className="text-xs text-muted-foreground">
        Ohne Zeigegerät kannst du unten stattdessen ein Bild der Unterschrift auswählen.
      </p>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={disabled || !(hasMark || imageName)}
        >
          Zurücksetzen
        </Button>
      </div>
      <SignatureImageField
        disabled={disabled}
        imageName={imageName}
        onImage={(file) => {
          // The chosen image replaces a drawn mark, so the pad shows what is saved.
          eraseMark();
          setImageName(file.name);
          onChange(file);
        }}
      />
    </div>
  );
}

/** The file alternative to drawing; only an image file becomes the signature, a cancelled choice changes nothing. */
function SignatureImageField({
  disabled,
  imageName,
  onImage,
}: {
  disabled: boolean | undefined;
  imageName: string | null;
  onImage: (file: File) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Field label="Oder Unterschrift als Bild auswählen" htmlFor="artifact-signature-upload" error={error}>
      <FileInput
        buttonLabel="Bild auswählen"
        fileName={imageName}
        accept="image/*"
        disabled={disabled}
        onSelect={(file) => {
          if (!file) return;
          if (!file.type.startsWith('image/')) {
            setError('Bitte wähle eine Bilddatei aus.');
            return;
          }
          setError(null);
          onImage(file);
        }}
      />
    </Field>
  );
}
