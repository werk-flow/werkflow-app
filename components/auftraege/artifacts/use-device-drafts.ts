'use client';

import { useEffect, useMemo, useState } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { useClientRead, type ReadFailure } from '@/hooks/use-client-read';
import { useHydrated } from '@/hooks/use-hydrated';
import type { DraftHolder, StoredDraft } from '@/lib/field-sync/device/draft-store';
import type { DraftSendOutcome, DraftSendProgress } from '@/lib/field-sync/device/draft-sync';
import type { WorkArtifactKind, WorkArtifactVisibility } from '@/lib/work-artifacts/types';
import type { WorkArtifactContentDraft } from './work-artifact-content';

// The report drafts of a device as a job page sees them (decision record
// 0010, the report draft amendment). This module is all of it that a job page
// loads with its own code: every other part (the device store, the sender,
// the list, the photo field, the dialog's draft keeper) sits behind one lazy
// load in device-draft-parts.tsx, because a job page's code counts toward the
// field cold start.

/** The lazily loaded draft code. */
type DraftParts = typeof import('./device-draft-parts');

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
  photoCount: number;
  /** Sends the draft with its photos; a submit asks for the review once the server holds it. */
  save: (submit: boolean) => Promise<void>;
  /** Removes the draft from the device once the server holds the Arbeitsnachweis. */
  discard: () => Promise<void>;
};

export type DeviceDrafts = {
  /** Null until the draft code is loaded. */
  parts: DraftParts | null;
  device: DraftDevice | null;
  /** The holder's drafts on this device, oldest change first. */
  drafts: readonly StoredDraft[];
  progress: DraftSendProgress | null;
  /** The draft code or the device store could not be read; carries its retry. */
  failure: ReadFailure | null;
};

/**
 * The localStorage key that says this person may hold a draft on this device in this organization.
 * A job page reads it before it loads any draft code, so a page without drafts costs no request.
 */
export function draftHintKey(holder: DraftHolder): string {
  return `werkflow:drafts:${holder.userId}:${holder.organizationId}`;
}

function mayHoldDrafts(holder: DraftHolder): boolean {
  try {
    return localStorage.getItem(draftHintKey(holder)) !== null;
  } catch {
    // best-effort: without localStorage the device is asked itself.
    return true;
  }
}

/**
 * The report drafts this device keeps for the signed-in person in the active organization. The
 * draft code loads only when the device may hold a draft or `wanted` is set, as when the dialog
 * for a new Arbeitsnachweis opens; from then on it also sends what waits. Without a person or an
 * organization nothing is read.
 */
export function useDeviceDrafts(currentUserId: string, wanted: boolean): DeviceDrafts {
  const organizationId = useOrganization().activeOrg?.orgId ?? null;
  const hydrated = useHydrated();
  const holder = useMemo<DraftHolder | null>(
    () => (organizationId === null ? null : { userId: currentUserId, organizationId }),
    [currentUserId, organizationId],
  );
  // Once the dialog asked for the draft code, the section keeps it: a draft written since must show.
  const [everWanted, setEverWanted] = useState(wanted);
  if (wanted && !everWanted) setEverWanted(true);
  const [hinted] = useState(() => holder !== null && mayHoldDrafts(holder));
  // The loaded code and its device, kept across reads: effects and the dialog depend on one object per holder.
  const [loaded, setLoaded] = useState<{ parts: DraftParts; device: DraftDevice } | null>(null);
  if (loaded !== null && loaded.device.holder !== holder) setLoaded(null);
  const read = useClientRead({
    read: async () => {
      if (holder === null) return { success: true as const, drafts: [] };
      const parts = loaded?.parts ?? (await import('./device-draft-parts'));
      const device = loaded?.device ?? parts.createDraftDevice(holder);
      const drafts = await device.list();
      parts.noteDraftsOnDevice(holder, drafts.length > 0);
      setLoaded({ parts, device });
      return { success: true as const, drafts };
    },
    deps: [currentUserId, organizationId],
    enabled: hydrated && holder !== null && (everWanted || hinted),
    failureMessage: 'Die Entwürfe auf diesem Gerät konnten nicht gelesen werden.',
  });
  const reload = read.reload;
  const device = loaded?.device ?? null;
  const [progress, setProgress] = useState<DraftSendProgress | null>(null);
  useEffect(() => {
    if (!device) return;
    const unsubscribe = device.subscribe(() => {
      setProgress(device.progress());
      reload();
    });
    device.start();
    return unsubscribe;
  }, [device, reload]);
  return {
    parts: loaded?.parts ?? null,
    device,
    drafts: read.data?.drafts ?? [],
    progress,
    failure: read.failure,
  };
}
