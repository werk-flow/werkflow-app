'use client';

import { History } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { lazyDialog } from '@/components/shared/lazy-dialog';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/use-hydrated';
import type { FieldEquipmentRecordDialogProps } from './field-equipment-record-dialog';

const lazyRecordDialog = lazyDialog<FieldEquipmentRecordDialogProps>(() =>
  import('./field-equipment-record-dialog').then((mod) => mod.FieldEquipmentRecordDialog),
);

/** Opens „Verlauf und Dokumente“ of one Anlage; the dialog loads on the worker's intent. */
export function FieldEquipmentRecordButton({
  jobId,
  equipment,
}: Pick<FieldEquipmentRecordDialogProps, 'jobId' | 'equipment'>): ReactElement {
  const [open, setOpen] = useState(false);
  const waiting = lazyRecordDialog.useWaiting(open);
  // Server markup has no click handler yet: a tap before hydration would be lost.
  const hydrated = useHydrated();
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 w-full sm:w-auto"
        aria-label={`Verlauf und Dokumente von ${equipment.name}`}
        pending={waiting}
        disabled={!hydrated}
        onPointerEnter={lazyRecordDialog.preload}
        onFocus={lazyRecordDialog.preload}
        onClick={() => setOpen(true)}
      >
        <History />
        Verlauf und Dokumente
      </Button>
      {open && (
        <lazyRecordDialog.Dialog open={open} onOpenChange={setOpen} jobId={jobId} equipment={equipment} />
      )}
    </>
  );
}
