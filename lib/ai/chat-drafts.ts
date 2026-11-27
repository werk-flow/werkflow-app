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

/** A message on its way to the turn route, from the draft under `draft`. */
type SendingMessage = { draft: string; threadId: string; commandId: string; text: string };

function isSendingMessage(value: unknown): value is SendingMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'draft' in value &&
    typeof value.draft === 'string' &&
    'threadId' in value &&
    typeof value.threadId === 'string' &&
    'commandId' in value &&
    typeof value.commandId === 'string' &&
    'text' in value &&
    typeof value.text === 'string'
  );
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
    const raw = readDraft(key);
    writeDraft(key, '');
    if (!raw) continue;
    let value: unknown = null;
    try {
      value = JSON.parse(raw);
    } catch {
      // best-effort: a copy that does not parse was not written by this module and holds no message.
    }
    if (isSendingMessage(value)) taken.push(value);
  }
  return taken;
}
