'use client';

import { Mail, Send, Stamp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { SectionTitle } from '@/components/shared/section-title';
import { Badge } from '@/components/ui/badge';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { useServerAction } from '@/hooks/use-server-action';
import { useWallClockTick } from '@/hooks/use-wall-clock-tick';
import { describeFailure } from '@/lib/action-messages';
import {
  DELIVERY_STATE_LABELS,
  type DeliveryEntry,
  type DeliveryList,
  type DeliveryMailDefaults,
  type DeliveryState,
} from '@/lib/delivery/delivery-types';
import { retryInvoiceDelivery } from '@/lib/invoices/delivery-actions';
import { formatBerlinDateTime } from '@/lib/utils';
import { ManualDeliveryDialog, SendInvoiceEmailDialog } from './invoice-delivery-dialogs';
import { DELIVERY_FAILURE_MESSAGES, deliveryFailureSentence } from './invoice-delivery-messages';

const RETRY_FAILED = 'Die E-Mail konnte nicht erneut gesendet werden. Bitte versuche es erneut.';

const STATE_BADGE: Record<DeliveryState, 'secondary' | 'success' | 'destructive'> = {
  sending: 'secondary',
  sent: 'success',
  failed: 'destructive',
};

/** What went out how: the address of an email, the office's note of a manual send. */
function deliveryTitle(entry: DeliveryEntry): string {
  if (entry.channel === 'email') return `E-Mail an ${entry.recipient ?? ''}`;
  return entry.note ? `Manuell versendet: ${entry.note}` : 'Manuell versendet';
}

function deliveryMeta(entry: DeliveryEntry): string {
  const parts = [formatBerlinDateTime(entry.sentAt ?? entry.createdAt)];
  if (entry.createdBy) parts.push(entry.createdBy);
  if (entry.attempts > 1) parts.push(`${entry.attempts} Versuche`);
  return parts.join(' · ');
}

const instant = (value: string | null): number | null => (value === null ? null : Date.parse(value));

/**
 * Whether „Erneut senden“ shows now, and whether an attempt went unanswered,
 * by the minute tick: crossing ten minutes or 23 hours sends no event, so the
 * page follows the clock; retry_document_delivery decides.
 */
function useRetryWindow(entry: DeliveryEntry): { retryable: boolean; unanswered: boolean } {
  const from = instant(entry.retryFrom);
  const until = instant(entry.retryUntil);
  const now = useWallClockTick(60_000, until !== null, until);
  const begun = from !== null && now >= from;
  return {
    retryable: begun && until !== null && now < until,
    unanswered: entry.state === 'sending' && begun,
  };
}

function DeliveryRow({ entry }: { entry: DeliveryEntry }) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const { run, isPending } = useServerAction(retryInvoiceDelivery);
  const [error, setError] = useState<string | null>(null);
  const { retryable, unanswered } = useRetryWindow(entry);
  const retry = async () => {
    setError(null);
    const result = await run({ deliveryId: entry.id, expectedAttempt: entry.attempts }).catch(() => null);
    if (!result) return setError(RETRY_FAILED);
    if (!result.success)
      return setError(describeFailure(result.error, DELIVERY_FAILURE_MESSAGES, RETRY_FAILED));
    if (result.state === 'failed')
      setError(`${deliveryFailureSentence(result.failureCode)} Versuche es später erneut.`);
    else if (result.state === 'sent')
      showBanner({ variant: 'success', message: `E-Mail an ${entry.recipient ?? ''} versendet.` });
    router.refresh();
  };
  return (
    <li
      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-3"
      aria-busy={isPending || undefined}
    >
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 sm:flex-row sm:gap-3">
        <Badge variant={STATE_BADGE[entry.state]}>{DELIVERY_STATE_LABELS[entry.state]}</Badge>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-medium wrap-anywhere">{deliveryTitle(entry)}</p>
          <p className="text-xs text-muted-foreground wrap-anywhere">{deliveryMeta(entry)}</p>
          {(entry.state === 'failed' || unanswered) && (
            <p className="text-sm text-destructive">
              {deliveryFailureSentence(unanswered ? 'email_provider_unreachable' : entry.failureCode)}
            </p>
          )}
          {/* A later send, here or in another session, makes an earlier retry's error stale. */}
          <ErrorText>{entry.state === 'sent' ? null : error}</ErrorText>
        </div>
      </div>
      {retryable && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          pending={isPending}
          disabled={isPending}
          onClick={retry}
        >
          <Send className="size-4" />
          Erneut senden
        </Button>
      )}
    </li>
  );
}

/** The last email that went out, so the dialog can say the invoice was sent before. */
function lastEmailSent(list: DeliveryList): string | null {
  const sent = list.entries.find((entry) => entry.channel === 'email' && entry.state === 'sent');
  if (!sent?.sentAt) return null;
  return `Zuletzt ging sie am ${formatBerlinDateTime(sent.sentAt)} an ${sent.recipient ?? ''} raus.`;
}

/**
 * „Versand“ of an issued invoice: send it by email, mark it as sent by post
 * or by hand, and every delivery with its state, a failed one with „Erneut
 * senden“. Other sessions' sends arrive through Realtime.
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
  defaults: DeliveryMailDefaults;
}) {
  useRealtimeRouterRefresh({ tables: ['document_deliveries'] });
  const [open, setOpen] = useState<'email' | 'manual' | null>(null);
  const hidden = list.total - list.entries.length;
  return (
    <section aria-labelledby="invoice-delivery-title" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle as="h2" id="invoice-delivery-title" className="mr-auto">
          Versand
        </SectionTitle>
        <Button type="button" variant="outline" onClick={() => setOpen('manual')}>
          <Stamp className="size-4" />
          Als manuell versendet markieren
        </Button>
        <Button type="button" onClick={() => setOpen('email')}>
          <Mail className="size-4" />
          Per E-Mail senden
        </Button>
      </div>
      {list.entries.length === 0 ? (
        <EmptyState
          size="compact"
          title="Noch kein Versand."
          description="Sende die Rechnung per E-Mail oder vermerke, dass sie per Post rausging."
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card px-4 shadow-xs">
          {list.entries.map((entry) => (
            <DeliveryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <p className="text-sm text-muted-foreground">
          Gezeigt werden die letzten {list.entries.length} von {list.total} Versendungen.
        </p>
      )}
      {open === 'email' && (
        <SendInvoiceEmailDialog
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          defaults={defaults}
          sentBefore={lastEmailSent(list)}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'manual' && <ManualDeliveryDialog invoiceId={invoiceId} onClose={() => setOpen(null)} />}
    </section>
  );
}
