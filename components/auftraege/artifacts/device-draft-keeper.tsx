'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { DOCUMENT_MAX_FILE_SIZE_BYTES } from '@/lib/documents/types';
import type { DraftPhoto, StoredDraft } from '@/lib/field-sync/device/draft-store';
import type { DraftSendOutcome } from '@/lib/field-sync/device/draft-sync';
import { logError } from '@/lib/logging';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { workArtifactFieldIssues } from '@/lib/work-artifacts/field-rules';
import { WORK_ARTIFACT_DRAFT_PHOTO_LIMIT } from '@/lib/work-artifacts/types';
import type { DeviceDraftHandle, DraftDevice, RestoredDraft } from './use-device-drafts';
import type { WorkArtifactEditor } from './use-work-artifact-editor';
import { contentForKind, iso, savedContent } from './work-artifact-content';
import { PHOTO_CONTROL_ID, WorkArtifactPhotoField } from './work-artifact-photo-field';

// The draft of a new Arbeitsnachweis while its dialog is open (decision
// record 0010, the report draft amendment): the text is stored on the device
// as the person types, each photo when it is taken, so both survive a lost
// signal, a reload and a restart. The draft leaves the device when the server
// holds it. This module loads with the dialog, never with the job page.

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
function useDraftWrites(device: DraftDevice, artifactId: string) {
  const [deviceSaveError, setDeviceSaveError] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const write: DraftWrite = (change) => {
    // Before the write: a tab that dies right after it still finds its draft on the next page.
    device.noteHeld(true);
    const result = queue.current
      .then(() => device.change(artifactId, change))
      .then(
        (stored) => {
          setDeviceSaveError(null);
          device.changed();
          return stored;
        },
        (error: unknown) => {
          logError('DeviceDraftKeeper: device write failed', error);
          setDeviceSaveError(storageFailureMessage(error));
          return 'not_stored' as const;
        },
      );
    queue.current = result;
    return result;
  };
  /** Settles once every write queued so far has reached the device or failed. */
  const settled = useCallback((): Promise<void> => queue.current.then(() => undefined), []);
  return { write, settled, deviceSaveError };
}

/** The draft's photos: each is stored on the device the moment it is taken. */
function useDraftPhotos(write: DraftWrite, withText: DraftChange, restored: readonly DraftPhoto[]) {
  const [photos, setPhotos] = useState<readonly DraftPhoto[]>(restored);
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function change(next: (photos: DraftPhoto[]) => DraftPhoto[]): Promise<readonly DraftPhoto[] | null> {
    const stored = await write((current) => {
      const draft = withText(current);
      return draft && !draft.sealed
        ? { ...draft, photos: next(draft.photos), updatedAt: new Date().toISOString() }
        : draft;
    });
    // A photo the device could not store is not listed: the failure shows at the form.
    if (stored === null || stored === 'not_stored') return null;
    setPhotos(stored.photos);
    return stored.photos;
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
    // Checked again in the write's own transaction: two photos taken before the first is stored both
    // passed the check above.
    const stored = await change((current) =>
      current.length < WORK_ARTIFACT_DRAFT_PHOTO_LIMIT ? [...current, photo] : current,
    );
    if (stored && !stored.some((entry) => entry.id === photo.id))
      setPhotoError(
        stored.length >= WORK_ARTIFACT_DRAFT_PHOTO_LIMIT
          ? `Ein Entwurf kann höchstens ${WORK_ARTIFACT_DRAFT_PHOTO_LIMIT} Fotos haben.`
          : // The draft is sealed: a save in another tab sends it as it was.
            'Dieser Entwurf wird gerade gesendet. Das Foto wurde nicht angehängt.',
      );
  }

  const removePhoto = async (photoId: string): Promise<void> => {
    await change((stored) => stored.filter((entry) => entry.id !== photoId));
  };

  return { photos, photoError, addPhoto, removePhoto };
}

/** What a draft that did not reach the server says at the form; a failed device write shows its own sentence. */
const SEND_REFUSALS: Record<Exclude<DraftSendOutcome, 'sent' | 'waiting'>, string> = {
  no_access:
    'Du hast keinen Zugriff mehr auf diesen Auftrag. Der Entwurf bleibt auf diesem Gerät, wird aber nicht übertragen.',
  refused: 'Der Entwurf konnte nicht übertragen werden. Er bleibt auf diesem Gerät gespeichert.',
  skipped: 'Der Entwurf konnte nicht übertragen werden. Er bleibt auf diesem Gerät gespeichert.',
  changed:
    'Dieser Entwurf wurde inzwischen in einem anderen Fenster geändert oder gesendet. Deine Eingaben hier sind noch nicht gespeichert und bleiben im Formular.',
};

type DeviceDraftKeeperProps = {
  editor: WorkArtifactEditor;
  device: DraftDevice;
  jobId: string;
  /** The id the new Arbeitsnachweis gets, on the device and on the server. */
  artifactId: string;
  /** The stored draft the dialog was opened with. */
  restored: RestoredDraft | null;
  /** Tells the dialog's save how to reach this keeper while it is mounted, and null when it is gone. */
  onHandle: (handle: DeviceDraftHandle | null) => void;
  onClose: () => void;
};

/**
 * Sends the draft the device holds, with its photos, as one draft revision, and answers what the
 * server wrote. A draft that did not arrive answers null: without signal the dialog closes and a
 * banner says the draft waits on the device; a refusal shows at the form.
 */
function useSaveThroughDevice(
  { editor, device, artifactId, onClose }: DeviceDraftKeeperProps,
  write: DraftWrite,
): DeviceDraftHandle['save'] {
  const { showBanner } = useBanner();
  return async function save(submit, expected) {
    // prepareSave wrote the last change; this reads the draft behind every queued write, unchanged.
    const stored = await write((current) => current);
    if (stored === null || stored === 'not_stored') return null;
    const outcome = await device.send(artifactId, expected);
    if (outcome === 'sent') {
      // One version for the revision and one for each photo link.
      return { revisionId: stored.revisionId, version: 1 + stored.photos.length };
    }
    if (outcome !== 'waiting') {
      editor.setError(SEND_REFUSALS[outcome]);
      return null;
    }
    onClose();
    showBanner({
      variant: 'info',
      message: submit
        ? 'Gerade kein Netz. Der Entwurf ist auf diesem Gerät gespeichert und wird später übertragen. Reiche ihn danach zur Prüfung ein.'
        : 'Gerade kein Netz. Der Entwurf ist auf diesem Gerät gespeichert und wird später übertragen.',
    });
    return null;
  };
}

/**
 * Keeps the new Arbeitsnachweis of an open dialog as a draft on the device and shows its photos.
 * It renders inside the dialog's form while the form is a new job Arbeitsnachweis.
 */
export function DeviceDraftKeeper(props: DeviceDraftKeeperProps) {
  const { editor, device, jobId, artifactId, restored, onHandle } = props;
  const { write, settled, deviceSaveError } = useDraftWrites(device, artifactId);
  const text = draftText(editor);
  const withText = textChange(device, { artifactId, jobId }, text);
  const photos = useDraftPhotos(write, withText, restored?.draft.photos ?? []);
  const save = useSaveThroughDevice(props, write);

  // What the device holds of the text: the restored draft's, or the untouched form's, which is no draft yet.
  const snapshot = JSON.stringify(text);
  const written = useRef(snapshot);
  useEffect(() => {
    if (snapshot === written.current) return;
    written.current = snapshot;
    void write(withText);
  });

  // While the dialog is open, and until its last change reached the device, nothing sends the draft
  // by itself: a send must never seal a draft without the text or photo the person just gave it.
  useEffect(() => {
    const release = device.keepOpen(artifactId);
    return () => void settled().then(release);
  }, [device, artifactId, settled]);

  // The dialog's save reaches the keeper of this render; without a keeper it saves on the server alone.
  useEffect(() => {
    onHandle({
      // The write waits behind every queued one, so a photo just taken counts once it is stored, and
      // reads, writes and decides in one transaction: no other tab's photo or seal comes in between.
      prepareSave: async () => {
        const decided: { plan: 'online' | 'device' | 'sealed_elsewhere' } = { plan: 'device' };
        const stored = await write((current) => {
          if (current?.sealed) {
            decided.plan = 'sealed_elsewhere';
            return current;
          }
          const next = withText(current);
          if (next === null || next.photos.length > 0) return next;
          decided.plan = 'online';
          return { ...next, sealed: true };
        });
        if (stored === null || stored === 'not_stored') return null;
        if (decided.plan === 'sealed_elsewhere') return { kind: 'sealed_elsewhere' };
        return decided.plan === 'online'
          ? { kind: 'online', revisionId: stored.revisionId, changedAt: stored.updatedAt }
          : { kind: 'device', changedAt: stored.updatedAt };
      },
      unseal: async () =>
        void (await write((current) => (current ? { ...current, sealed: false } : current))),
      save,
      discard: async () => void (await write(() => null)),
    });
  });
  useEffect(() => () => onHandle(null), [onHandle]);

  return <WorkArtifactPhotoField {...photos} deviceSaveError={deviceSaveError} />;
}
