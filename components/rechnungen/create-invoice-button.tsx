'use client';

import { ReceiptText } from 'lucide-react';
import { useState } from 'react';

import { lazyDialog } from '@/components/shared/lazy-dialog';
import { Button } from '@/components/ui/button';
import type { InvoicePreset } from './create-invoice-dialog';

// Only Admin and Büro see the button. The dialog downloads on the button's
// intent, so a page's first load, and a field worker's, never carries it.
const lazyCreateInvoiceDialog = lazyDialog(() =>
  import('./create-invoice-dialog').then((mod) => mod.PresetCreateInvoiceDialog),
);

/**
 * „Rechnung erstellen“ on a customer, job, project or Servicefall page: the
 * create dialog opens with that customer and work filled in, and the new
 * draft opens on its own page.
 */
export function CreateInvoiceButton({ preset }: { preset: InvoicePreset }) {
  const [open, setOpen] = useState(false);
  const waiting = lazyCreateInvoiceDialog.useWaiting(open);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onPointerEnter={lazyCreateInvoiceDialog.preload}
        onFocus={lazyCreateInvoiceDialog.preload}
        onClick={() => setOpen(true)}
        pending={waiting}
      >
        <ReceiptText className="size-4" />
        <span className="sr-only sm:not-sr-only">Rechnung erstellen</span>
      </Button>
      <lazyCreateInvoiceDialog.Dialog open={open} onOpenChange={setOpen} preset={preset} />
    </>
  );
}
