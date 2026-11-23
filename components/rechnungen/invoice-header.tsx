'use client';

import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { Button } from '@/components/ui/button';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { deleteInvoiceDraft } from '@/lib/invoices/actions';
import type { InvoiceDetail } from '@/lib/invoices/types';
import { INVOICE_FAILURE_MESSAGES } from './invoice-failure-messages';

const DELETE_FAILED = INVOICE_FAILURE_MESSAGES.delete_failed ?? '';

/** Customer, Rechnungsempfänger and the work the draft bills. */
export function InvoiceFacts({ invoice }: { invoice: InvoiceDetail }) {
  return (
    <dl className="grid gap-4 rounded-lg border bg-card p-4 text-sm shadow-xs sm:grid-cols-3 sm:p-5">
      <div className="min-w-0 space-y-1">
        <dt className="text-muted-foreground">Kunde</dt>
        <dd className="wrap-anywhere">
          <Link
            href={`/kunden/${invoice.client.id}`}
            className="font-medium text-primary-text hover:underline"
          >
            {invoice.client.name}
          </Link>
        </dd>
      </div>
      <div className="min-w-0 space-y-1">
        <dt className="text-muted-foreground">Rechnungsempfänger</dt>
        <dd className="wrap-anywhere">
          <p className="font-medium">{invoice.recipient.name}</p>
          {invoice.recipient.address && <p className="text-muted-foreground">{invoice.recipient.address}</p>}
        </dd>
      </div>
      <div className="min-w-0 space-y-1">
        <dt className="text-muted-foreground">Abrechnen für</dt>
        <dd className="wrap-anywhere">
          {invoice.work ? (
            <Link href={invoice.work.href} className="font-medium text-primary-text hover:underline">
              {invoice.work.label}
            </Link>
          ) : (
            <span className="text-muted-foreground">Ohne Bezug</span>
          )}
        </dd>
      </div>
    </dl>
  );
}

/** „Entwurf löschen“: a draft has no number, so it leaves no gap; its history stays. */
export function DeleteInvoiceDraftButton({ invoice }: { invoice: InvoiceDetail }) {
  const router = useRouter();
  const [attemptKey] = useState(() => crypto.randomUUID());
  const { run: runDelete } = useServerAction(deleteInvoiceDraft);
  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" size="sm">
          <Trash2 className="size-4" />
          Entwurf löschen
        </Button>
      }
      title={`Entwurf für „${invoice.client.name}“ löschen?`}
      description="Der Entwurf und seine Positionen werden gelöscht. Das lässt sich nicht rückgängig machen."
      confirmLabel="Endgültig löschen"
      variant="destructive"
      onConfirm={async () => {
        const result = await runDelete({
          invoiceId: invoice.id,
          expectedVersion: invoice.version,
          attemptKey,
        }).catch(() => null);
        if (!result?.success) {
          return result
            ? describeFailure(result.error, INVOICE_FAILURE_MESSAGES, DELETE_FAILED)
            : DELETE_FAILED;
        }
        router.push(`/rechnungen?deleted_invoice=${encodeURIComponent(invoice.client.name)}`);
        return null;
      }}
    />
  );
}
