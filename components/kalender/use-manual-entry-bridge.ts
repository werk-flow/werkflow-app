'use client';

import { useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { entriesWithinWindow, mergeEntriesById } from '@/lib/calendar/manual-entry-merge';
import {
  consumeManualEntryBridge,
  MANUAL_ENTRY_CREATED_EVENT,
} from '@/lib/time-tracking/manual-entry-bridge';
import type { TimeEntry } from '@/lib/time-tracking/types';

/**
 * Manual time entries reach the calendar without a read: from the calendar's
 * own dialogs, from the clock elsewhere in the app (the window event) and
 * from the bridge queue a manual entry left before navigating here. Each
 * merge holds mutation ownership while it writes the range owner.
 */
export function useManualEntryBridge({
  organizationId,
  needed,
  beginOperation,
  setEntries,
}: {
  organizationId: string;
  needed: { start: Date; end: Date };
  beginOperation: () => () => void;
  setEntries: (update: (previous: TimeEntry[]) => TimeEntry[]) => void;
}): (newEntries: TimeEntry[]) => void {
  const pathname = usePathname();
  const handleManualEntrySuccess = useCallback(
    (newEntries: TimeEntry[]) => {
      const releaseOperation = beginOperation();
      try {
        const visible = entriesWithinWindow(newEntries, needed);
        if (visible.length > 0) {
          setEntries((prev) => mergeEntriesById(prev, visible));
        }
      } finally {
        releaseOperation();
      }
    },
    [needed, beginOperation, setEntries],
  );

  useEffect(() => {
    const handleExternalManualEntry = (event: Event) => {
      const newEntries = (event as CustomEvent<{ entries?: TimeEntry[] }>).detail?.entries;
      if (!newEntries?.length || newEntries.every((entry) => entry.organizationId !== organizationId)) return;
      handleManualEntrySuccess(newEntries);
    };
    window.addEventListener(MANUAL_ENTRY_CREATED_EVENT, handleExternalManualEntry);
    return () => window.removeEventListener(MANUAL_ENTRY_CREATED_EVENT, handleExternalManualEntry);
  }, [handleManualEntrySuccess, organizationId]);

  useEffect(() => {
    if (pathname !== '/kalender') return;
    const queued = consumeManualEntryBridge(organizationId);
    if (queued.length > 0) handleManualEntrySuccess(queued);
  }, [handleManualEntrySuccess, organizationId, pathname]);

  return handleManualEntrySuccess;
}
