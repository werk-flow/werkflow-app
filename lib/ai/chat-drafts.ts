'use client';

import { KI_DRAFT_PREFIX, onKiDraftsCleared, storedKiDraftKeys } from '@/lib/ai/chat-draft-clear';
import { tabStorage } from '@/lib/time-tracking/manual-entry-bridge-storage';

// The WerkFlow KI chat composer's drafts (brief non-negotiable 8): one per person,
// organization and thread, in this tab's sessionStorage, so a draft survives
// navigation and reload and leaves the device with the tab. A memory copy
// carries it when storage is refused. Every browser sign-out clears them
// through lib/ai/chat-draft-clear.ts, which the start-up chunk can carry; only
// the chat page loads this module.
/** Marks the copy of a message on its way, kept beside the draft it came from. */
const SENDING_SUFFIX = ':sending';
/** Marks the command of a message that went back into its draft, kept beside that draft. */
const RETRY_SUFFIX = ':retry';

const memoryDrafts = new Map<string, string>();
const draftListeners = new Set<() => void>();

/** Moves on at every sign-out's clear: a write begun before it belongs to the session that ended. */
let clears = 0;

export function draftClears(): number {
  return clears;
}

onKiDraftsCleared(() => {
  clears += 1;
  memoryDrafts.clear();
  for (const listener of draftListeners) listener();
});

export function subscribeDrafts(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => draftListeners.delete(listener);
}

export function readDraft(key: string): string {
  const kept = memoryDrafts.get(key);
  if (kept !== undefined) return kept;
  try {
    return tabStorage()?.getItem(key) ?? '';
  } catch {
    // best-effort: storage that refuses a read holds no draft of this page.
    return '';
  }
}

/** Saves or clears the draft under `key`. */
export function writeDraft(key: string, text: string): void {
  memoryDrafts.set(key, text);
  try {
    if (text) tabStorage()?.setItem(key, text);
    else tabStorage()?.removeItem(key);
  } catch {
    // best-effort: the memory copy keeps the draft for this page when the browser refuses storage.
  }
  for (const listener of draftListeners) listener();
}

function draftScope(userId: string, organizationId: string): string {
  return `${KI_DRAFT_PREFIX}${userId}:${organizationId}:`;
}

/** One draft per person, organization and thread; the new chat has its own. */
export function draftKey(userId: string, organizationId: string, threadId: string | null): string {
  return `${draftScope(userId, organizationId)}${threadId ?? 'neu'}`;
}

/** A message's thread and command. */
type MessageCommand = { threadId: string; commandId: string; text: string };

/**
 * The command of a message that went back into its draft, with the files it
 * named in their order: sent again with the same text and files, it is the
 * same command; the server binds a saved command to its files.
 */
export type RetryCommand = MessageCommand & { fileIds: readonly string[] };

/** A message on its way to the turn route, from the draft under `draft`. */
type SendingMessage = MessageCommand & { draft: string };

function isMessageCommand(value: unknown): value is MessageCommand {
  return (
    typeof value === 'object' &&
    value !== null &&
    'threadId' in value &&
    typeof value.threadId === 'string' &&
    'commandId' in value &&
    typeof value.commandId === 'string' &&
    'text' in value &&
    typeof value.text === 'string'
  );
}

/** The file ids a stored retry names; a retry kept before files existed names none. */
function storedFileIds(value: object): string[] | null {
  if (!('fileIds' in value)) return [];
  const ids: unknown = value.fileIds;
  return Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? ids : null;
}

function isSendingMessage(value: unknown): value is SendingMessage {
  return isMessageCommand(value) && 'draft' in value && typeof value.draft === 'string';
}

/** A stored copy as written by this module, or null. */
function parseStored(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // best-effort: a copy that does not parse was not written by this module and holds no message.
    return null;
  }
}

/**
 * Keeps the command of a message that went back into its draft, beside that
 * draft, so an unchanged resend after any number of reloads is the same
 * command (brief non-negotiable 9). It goes when the draft is sent.
 */
export function holdRetry(draft: string, retry: RetryCommand): void {
  writeDraft(`${draft}${RETRY_SUFFIX}`, JSON.stringify(retry));
}

/** Takes the command kept beside the draft, as the draft is sent. */
export function takeRetry(draft: string): RetryCommand | undefined {
  const key = `${draft}${RETRY_SUFFIX}`;
  const value = parseStored(readDraft(key));
  writeDraft(key, '');
  if (!isMessageCommand(value)) return undefined;
  const fileIds = storedFileIds(value);
  return fileIds
    ? { threadId: value.threadId, commandId: value.commandId, text: value.text, fileIds }
    : undefined;
}

/**
 * Keeps a copy of a message until its turn saved it: the composer cleared its
 * draft at Send, and a page that goes before the turn starts must not lose it.
 */
export function holdSending(message: SendingMessage): void {
  writeDraft(`${message.draft}${SENDING_SUFFIX}`, JSON.stringify(message));
}

/** Drops the copy once the turn saved the message or the page settled it. */
export function releaseSending(draft: string): void {
  writeDraft(`${draft}${SENDING_SUFFIX}`, '');
}

/** Takes the person's messages in the organization whose page went before their turns started. */
export function takeSending(userId: string, organizationId: string): SendingMessage[] {
  const scope = draftScope(userId, organizationId);
  const keys = new Set([...memoryDrafts.keys(), ...storedKiDraftKeys()]);
  const taken: SendingMessage[] = [];
  for (const key of keys) {
    if (!key.startsWith(scope) || !key.endsWith(SENDING_SUFFIX)) continue;
    const value = parseStored(readDraft(key));
    writeDraft(key, '');
    if (isSendingMessage(value)) taken.push(value);
  }
  return taken;
}
