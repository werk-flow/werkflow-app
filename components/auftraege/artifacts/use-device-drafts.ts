'use client';

import { useState } from 'react';

import { useClientRead, type ReadFailure } from '@/hooks/use-client-read';
import type { DraftHolder, StoredDraft } from '@/lib/field-sync/device/draft-store';
import type { DraftSendOutcome, DraftSendProgress } from '@/lib/field-sync/device/draft-sync';
import type { WorkArtifactKind, WorkArtifactVisibility } from '@/lib/work-artifacts/types';
import type { WorkArtifactContentDraft } from './work-artifact-content';

// The report drafts of a device as a job page sees them (decision record
// 0010, the report draft amendment). This module is all of it that a job page
// loads with its own code, and it imports nothing a job page did not load
// before: the job list prefetches a job page's code, so that code counts
// toward the field cold start. Every other part (the device store, the
// sender, the list, the photo field, the dialog's draft keeper, the active
// organization) loads with the dialog's module (work-artifact-dialog.tsx).

/** What the artifact screens ask of the device, for the signed-in person in the active organization. */
export type DraftDevice = {
  holder: DraftHolder;
  list: () => Promise<StoredDraft[]>;
  /** Changes one draft in a single transaction; `null` from `change` deletes it. Rejects when the device refuses the write. */
  change: (
    draftId: string,
    change: (current: StoredDraft | null) => StoredDraft | null,
  ) => Promise<StoredDraft | null>;
  /** Tells every list of this tab that a draft changed. */
  changed: () => void;
  /** Sends one draft now because the person asked. */
  send: (draftId: string) => Promise<DraftSendOutcome>;
  /** Keeps a draft out of the automatic send until the returned function runs. */
  keepOpen: (draftId: string) => () => void;
  subscribe: (listener: () => void) => () => void;
  progress: () => DraftSendProgress | null;
  /** Names the holder to the sender and sends what waits, now and on every `online`. */
  start: () => void;
  isPastUnsentLimit: (draft: StoredDraft) => boolean;
  /** How long a draft stays after the server refused it for lost access. */
  noAccessKeptMs: number;
};

/** A draft the device kept, opened to go on writing: the stored draft and its fields as the form holds them. */
export type RestoredDraft = {
  draft: StoredDraft;
  form: {
    kind: WorkArtifactKind;
    visibility: WorkArtifactVisibility;
    title: string;
    /** „Erfasst am“ as the form's local date and time. */
    capturedAt: string;
    content: WorkArtifactContentDraft;
  };
};

/** What the dialog's save asks of the draft keeper once the device keeps the new Arbeitsnachweis. */
export type DeviceDraftHandle = {
  /** How many photos the device holds for the draft once every change made so far has been written. */
  committedPhotoCount: () => Promise<number>;
  /**
   * Sends the draft with its photos and answers the revision the server wrote and the version it
   * left the Arbeitsnachweis at, or null when the draft did not arrive; the keeper has said why.
   */
  save: (submit: boolean) => Promise<{ revisionId: string; version: number } | null>;
  /** Removes the draft from the device once the server holds the Arbeitsnachweis. */
  discard: () => Promise<void>;
};

/**
 * The localStorage key that says this person may hold a draft on this device in this organization.
 * A job page looks for one of the person's keys before it loads any draft code, so a page without
 * drafts costs no request.
 */
export function draftHintKey(holder: DraftHolder): string {
  return `${draftHintPrefix(holder.userId)}${holder.organizationId}`;
}

function draftHintPrefix(userId: string): string {
  return `werkflow:drafts:${userId}:`;
}

function mayHoldDrafts(userId: string): boolean {
  try {
    const prefix = draftHintPrefix(userId);
    return Object.keys(localStorage).some((key) => key.startsWith(prefix));
  } catch {
    // best-effort: without localStorage the device is asked itself.
    return true;
  }
}

/**
 * The list of the drafts this device keeps, loaded with the dialog's module once the device may
 * hold a draft of the person or `wanted` is set, as when the dialog for a new Arbeitsnachweis
 * opens. A load that fails carries its retry.
 */
export function useDeviceDrafts(
  currentUserId: string,
  wanted: boolean,
): {
  DeviceDrafts: typeof import('./work-artifact-dialog').DeviceDrafts | null;
  failure: ReadFailure | null;
} {
  // Once the dialog asked for the draft code, the section keeps it: a draft written since must show.
  const [everWanted, setEverWanted] = useState(wanted);
  if (wanted && !everWanted) setEverWanted(true);
  const [hinted] = useState(() => mayHoldDrafts(currentUserId));
  const load = useClientRead({
    read: async () => {
      const { DeviceDrafts } = await import('./work-artifact-dialog');
      return { success: true as const, DeviceDrafts };
    },
    deps: [currentUserId],
    enabled: everWanted || hinted,
    failureMessage: 'Die Entwürfe auf diesem Gerät konnten nicht geladen werden.',
  });
  return { DeviceDrafts: load.data?.DeviceDrafts ?? null, failure: load.failure };
}
