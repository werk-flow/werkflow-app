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
import { useMountedWallClockTick, useWallClockTick } from '@/hooks/use-wall-clock-tick';
import { describeFailure } from '@/lib/action-messages';
import {
  DELIVERY_STATE_LABELS,
  type DeliveryEntry,
  type DeliveryList,
  type DeliveryMailDefaults,
  type DeliveryState,
} from '@/lib/delivery/delivery-types';
import { deliveryFailureAdvice, pastDeliveryOutcome, priorEmailAdvice } from '@/lib/delivery/failure-advice';
import { retryWindowAt, retryWindowEnd } from '@/lib/delivery/retry-window';
import { retryInvoiceDelivery } from '@/lib/invoices/delivery-actions';
import { formatBerlinDateTime } from '@/lib/utils';
import { ManualDeliveryDialog, SendInvoiceEmailDialog } from './invoice-delivery-dialogs';
import { DELIVERY_FAILURE_MESSAGES } from './invoice-delivery-messages';

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

/** The row's retry window by the minute tick, until the clock can no longer change it. */
function useRetryWindow(entry: DeliveryEntry): { retryable: boolean; unanswered: boolean } {
  const end = retryWindowEnd(entry);
  return retryWindowAt(entry, useWallClockTick(60_000, end !== null, end));
}

/** A delivery's state, what went out how, and when by whom; `children` adds the row's advice. */
function DeliveryFacts({ entry, children }: { entry: DeliveryEntry; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 sm:flex-row sm:gap-3">
      <Badge variant={STATE_BADGE[entry.state]}>{DELIVERY_STATE_LABELS[entry.state]}</Badge>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium wrap-anywhere">{deliveryTitle(entry)}</p>
        <p className="text-xs text-muted-foreground wrap-anywhere">{deliveryMeta(entry)}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * A delivery of a cancelled invoice: what happened to it, with no step to
 * take. Only a sending row changes by the clock, when its attempt goes
 * unanswered; an attempt without the provider's answer may have reached the
 * customer, also when a later one failed.
 */
function PastDeliveryRow({ entry }: { entry: DeliveryEntry }) {
  const unansweredFrom = entry.state === 'sending' && entry.retryFrom ? Date.parse(entry.retryFrom) : null;
  // The server and the hydrating render show no clock-driven text, so both render the same.
  const now = useMountedWallClockTick(60_000, unansweredFrom !== null, unansweredFrom);
  const unanswered = now !== null && retryWindowAt(entry, now).unanswered;
  return (
    <li className="py-3">
      <DeliveryFacts entry={entry}>
        {(entry.state === 'failed' || unanswered) && (
          <p className="text-sm text-destructive">
            {unanswered
              ? pastDeliveryOutcome({ failureCode: 'email_provider_unreachable', outcomeUnknown: true })
              : pastDeliveryOutcome(entry)}
          </p>
        )}
      </DeliveryFacts>
    </li>
  );
}

/** A delivery of an invoice the office can still send: its state, and „Erneut senden“ while that may help. */
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
      setError(deliveryFailureAdvice(result.failureCode, 'Versuche es später erneut.'));
    else if (result.state === 'sent')
      showBanner({ variant: 'success', message: `E-Mail an ${entry.recipient ?? ''} versendet.` });
    router.refresh();
  };
  return (
    <li
      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-3"
      aria-busy={isPending || undefined}
    >
      <DeliveryFacts entry={entry}>
        {(entry.state === 'failed' || unanswered) && (
          <p className="text-sm text-destructive">
            {deliveryFailureAdvice(unanswered ? 'email_provider_unreachable' : entry.failureCode)}
          </p>
        )}
        {/* A later send, here or in another session, makes an earlier retry's error stale. */}
        <ErrorText>{entry.state === 'sent' ? null : error}</ErrorText>
      </DeliveryFacts>
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
  const [open, setOpen] = useState<'email' | 'manual' | null>(null);
  const hidden = list.total - list.entries.length;
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
      {list.entries.length === 0 ? (
        <EmptyState
          size="compact"
          {...(defaults
            ? {
                title: 'Noch kein Versand.',
                description: 'Sende die Rechnung per E-Mail oder vermerke, dass sie per Post rausging.',
              }
            : {
                title: 'Nicht versendet.',
                description: 'Die Rechnung ist storniert und wird nicht mehr versendet.',
              })}
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card px-4 shadow-xs">
          {list.entries.map((entry) =>
            defaults ? (
              <DeliveryRow key={entry.id} entry={entry} />
            ) : (
              <PastDeliveryRow key={entry.id} entry={entry} />
            ),
          )}
        </ul>
      )}
      {hidden > 0 && (
        <p className="text-sm text-muted-foreground">
          Gezeigt werden die letzten {list.entries.length} von {list.total} Versendungen.
        </p>
      )}
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
