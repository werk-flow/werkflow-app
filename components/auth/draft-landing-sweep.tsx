'use client';

import { useDraftSweepOfDevice } from '@/lib/field-sync/device/draft-expiry';

/**
 * Deletes the report drafts past their seven days after a lost access, of every person, on the page
 * a person lands on to sign in (decision record 0010, the report draft amendment). Every change of
 * person on a shared phone passes this page, so the deletion never waits for the person who wrote
 * the draft. It reads one localStorage key and loads the draft store only when that key is set.
 */
export function DraftLandingSweep(): null {
  useDraftSweepOfDevice();
  return null;
}
