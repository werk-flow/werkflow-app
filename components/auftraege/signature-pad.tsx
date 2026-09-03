'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';

export function SignaturePad({
  disabled,
  onChange,
}: {
  disabled?: boolean;
  onChange: (file: File | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasMarkRef = useRef(false);
  const [hasMark, setHasMark] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let previousWidth = 0;
    let previousHeight = 0;
    const applySize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height || (width === previousWidth && height === previousHeight)) return;
      const snapshot = hasMarkRef.current && previousWidth && previousHeight
        ? document.createElement('canvas')
        : null;
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
      hasMarkRef.current = false;
      setHasMark(false);
      onChange(null);
    };
    applySize();
    const observer = new ResizeObserver(applySize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [onChange]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const start = point(event);
    context.beginPath();
    context.moveTo(start.x, start.y);
    drawingRef.current = true;
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const next = point(event);
    context.lineTo(next.x, next.y);
    context.stroke();
    hasMarkRef.current = true;
    setHasMark(true);
  }

  function finish(event: React.PointerEvent<HTMLCanvasElement>) {
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
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={disabled || !hasMark}>
          Zurücksetzen
        </Button>
      </div>
      <Field label="Oder Unterschrift als Bild auswählen" htmlFor="artifact-signature-upload" error={uploadError}>
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
    </div>
  );
}
