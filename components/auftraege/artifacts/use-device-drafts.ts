'use client';

import { useEffect, useMemo, useState } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { useClientRead, type ReadFailure } from '@/hooks/use-client-read';
import { useHydrated } from '@/hooks/use-hydrated';
import type { DraftHolder, StoredDraft } from '@/lib/field-sync/device/draft-store';
import type { DraftSendOutcome, DraftSendProgress } from '@/lib/field-sync/device/draft-sync';

/**
 * What the artifact screens ask of the device: the lazily loaded draft store and its sender, for
 * the signed-in person in the active organization. The static chunk of a job page holds none of
 * that code; it reaches it only through this object.
 */
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

/** Loads the draft code and binds it to the holder. Rejects when a chunk cannot load. */
async function loadDraftDevice(holder: DraftHolder): Promise<DraftDevice> {
  // The sender imports the store, so the second load answers from the first one's chunks.
  const sync = await import('@/lib/field-sync/device/draft-sync');
  const store = await import('@/lib/field-sync/device/draft-store');
  return {
    holder,
    list: () => store.listDraftsOnDevice(holder),
    change: (draftId, change) => store.changeDraftOnDevice(holder, draftId, change),
    changed: sync.draftChangedOnDevice,
    send: (draftId) => sync.sendDraft(holder, draftId),
    keepOpen: sync.keepDraftOpen,
    subscribe: sync.subscribeToDrafts,
    progress: sync.draftSendProgress,
    start: () => sync.startDraftSync(holder),
    isPastUnsentLimit: sync.isPastUnsentLimit,
    noAccessKeptMs: store.DRAFT_NO_ACCESS_KEPT_MS,
  };
}

export type DeviceDrafts = {
  /** Null until the device code is loaded; the draft path of the dialog needs it. */
  device: DraftDevice | null;
  /** The holder's drafts on this device, oldest change first. */
  drafts: readonly StoredDraft[];
  progress: DraftSendProgress | null;
  /** The device code or the device store could not be read; carries its retry. */
  failure: ReadFailure | null;
};

/**
 * The localStorage key that says this person may hold a draft on this device in this organization.
 * A job page reads it before it loads any draft code, so a page without drafts costs no request.
 */
function hintKey(holder: DraftHolder): string {
  return `werkflow:drafts:${holder.userId}:${holder.organizationId}`;
}

function mayHoldDrafts(holder: DraftHolder): boolean {
  try {
    return localStorage.getItem(hintKey(holder)) !== null;
  } catch {
    // best-effort: without localStorage the device is asked itself.
    return true;
  }
}

/** Remembers that the holder wrote a draft on this device, or forgets it once none is left. */
export function noteDraftsOnDevice(holder: DraftHolder, held: boolean): void {
  try {
    if (held) localStorage.setItem(hintKey(holder), '1');
    else localStorage.removeItem(hintKey(holder));
  } catch {
    // best-effort: without localStorage every job page asks the device itself.
  }
}

/**
 * The report drafts this device keeps for the signed-in person in the active organization
 * (decision record 0010, the report draft amendment). The draft code loads only when the device
 * may hold a draft or `wanted` is set, as when the dialog for a new Arbeitsnachweis opens; from
 * then on it also sends what waits. Without a person or an organization nothing is read.
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
  // The loaded code, kept across reads: effects and the dialog depend on one object per holder.
  const [device, setDevice] = useState<DraftDevice | null>(null);
  if (device !== null && device.holder !== holder) setDevice(null);
  const read = useClientRead({
    read: async () => {
      if (holder === null) return { success: true as const, drafts: [] };
      const loaded = device ?? (await loadDraftDevice(holder));
      const drafts = await loaded.list();
      noteDraftsOnDevice(holder, drafts.length > 0);
      setDevice(loaded);
      return { success: true as const, drafts };
    },
    deps: [currentUserId, organizationId],
    enabled: hydrated && holder !== null && (everWanted || hinted),
    failureMessage: 'Die Entwürfe auf diesem Gerät konnten nicht gelesen werden.',
  });
  const reload = read.reload;
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
  return { device, drafts: read.data?.drafts ?? [], progress, failure: read.failure };
}
