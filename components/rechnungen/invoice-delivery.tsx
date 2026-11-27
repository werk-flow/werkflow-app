'use client';

import { Mail, Stamp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { DeliveryEntryList } from '@/components/delivery/delivery-entry-list';
import { SectionTitle } from '@/components/shared/section-title';
import { Button } from '@/components/ui/button';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { useServerAction } from '@/hooks/use-server-action';
import type { DeliveryList, DeliveryMailDefaults } from '@/lib/delivery/delivery-types';
import { priorEmailAdvice } from '@/lib/delivery/failure-advice';
import { retryInvoiceDelivery } from '@/lib/invoices/delivery-actions';
import { ManualDeliveryDialog, SendInvoiceEmailDialog } from './invoice-delivery-dialogs';
import { DELIVERY_FAILURE_MESSAGES } from './invoice-delivery-messages';

/**
 * „Versand“ of an issued invoice: send it by email, mark it as sent by post
 * or by hand, and every delivery with its state, a failed one with „Erneut
 * senden“. A cancelled invoice is never sent again: it lists its deliveries
 * only. Other sessions' sends arrive through Realtime.
 */
export function InvoiceDeliveries({
  invoiceId,
  invoiceNumber,
  list,
  defaults,
}: {
  invoiceId: string;
  invoiceNumber: string;
  list: DeliveryList;
  /** What the email form proposes; null for a cancelled invoice, which takes no further send. */
  defaults: DeliveryMailDefaults | null;
}) {
  useRealtimeRouterRefresh({ tables: ['document_deliveries'] });
  const router = useRouter();
  const retry = useServerAction(retryInvoiceDelivery);
  const [open, setOpen] = useState<'email' | 'manual' | null>(null);
  return (
    <section aria-labelledby="invoice-delivery-title" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle as="h2" id="invoice-delivery-title" className="mr-auto">
          Versand
        </SectionTitle>
        {defaults && (
          <>
            <Button type="button" variant="outline" onClick={() => setOpen('manual')}>
              <Stamp className="size-4" />
              Als manuell versendet markieren
            </Button>
            <Button type="button" onClick={() => setOpen('email')}>
              <Mail className="size-4" />
              Per E-Mail senden
            </Button>
          </>
        )}
      </div>
      <DeliveryEntryList
        list={list}
        empty={
          defaults
            ? {
                title: 'Noch kein Versand.',
                description: 'Sende die Rechnung per E-Mail oder vermerke, dass sie per Post rausging.',
              }
            : {
                title: 'Nicht versendet.',
                description: 'Die Rechnung ist storniert und wird nicht mehr versendet.',
              }
        }
        host={
          defaults && {
            retry: retry.run,
            failureMessages: DELIVERY_FAILURE_MESSAGES,
            onChange: () => router.refresh(),
          }
        }
      />
      {defaults && open === 'email' && (
        <SendInvoiceEmailDialog
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          defaults={defaults}
          sentBefore={priorEmailAdvice(list.entries)}
          onClose={() => setOpen(null)}
        />
      )}
      {defaults && open === 'manual' && (
        <ManualDeliveryDialog invoiceId={invoiceId} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}
