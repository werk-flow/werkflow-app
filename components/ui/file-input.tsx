'use client';

import { useId, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { useFieldContext } from '@/components/ui/field';

type FileInputProps = {
  /** The button text that names what to choose, such as „Bild auswählen“. */
  buttonLabel: string;
  /** The chosen file's name, shown beside the button; null while none is chosen. */
  fileName: string | null;
  onSelect: (file: File | null) => void;
  accept?: string;
  disabled?: boolean | undefined;
};

/**
 * One file choice in German. The browser's own file input reads „Choose File
 * No file chosen“ in the browser's language, so it stays hidden: the button
 * opens it and the chosen file's name shows beside it. Inside a `Field` the
 * button carries the control id, so the label names it and an invalid submit
 * focuses it; its accessible name includes both the field label and button text.
 */
export function FileInput({ buttonLabel, fileName, onSelect, accept, disabled }: FileInputProps) {
  const field = useFieldContext();
  const textId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <Button
        type="button"
        variant="outline"
        // A field worker picks files on the phone: 44 px there, as every field target.
        className="h-11 sm:h-9"
        id={field?.controlId}
        aria-labelledby={field ? `${field.labelId} ${textId}` : undefined}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <span id={textId}>{buttonLabel}</span>
      </Button>
      {fileName && <span className="min-w-0 truncate text-sm text-muted-foreground">{fileName}</span>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          // Choosing the same file again after a reset must fire again.
          event.target.value = '';
          onSelect(file);
        }}
      />
    </div>
  );
}
