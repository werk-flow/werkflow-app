'use client';

import type { ReactElement, RefObject } from 'react';
import { LinkIcon, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';

type ContextualDocumentsToolbarProps = {
  /** An existing library document can be attached to this record. */
  canAttach: boolean;
  emphasizeUpload: boolean;
  /** The upload dialog still downloads after the files were chosen. */
  uploadPending: boolean;
  /** The attach dialog still downloads after the press. */
  attachPending: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onAttach: () => void;
  onFilesSelected: (files: FileList | null) => void;
};

/** Attach and upload controls in the header of a contextual document list. */
export function ContextualDocumentsToolbar({
  canAttach,
  emphasizeUpload,
  uploadPending,
  attachPending,
  fileInputRef,
  onAttach,
  onFilesSelected,
}: ContextualDocumentsToolbarProps): ReactElement {
  return (
    <>
      {canAttach && (
        <Button type="button" size="sm" variant="outline" pending={attachPending} onClick={onAttach}>
          <LinkIcon className="size-4" />
          Verknüpfen
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant={emphasizeUpload ? 'default' : 'outline'}
        className={emphasizeUpload ? undefined : 'min-h-11'}
        pending={uploadPending}
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
        onChange={(event) => {
          onFilesSelected(event.target.files);
          // The same files chosen again, after a dialog that failed to download, still open it.
          event.target.value = '';
        }}
      />
    </>
  );
}
