'use client';

import { useEffect, useRef, useState } from 'react';

import { DOCUMENT_MAX_FILE_SIZE_BYTES } from '@/lib/documents/types';
import type { DraftPhoto, StoredDraft } from '@/lib/field-sync/device/draft-store';
import type { DraftSendOutcome } from '@/lib/field-sync/device/draft-sync';
import { logError } from '@/lib/logging';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { workArtifactFieldIssues } from '@/lib/work-artifacts/field-rules';
import { WORK_ARTIFACT_DRAFT_PHOTO_LIMIT } from '@/lib/work-artifacts/types';
import { noteDraftsOnDevice, type DraftDevice } from './use-device-drafts';
import type { WorkArtifactEditor } from './use-work-artifact-editor';
import { contentForKind, iso, savedContent } from './work-artifact-content';

/** The control id of the photo button: the field's label names it, and a refused photo focuses it. */
export const PHOTO_CONTROL_ID = 'artifact-photos';

type DeviceDraftOptions = {
  editor: WorkArtifactEditor;
  /** Null while the device code loads, when it failed, and for a target that keeps no drafts. */
  device: DraftDevice | null;
  /** The job of a new Arbeitsnachweis; null for anything the device keeps no draft of. */
  jobId: string | null;
  /** The id the new Arbeitsnachweis gets, on the device and on the server. */
  artifactId: string;
  /** The stored draft the dialog was opened with. */
  restored: StoredDraft | null;
};

type DraftChange = (current: StoredDraft | null) => StoredDraft | null;
/** What the device holds after a change, or `not_stored` when it refused the write. */
type DraftWrite = (change: DraftChange) => Promise<StoredDraft | null | 'not_stored'>;

/** Why a write to the device failed, in German. A full disk is the first cause on a phone with photos. */
function storageFailureMessage(error: unknown): string {
  return error instanceof DOMException && error.name === 'QuotaExceededError'
    ? 'Der Speicher dieses Geräts ist voll. Deine letzte Änderung ist nicht auf dem Gerät gespeichert. Sende offene Entwürfe oder lösche Fotos, dann versuch es noch einmal.'
    : 'Der Entwurf konnte nicht auf diesem Gerät gespeichert werden. Ohne Netz gehen deine Eingaben verloren.';
}

/** The form's text as the device stores it, and whether it meets the rules of a saved draft. */
function draftText({ kind, visibility, title, capturedAt, content }: WorkArtifactEditor) {
  return {
    kind,
    visibility,
    capturedAt: iso(capturedAt) ?? '',
    title,
    content: savedContent(kind, content),
    ready:
      workArtifactFieldIssues({ kind, title, submit: false, content: contentForKind(kind, content) })
        .length === 0,
  };
}

/**
 * The change that puts the form's text into the draft, creating it on the first change. An attach
 * whose answer is open keeps what it sent: the server may hold exactly that.
 */
function textChange(
  device: DraftDevice,
  draft: { artifactId: string; jobId: string },
  text: ReturnType<typeof draftText>,
): DraftChange {
  return (current) => {
    if (current?.sealed) return current;
    const now = new Date().toISOString();
    return {
      ...(current ?? {
        ...device.holder,
        id: draft.artifactId,
        revisionId: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        jobId: draft.jobId,
        photos: [],
        sealed: false,
        refusal: null,
      }),
      ...text,
      capturedAt: text.capturedAt || now,
      updatedAt: now,
    };
  };
}

/** The writes of one draft, one after the other, so the last change is the one that stays. */
function useDraftWrites(device: DraftDevice | null, artifactId: string) {
  const [deviceSaveError, setDeviceSaveError] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const write: DraftWrite = (change) => {
    if (!device) return Promise.resolve('not_stored');
    // Before the write: a tab that dies right after it still finds its draft on the next page.
    noteDraftsOnDevice(device.holder, true);
    const result = queue.current
      .then(() => device.change(artifactId, change))
      .then(
        (stored) => {
          setDeviceSaveError(null);
          device.changed();
          return stored;
        },
        (error: unknown) => {
          logError('useWorkArtifactDeviceDraft: device write failed', error);
          setDeviceSaveError(storageFailureMessage(error));
          return 'not_stored' as const;
        },
      );
    queue.current = result;
    return result;
  };
  return { write, deviceSaveError };
}

/** The draft's photos: each is stored on the device the moment it is taken. */
function useDraftPhotos(write: DraftWrite, withText: DraftChange, restored: StoredDraft | null) {
  const [photos, setPhotos] = useState<readonly DraftPhoto[]>(restored?.photos ?? []);
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function change(next: (photos: DraftPhoto[]) => DraftPhoto[]): Promise<void> {
    const stored = await write((current) => {
      const draft = withText(current);
      return draft && !draft.sealed
        ? { ...draft, photos: next(draft.photos), updatedAt: new Date().toISOString() }
        : draft;
    });
    // A photo the device could not store is not listed: the failure shows at the form.
    if (stored !== null && stored !== 'not_stored') setPhotos(stored.photos);
  }

  async function addPhoto(file: File): Promise<void> {
    const refusal = !file.type.startsWith('image/')
      ? 'Das ist kein Bild. Nimm ein Foto auf oder wähle eine Bilddatei.'
      : file.size > DOCUMENT_MAX_FILE_SIZE_BYTES
        ? 'Das Foto ist größer als 50 MB und kann nicht angehängt werden.'
        : photos.length >= WORK_ARTIFACT_DRAFT_PHOTO_LIMIT
          ? `Ein Entwurf kann höchstens ${WORK_ARTIFACT_DRAFT_PHOTO_LIMIT} Fotos haben.`
          : null;
    setPhotoError(refusal);
    if (focusFirstInvalidField({ [PHOTO_CONTROL_ID]: refusal ?? undefined })) return;
    const photo: DraftPhoto = {
      id: crypto.randomUUID(),
      name: file.name || 'Foto.jpg',
      blob: file,
      transferred: null,
      documentId: null,
    };
    await change((stored) => [...stored, photo]);
  }

  const removePhoto = (photoId: string): Promise<void> =>
    change((stored) => stored.filter((entry) => entry.id !== photoId));

  return { photos, photoError, addPhoto, removePhoto };
}

/**
 * A new Arbeitsnachweis of a job as a draft on this device (decision record 0010, the report
 * draft amendment): the text is stored as the person types, each photo when it is taken, so both
 * survive a lost signal, a reload and a restart. The draft leaves the device when the server
 * holds it.
 */
export function useWorkArtifactDeviceDraft({
  editor,
  device,
  jobId,
  artifactId,
  restored,
}: DeviceDraftOptions) {
  const active = device !== null && jobId !== null && editor.detail === null;
  const { write, deviceSaveError } = useDraftWrites(active ? device : null, artifactId);
  const text = draftText(editor);
  const withText: DraftChange =
    device && jobId !== null ? textChange(device, { artifactId, jobId }, text) : (current) => current;
  const photos = useDraftPhotos(write, withText, restored);

  // What the device holds of the text: the restored draft's, or the untouched form's, which is no draft yet.
  const snapshot = JSON.stringify(text);
  const written = useRef(snapshot);
  useEffect(() => {
    if (!active || snapshot === written.current) return;
    written.current = snapshot;
    void write(withText);
  });

  // While the dialog is open nothing sends the draft by itself.
  useEffect(() => {
    if (!device || !active) return;
    return device.keepOpen(artifactId);
  }, [device, active, artifactId]);

  /**
   * Sends the draft now, after its last change reached the device; `not_stored` when it did not.
   * A sent draft names the revision the server wrote and the version it left the Arbeitsnachweis at:
   * one for the revision and one for each photo link.
   */
  async function send(): Promise<
    | { outcome: 'sent'; revisionId: string; version: number }
    | { outcome: Exclude<DraftSendOutcome, 'sent'> | 'not_stored' }
  > {
    const stored = await write(withText);
    if (!device || stored === null || stored === 'not_stored') return { outcome: 'not_stored' };
    const outcome = await device.send(artifactId);
    return outcome === 'sent'
      ? { outcome, revisionId: stored.revisionId, version: 1 + stored.photos.length }
      : { outcome };
  }

  /** Removes the draft from the device once the server holds the Arbeitsnachweis. */
  async function discard(): Promise<void> {
    await write(() => null);
  }

  return { active, ...photos, deviceSaveError, send, discard };
}

export type WorkArtifactDeviceDraft = ReturnType<typeof useWorkArtifactDeviceDraft>;
