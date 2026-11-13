'use client';

import { useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { RedactionBox } from '@/lib/problem-reports/redaction';
import { ScreenshotRedactor } from './screenshot-redactor';

const LARGE_SCREENSHOT_LABEL = 'Großer Screenshot mit deinen Schwärzungen';

type ScreenshotRedactionViewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  image: ImageBitmap;
  boxes: readonly RedactionBox[];
  onBoxesChange: (boxes: RedactionBox[]) => void;
  disabled: boolean;
  fieldWorker: boolean;
};

/**
 * The screenshot as large as the window allows, over the report dialog, so a
 * box covers a detail precisely on a laptop too. It edits the dialog's own
 * boxes: nothing here sends or keeps an image.
 */
export function ScreenshotRedactionView({
  open,
  onOpenChange,
  image,
  boxes,
  onBoxesChange,
  disabled,
  fieldWorker,
}: ScreenshotRedactionViewProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Focus starts on the view itself: on its first button, one Enter would remove a box. */}
      <DialogContent
        size="window"
        workspace
        initialFocus="dialog"
        data-field-worker={fieldWorker ? '' : undefined}
      >
        <DialogHeader>
          <DialogTitle>Screenshot schwärzen</DialogTitle>
          <DialogDescription>
            Ziehe mit dem Finger oder der Maus Rechtecke über alles, was niemand sehen soll.
          </DialogDescription>
        </DialogHeader>
        <FittedScreenshot
          image={image}
          boxes={boxes}
          onBoxesChange={onBoxesChange}
          disabled={disabled}
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {boxes.length > 0 && !disabled && (
            <>
              <Button type="button" variant="outline" onClick={() => onBoxesChange(boxes.slice(0, -1))}>
                Rückgängig
              </Button>
              <Button type="button" variant="outline" onClick={() => onBoxesChange([])}>
                Alle entfernen
              </Button>
            </>
          )}
          <Button type="button" onClick={() => onOpenChange(false)}>
            Fertig
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type FittedScreenshotProps = Omit<ScreenshotRedactionViewProps, 'open' | 'onOpenChange' | 'fieldWorker'>;

/** Fills the space between header and buttons with the image, in its own proportions. */
function FittedScreenshot({ image, ...redactor }: FittedScreenshotProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const fit = (): void => {
      const scale = Math.min(area.clientWidth / image.width, area.clientHeight / image.height);
      setSize(
        scale > 0
          ? { width: Math.floor(image.width * scale), height: Math.floor(image.height * scale) }
          : null,
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(area);
    return () => observer.disconnect();
  }, [image]);

  return (
    <div ref={areaRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      {size && <ScreenshotRedactor image={image} size={size} label={LARGE_SCREENSHOT_LABEL} {...redactor} />}
    </div>
  );
}
