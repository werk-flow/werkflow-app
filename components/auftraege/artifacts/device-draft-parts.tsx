'use client';

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
} from '@/lib/field-sync/device/draft-sync';
import type { DraftDevice } from './use-device-drafts';

// Everything of the report drafts that a job page loads only when it needs
// it (use-device-drafts.ts): the device store and its sender bound to one
// person and organization, the list of the device's drafts, and the keeper
// that stores a new Arbeitsnachweis while its dialog is open.

export { DeviceDraftKeeper, noteDraftsOnDevice } from './device-draft-keeper';
export { DeviceDraftList } from './device-draft-list';

/** The device store and the sender, bound to the holder. */
export function createDraftDevice(holder: DraftHolder): DraftDevice {
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
