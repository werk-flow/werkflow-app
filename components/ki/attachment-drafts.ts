'use client';

import { readDraft, writeDraft } from '@/lib/ai/chat-drafts';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import type { AiUploadedFile } from '@/lib/ai/files/types';

// The uploads a draft holds until its message is sent: beside the draft's
// text, in the same tab storage, so they survive a switch and a reload and go
// at sign-out with the drafts (lib/ai/chat-drafts.ts).

const uploadsSchema = z.array(
  z.object({
    fileId: uuidSchema,
    name: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
    pages: z.number().nullable(),
  }),
);

/** The storage key of the uploads of the draft under `draft`. */
export function attachmentsKey(draft: string): string {
  return `${draft}:dateien`;
}

/** The uploads a stored value holds; a value this module did not write holds none. */
export function parseAttachments(raw: string): AiUploadedFile[] {
  if (!raw) return [];
  try {
    const parsed = uploadsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    // best-effort: a value that does not parse holds no upload.
    return [];
  }
}

export function readAttachments(draft: string): AiUploadedFile[] {
  return parseAttachments(readDraft(attachmentsKey(draft)));
}

export function writeAttachments(draft: string, uploads: readonly AiUploadedFile[]): void {
  writeDraft(attachmentsKey(draft), uploads.length > 0 ? JSON.stringify(uploads) : '');
}

/** A removed upload whose discard the server has not answered: it keeps its place, since a refused one comes back. */
type Removal = { fileId: string; draft: string; sizeBytes: number };

/**
 * The removals the server has not answered, with the drafts they keep a place
 * in. Memory only: they outlive the composer through a client-side navigation,
 * and a reload ends the wait for the answer, after which nothing comes back.
 */
let removals: readonly Removal[] = [];

export function holdRemoval(removal: Removal): void {
  removals = [...removals, removal];
}

/** Frees the place once the server answered; a refused removal's file comes back after it. */
export function releaseRemoval(fileId: string): void {
  removals = removals.filter((removal) => removal.fileId !== fileId);
}

export function pendingRemovals(draft: string): readonly Removal[] {
  return removals.filter((removal) => removal.draft === draft);
}

const moveListeners = new Set<(from: string, to: string) => void>();

/** Hears each move of a draft's uploads, so an upload still on its way follows its draft. */
export function onAttachmentsMoved(listener: (from: string, to: string) => void): () => void {
  moveListeners.add(listener);
  return () => moveListeners.delete(listener);
}

/** Moves a draft's uploads and pending removals behind those of another draft: a new chat's, once its thread exists. */
export function moveAttachments(from: string, to: string): void {
  const moved = readAttachments(from);
  if (moved.length > 0) {
    writeAttachments(from, []);
    writeAttachments(to, [...readAttachments(to), ...moved]);
  }
  removals = removals.map((removal) => (removal.draft === from ? { ...removal, draft: to } : removal));
  for (const listener of moveListeners) listener(from, to);
}

/** Puts uploads back into a draft, in front of the ones added meanwhile, each once. */
export function restoreAttachments(draft: string, uploads: readonly AiUploadedFile[]): void {
  const added = readAttachments(draft).filter((held) => !uploads.some((file) => file.fileId === held.fileId));
  writeAttachments(draft, [...uploads, ...added]);
}

/** Marks the uploads of a message on its way, kept beside its draft until its turn saved it. */
const SENDING_SUFFIX = ':dateien-unterwegs';

/** Keeps a copy of a message's uploads until its turn saved it, as the text's copy (chat-drafts.ts); none clears it. */
export function holdSendingAttachments(draft: string, uploads: readonly AiUploadedFile[]): void {
  writeDraft(`${draft}${SENDING_SUFFIX}`, uploads.length > 0 ? JSON.stringify(uploads) : '');
}

/** Takes the copy of the uploads of a message whose page went before its turn started. */
export function takeSendingAttachments(draft: string): AiUploadedFile[] {
  const uploads = parseAttachments(readDraft(`${draft}${SENDING_SUFFIX}`));
  holdSendingAttachments(draft, []);
  return uploads;
}
