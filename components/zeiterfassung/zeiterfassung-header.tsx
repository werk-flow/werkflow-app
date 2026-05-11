'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ManualEntryDialog } from '@/components/manual-entry-dialog';
import { useClockState } from '@/components/clock-state-provider';
import {
  MANUAL_ENTRY_CREATED_EVENT,
  queueManualEntryBridge
} from '@/lib/time-tracking/manual-entry-bridge';

export function ZeiterfassungHeader() {
  const router = useRouter();
  const { refresh } = useClockState();

  return (
    <header className="flex items-center justify-between border-b bg-background px-4 py-3 sm:px-6 sm:py-4 sticky top-0 z-10">
      <h1 className="text-xl font-bold sm:text-2xl">Zeiterfassung</h1>
      <ManualEntryDialog
        onSuccess={async (entries) => {
          if (typeof window !== 'undefined') {
            queueManualEntryBridge(entries);
            window.dispatchEvent(
              new CustomEvent(MANUAL_ENTRY_CREATED_EVENT, {
                detail: { entries }
              })
            );
          }
          await refresh();
          router.refresh();
        }}
        trigger={
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            <span>Manuelle Eintragung</span>
          </Button>
        }
      />
    </header>
  );
}
