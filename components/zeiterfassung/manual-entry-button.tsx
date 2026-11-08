'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ManualEntryDialog, useManualEntryCopy } from '@/components/manual-entry-dialog';
import { useClockState } from '@/components/clock-state-provider';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { MANUAL_ENTRY_CREATED_EVENT, queueManualEntryBridge } from '@/lib/time-tracking/manual-entry-bridge';

/** The overview's toolbar action: opens the manual entry dialog („Zeit nachtragen“ for an employee). */
export function ManualEntryButton({ currentUserId }: { currentUserId: string }) {
  const onSuccess = useManualEntryCreated(currentUserId);
  const { title } = useManualEntryCopy();

  return (
    <ManualEntryDialog
      onSuccess={onSuccess}
      trigger={
        <Button size="default" className="gap-2">
          <Plus className="size-4" />
          <span>{title}</span>
        </Button>
      }
    />
  );
}

/** After a save: hands the new entries to the calendar and refreshes the live clock. */
function useManualEntryCreated(currentUserId: string): (entries: TimeEntry[]) => Promise<void> {
  const { refresh } = useClockState();
  return async (entries) => {
    if (typeof window !== 'undefined') {
      queueManualEntryBridge(currentUserId, entries);
      window.dispatchEvent(
        new CustomEvent(MANUAL_ENTRY_CREATED_EVENT, {
          detail: { entries },
        }),
      );
    }
    // addManualEntry revalidates, so its response already renders the route.
    await refresh();
  };
}
