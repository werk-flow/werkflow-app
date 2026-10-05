'use client';

import type { ReactElement, RefObject } from 'react';
import { LinkIcon, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';

type ContextualDocumentsToolbarProps = {
  /** An existing library document can be attached to this record. */
  canAttach: boolean;
  emphasizeUpload: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onAttach: () => void;
  onFilesSelected: (files: FileList | null) => void;
};

/** Attach and upload controls in the header of a contextual document list. */
export function ContextualDocumentsToolbar({
  canAttach,
  emphasizeUpload,
  fileInputRef,
  onAttach,
  onFilesSelected,
}: ContextualDocumentsToolbarProps): ReactElement {
  return (
    <>
      {canAttach && (
        <Button type="button" size="sm" variant="outline" onClick={onAttach}>
          <LinkIcon className="size-4" />
          Verknüpfen
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant={emphasizeUpload ? 'default' : 'outline'}
        className={emphasizeUpload ? undefined : 'min-h-11'}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="size-4" />
        Hochladen
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        data-testid="document-upload-input"
        multiple
        className="hidden"
        onChange={(event) => onFilesSelected(event.target.files)}
      />
    </>
  );
}
