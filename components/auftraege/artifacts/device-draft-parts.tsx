'use client';

import { useEffect, useMemo, useState } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { SectionError } from '@/components/ui/section-error';
import { useClientRead } from '@/hooks/use-client-read';
import {
  DRAFT_NO_ACCESS_KEPT_MS,
  changeDraftOnDevice,
  listDraftsOnDevice,
  type DraftHolder,
} from '@/lib/field-sync/device/draft-store';
import {
  draftChangedOnDevice,
  draftSendProgress,
  isPastUnsentLimit,
  keepDraftOpen,
  sendDraft,
  startDraftSync,
  subscribeToDrafts,
  type DraftSendProgress,
} from '@/lib/field-sync/device/draft-sync';
import { noteDraftsOnDevice } from './device-draft-keeper';
import { DeviceDraftList } from './device-draft-list';
import type { DraftDevice, RestoredDraft } from './use-device-drafts';

// Everything of the report drafts that a job page loads only when it needs
// it (use-device-drafts.ts): the device store and its sender bound to one
// person and organization, the list of the device's drafts, and the keeper
// that stores a new Arbeitsnachweis while its dialog is open.

export { DeviceDraftKeeper } from './device-draft-keeper';

/** The device store and the sender, bound to the holder. */
function createDraftDevice(holder: DraftHolder): DraftDevice {
  return {
    holder,
    list: () => listDraftsOnDevice(holder),
    change: (draftId, change) => changeDraftOnDevice(holder, draftId, change),
    changed: draftChangedOnDevice,
    send: (draftId) => sendDraft(holder, draftId),
    keepOpen: keepDraftOpen,
    subscribe: subscribeToDrafts,
    progress: draftSendProgress,
    start: () => void startDraftSync(holder),
    isPastUnsentLimit,
    noAccessKeptMs: DRAFT_NO_ACCESS_KEPT_MS,
  };
}

type DeviceDraftsProps = {
  currentUserId: string;
  /** The job of this page; null on a page that keeps no drafts of its own. */
  jobId: string | null;
  onOpen: (restored: RestoredDraft) => void;
  /** Hands the device to the page once the active organization is known, and null when it is gone. */
  onDevice: (device: DraftDevice | null) => void;
};

/**
 * The report drafts this device keeps for the signed-in person in the active organization: it
 * reads them, sends what waits, and lists them. Without an organization nothing is read.
 */
export function DeviceDrafts({ currentUserId, jobId, onOpen, onDevice }: DeviceDraftsProps) {
  const organizationId = useOrganization().activeOrg?.orgId ?? null;
  const device = useMemo(
    () => (organizationId === null ? null : createDraftDevice({ userId: currentUserId, organizationId })),
    [currentUserId, organizationId],
  );
  const read = useClientRead({
    read: async () => {
      const drafts = device ? await device.list() : [];
      if (device) noteDraftsOnDevice(device.holder, drafts.length > 0);
      return { success: true as const, drafts };
    },
    deps: [currentUserId, organizationId],
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
  useEffect(() => {
    onDevice(device);
    return () => onDevice(null);
  }, [device, onDevice]);
  if (read.failure) return <SectionError className="mt-4" failure={read.failure} />;
  if (!device) return null;
  return (
    <DeviceDraftList
      device={device}
      drafts={read.data?.drafts ?? []}
      progress={progress}
      jobId={jobId}
      onOpen={onOpen}
    />
  );
}
