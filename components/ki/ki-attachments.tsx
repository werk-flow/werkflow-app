'use client';

import { Camera, Paperclip, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { draftClears, readDraft, subscribeDrafts } from '@/lib/ai/chat-drafts';
import {
  attachmentsKey,
  holdRemoval,
  holdRemovalRefusal,
  onAttachmentsMoved,
  parseAttachments,
  pendingRemovals,
  readAttachments,
  releaseRemoval,
  removalRefusal,
  restoreAttachments,
  writeAttachments,
} from './attachment-drafts';
import { discardAiFile } from '@/lib/ai/files/actions';
import type { AiUploadedFile } from '@/lib/ai/files/types';
import { AI_UPLOAD_LIMITS } from '@/lib/ai/limits';
import { uploadAiFile } from '@/lib/ai/files/upload-client';
import { describeUploadRefusal } from '@/lib/ai/files/upload-messages';
import { cn } from '@/lib/utils';
import { FileTypeIcon, fileFacts } from './ki-file-card';

// The files of the composer's draft (werk-flow/werkflow-planning#534): each
// uploads as soon as it is chosen, and the draft keeps it until its message is
// sent. A refused file says why in German, beside the composer.

/**
 * Why a file cannot join a message that already holds `held`, before anything
 * is sent; the server checks the same caps again (lib/ai/files/upload.ts).
 */
function uploadPrecheck(file: File, held: readonly { sizeBytes: number }[]): string | null {
  if (!AI_UPLOAD_LIMITS.mimeTypes.some((type) => type === file.type)) return 'file_type_not_allowed';
  if (file.size === 0) return 'file_empty';
  if (file.size > AI_UPLOAD_LIMITS.maxFileBytes) return 'file_too_large';
  if (held.length >= AI_UPLOAD_LIMITS.maxFilesPerMessage) return 'too_many_files';
  const bytes = held.reduce((sum, heldFile) => sum + heldFile.sizeBytes, file.size);
  return bytes > AI_UPLOAD_LIMITS.maxMessageBytes ? 'message_too_large' : null;
}

const WAIT_FOR_UPLOADS = 'Warte, bis alle Dateien hochgeladen sind, und schick die Nachricht dann.';

type Uploading = { id: string; draft: string; name: string; mimeType: string; sizeBytes: number };

type Refusal = { draft: string; message: string };

/**
 * Removes an upload from its draft; a removal the server refused, or never
 * answered, brings it back with why. Until the server answered, the file
 * keeps its place in the draft's caps, and the reason waits beside the draft
 * (attachment-drafts.ts), also while the chat is off the page.
 */
function removeUpload(organizationId: string, draft: string, file: AiUploadedFile): void {
  holdRemoval({ fileId: file.fileId, draft, sizeBytes: file.sizeBytes });
  holdRemovalRefusal(draft, null);
  writeAttachments(
    draft,
    readAttachments(draft).filter((held) => held.fileId !== file.fileId),
  );
  const session = draftClears();
  // A new chat's draft that moves to its saved thread meanwhile takes the file back there.
  let target = draft;
  const stopFollowing = onAttachmentsMoved((from, to) => {
    if (from === target) target = to;
  });
  const settle = (refused: boolean): void => {
    stopFollowing();
    releaseRemoval(file.fileId);
    // A sign-out cleared the drafts meanwhile: the file's name stays out of this tab.
    if (!refused || draftClears() !== session) return;
    // The reason first: the file's return renders the composer that shows the draft now.
    holdRemovalRefusal(target, `„${file.name}“ konnte nicht entfernt werden. Versuch es noch einmal.`);
    restoreAttachments(target, [file]);
  };
  void discardAiFile({ organizationId, fileId: file.fileId }).then(
    (result) => settle(!result.success),
    () => settle(true),
  );
}

/**
 * The uploads still on their way, each with its transfer so it can be
 * cancelled. They follow a new chat's draft to its saved thread.
 */
function usePending() {
  const [uploading, setUploading] = useState<readonly Uploading[]>([]);
  const uploadingRef = useRef<readonly Uploading[]>([]);
  const transfers = useRef(new Map<string, AbortController>());
  const track = useCallback((change: (current: readonly Uploading[]) => readonly Uploading[]) => {
    uploadingRef.current = change(uploadingRef.current);
    setUploading(uploadingRef.current);
  }, []);
  useEffect(
    () =>
      onAttachmentsMoved((from, to) =>
        track((current) => current.map((item) => (item.draft === from ? { ...item, draft: to } : item))),
      ),
    [track],
  );
  /** Stops an upload still on its way, a stalled one too; the draft's text and other files stay. */
  const cancel = useCallback(
    (id: string) => {
      transfers.current.get(id)?.abort();
      transfers.current.delete(id);
      track((current) => current.filter((entry) => entry.id !== id));
    },
    [track],
  );
  return { uploading, uploadingRef, transfers, track, cancel };
}

/** Why a removal of the draft's file failed, though another composer started it. */
function useRemovalRefusal(draft: string): string | null {
  return useSyncExternalStore(
    subscribeDrafts,
    () => removalRefusal(draft),
    () => null,
  );
}

/** The draft's uploads, the ones still on their way, and the last refusal. */
export function useKiUploads(organizationId: string, draft: string) {
  const raw = useSyncExternalStore(
    subscribeDrafts,
    () => readDraft(attachmentsKey(draft)),
    () => '',
  );
  const uploads = useMemo(() => parseAttachments(raw), [raw]);
  const refusedRemoval = useRemovalRefusal(draft);
  const { uploading, uploadingRef, transfers, track, cancel } = usePending();
  const [error, setError] = useState<Refusal | null>(null);
  // The draft whose message waits for its uploads: it says so until they are stored.
  const [waiting, setWaiting] = useState<string | null>(null);

  const add = useCallback(
    (files: readonly File[]) => {
      setError(null);
      holdRemovalRefusal(draft, null);
      for (const file of files) {
        const held = [
          ...readAttachments(draft),
          ...uploadingRef.current.filter((item) => item.draft === draft),
          ...pendingRemovals(draft),
        ];
        const refused = uploadPrecheck(file, held);
        if (refused) {
          setError({ draft, message: describeUploadRefusal(file.name, refused) });
          continue;
        }
        const item = {
          id: crypto.randomUUID(),
          draft,
          name: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        };
        track((current) => [...current, item]);
        const session = draftClears();
        const transfer = new AbortController();
        transfers.current.set(item.id, transfer);
        void uploadAiFile(organizationId, file, transfer.signal).then((result) => {
          transfers.current.delete(item.id);
          // Cancelled: the entry is gone, and a file the server registered meanwhile is discarded.
          if (transfer.signal.aborted) {
            if (result.success) void discardAiFile({ organizationId, fileId: result.file.fileId });
            return;
          }
          // The draft the upload belongs to now: it moved along with a new chat's first message.
          const target = uploadingRef.current.find((entry) => entry.id === item.id)?.draft ?? item.draft;
          track((current) => current.filter((entry) => entry.id !== item.id));
          // A sign-out cleared the drafts meanwhile: the file's name stays out of this tab.
          if (draftClears() !== session) return;
          if (result.success) writeAttachments(target, [...readAttachments(target), result.file]);
          else setError({ draft: target, message: describeUploadRefusal(file.name, result.error) });
        });
      }
    },
    [organizationId, draft, track, uploadingRef, transfers],
  );

  const remove = useCallback(
    (fileId: string) => {
      const file = readAttachments(draft).find((held) => held.fileId === fileId);
      setError(null);
      if (file) removeUpload(organizationId, draft, file);
    },
    [organizationId, draft],
  );

  const shown = uploading.filter((item) => item.draft === draft);
  /** The draft's uploads for its message, taken out of the draft; null while one is still on its way. */
  const take = (): readonly AiUploadedFile[] | null => {
    setWaiting(shown.length > 0 ? draft : null);
    if (shown.length > 0) return null;
    writeAttachments(draft, []);
    return uploads;
  };
  const wait = waiting === draft && shown.length > 0;
  return {
    uploads,
    uploading: shown,
    error: wait ? WAIT_FOR_UPLOADS : (refusedRemoval ?? (error?.draft === draft ? error.message : null)),
    add,
    remove,
    cancel,
    take,
  };
}

const ACCEPT = AI_UPLOAD_LIMITS.mimeTypes.join(',');

/** A hidden file input its button opens: the browser's own reads in the browser's language. */
function FilePicker({
  label,
  icon,
  capture,
  className,
  onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  capture?: boolean;
  className?: string;
  onSelect: (files: File[]) => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('size-11', className)}
        aria-label={label}
        onClick={() => inputRef.current?.click()}
      >
        {icon}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={capture ? 'image/jpeg,image/png,image/webp' : ACCEPT}
        multiple={!capture}
        capture={capture ? 'environment' : undefined}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Choosing the same file again must fire again.
          event.target.value = '';
          onSelect(files);
        }}
      />
    </>
  );
}

/** „Datei anhängen“, and on a phone „Foto aufnehmen“ with the back camera. */
export function KiAttachButtons({ onSelect }: { onSelect: (files: File[]) => void }): React.JSX.Element {
  return (
    <>
      <FilePicker label="Datei anhängen" icon={<Paperclip />} onSelect={onSelect} />
      <FilePicker
        label="Foto aufnehmen"
        icon={<Camera />}
        capture
        className="md:hidden"
        onSelect={onSelect}
      />
    </>
  );
}

/** The draft's files above the composer: each removable, the ones on their way marked as such. */
export function KiAttachmentList({
  uploads,
  uploading,
  onRemove,
  onCancel,
}: {
  uploads: readonly AiUploadedFile[];
  uploading: readonly Uploading[];
  onRemove: (fileId: string) => void;
  onCancel: (id: string) => void;
}): React.JSX.Element | null {
  if (uploads.length === 0 && uploading.length === 0) return null;
  return (
    <ul aria-label="Angehängte Dateien" className="flex flex-wrap gap-2">
      {uploads.map((file) => (
        <li key={file.fileId} className="flex max-w-full items-center gap-2 rounded-md border py-1 pr-1 pl-2">
          <FileTypeIcon mimeType={file.mimeType} />
          <span className="min-w-0">
            <span className="block truncate text-sm">{file.name}</span>
            <span className="block text-xs text-muted-foreground">{fileFacts(file)}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 sm:size-8"
            aria-label={`${file.name} entfernen`}
            onClick={() => onRemove(file.fileId)}
          >
            <X />
          </Button>
        </li>
      ))}
      {uploading.map((item) => (
        <li
          key={item.id}
          className="flex max-w-full items-center gap-2 rounded-md border py-1 pr-1 pl-2"
          aria-busy
        >
          <FileTypeIcon mimeType={item.mimeType} />
          <span className="min-w-0">
            <span className="block truncate text-sm">{item.name}</span>
            <span className="block animate-live text-xs text-muted-foreground" role="status">
              wird hochgeladen …
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 sm:size-8"
            aria-label={`Hochladen von ${item.name} abbrechen`}
            onClick={() => onCancel(item.id)}
          >
            <X />
          </Button>
        </li>
      ))}
    </ul>
  );
}
