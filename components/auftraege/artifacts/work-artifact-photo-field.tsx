'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, ImageOff, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import type { DraftPhoto } from '@/lib/field-sync/device/draft-store';
import { PHOTO_CONTROL_ID, type WorkArtifactDeviceDraft } from './use-work-artifact-device-draft';

/** The photo's own bytes as an image the browser could decode, `failed` when it could not, null while it decodes. */
function usePhotoPreview(blob: Blob): string | 'failed' | null {
  const [preview, setPreview] = useState<{ blob: Blob; url: string | 'failed' } | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => setPreview({ blob, url });
    image.onerror = () => setPreview({ blob, url: 'failed' });
    image.src = url;
    return () => {
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  return preview?.blob === blob ? preview.url : null;
}

/** A photo the device holds, shown from its own bytes. */
function PhotoTile({
  photo,
  position,
  onRemove,
}: {
  photo: DraftPhoto;
  position: number;
  onRemove: () => void;
}) {
  const preview = usePhotoPreview(photo.blob);
  return (
    <li className="relative flex aspect-square items-center justify-center overflow-hidden rounded-md border bg-muted">
      {preview === 'failed' ? (
        <span className="flex flex-col items-center gap-1 p-1 text-center text-xs text-muted-foreground">
          <ImageOff className="size-4" />
          Foto {position}: keine Vorschau
        </span>
      ) : (
        preview && (
          // eslint-disable-next-line @next/next/no-img-element -- an object URL of bytes on this device; next/image cannot load it
          <img src={preview} alt={`Foto ${position}`} className="size-full object-cover" />
        )
      )}
      <Button
        type="button"
        size="icon-sm"
        variant="secondary"
        aria-label={`Foto ${position} entfernen`}
        className="absolute top-1 right-1"
        onClick={onRemove}
      >
        <X className="size-4" />
      </Button>
    </li>
  );
}

/**
 * The photos of a new Arbeitsnachweis. The camera input stores each photo on the device at once;
 * the photos go to the job's documents when the draft is sent.
 */
export function WorkArtifactPhotoField({ deviceDraft }: { deviceDraft: WorkArtifactDeviceDraft }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { photos, photoError, deviceSaveError, addPhoto, removePhoto } = deviceDraft;
  return (
    <div className="space-y-2">
      <Field
        label="Fotos"
        htmlFor={PHOTO_CONTROL_ID}
        description="Die Fotos bleiben auf diesem Gerät, bis der Entwurf übertragen ist."
        error={photoError}
      >
        <div className="space-y-3">
          {photos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {photos.map((photo, index) => (
                <PhotoTile
                  key={photo.id}
                  photo={photo}
                  position={index + 1}
                  onRemove={() => void removePhoto(photo.id)}
                />
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="outline"
            id={PHOTO_CONTROL_ID}
            className="min-h-11"
            onClick={() => inputRef.current?.click()}
          >
            <Camera className="size-4" />
            Foto aufnehmen
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            data-testid="artifact-photo-input"
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Taking a photo with the same file name again must fire again.
              event.target.value = '';
              if (file) void addPhoto(file);
            }}
          />
        </div>
      </Field>
      <ErrorText>{deviceSaveError}</ErrorText>
    </div>
  );
}
