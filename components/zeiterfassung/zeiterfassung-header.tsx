'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ManualEntryDialog } from '@/components/manual-entry-dialog';

export function ZeiterfassungHeader() {
  return (
    <header className="flex items-center justify-between border-b bg-background px-4 py-3 sm:px-6 sm:py-4 sticky top-0 z-10">
      <h1 className="text-xl font-bold sm:text-2xl">Zeiterfassung</h1>
      <ManualEntryDialog
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
