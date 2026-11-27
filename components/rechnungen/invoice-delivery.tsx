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
import { useMountedWallClockTick } from '@/hooks/use-wall-clock-tick';
import { describeFailure } from '@/lib/action-messages';
import {
  DELIVERY_STATE_LABELS,
  type DeliveryEntry,
  type DeliveryList,
  type DeliveryMailDefaults,
  type DeliveryState,
} from '@/lib/delivery/delivery-types';
import { deliveryOutcome, priorEmailAdvice } from '@/lib/delivery/failure-advice';
import { retryWindowAt, retryWindowEnd } from '@/lib/delivery/retry-window';
import { retryInvoiceDelivery } from '@/lib/invoices/delivery-actions';
import { formatBerlinDateTime } from '@/lib/utils';
import { ManualDeliveryDialog, SendInvoiceEmailDialog } from './invoice-delivery-dialogs';
import { DELIVERY_FAILURE_MESSAGES, RETRY_EXPIRED_UNCLEAR } from './invoice-delivery-messages';

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

/**
 * The instant after which no row changes by the clock alone; null when none
 * does. A row that offers no retry changes only when its attempt turns
 * unanswered.
 */
function lastClockChange(entries: readonly DeliveryEntry[], sendable: boolean): number | null {
  const ends = entries.flatMap((entry) => {
    const end = sendable
      ? retryWindowEnd(entry)
      : entry.state === 'sending' && entry.retryFrom
        ? Date.parse(entry.retryFrom)
        : null;
    return end === null ? [] : [end];
  });
  return ends.length > 0 ? Math.max(...ends) : null;
}

/**
 * A delivery with its state at `now`, null before hydration, so the server
 * and the hydrating render show no clock-driven text. A sendable row offers
 * „Erneut senden“ while that may help; a cancelled invoice's row names no
 * step. An attempt without the provider's answer may have reached the
 * customer, also when a later one failed.
 */
function DeliveryRow({
  entry,
  now,
  sendable,
}: {
  entry: DeliveryEntry;
  now: number | null;
  sendable: boolean;
}) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const { run, isPending } = useServerAction(retryInvoiceDelivery);
  // A retry's message belongs to the attempt it started from, and the refreshed row tells a later
  // one; a failed retry's outcome stands in for the stored one until that row arrives.
  const [error, setError] = useState<{ attempt: number; message: string; outcome: boolean } | null>(null);
  const { retryable, unanswered } =
    now === null ? { retryable: false, unanswered: false } : retryWindowAt(entry, now);
  const local = sendable && error?.attempt === entry.attempts && entry.state !== 'sent' ? error : null;
  const retry = async () => {
    const attempt = entry.attempts;
    const fail = (message: string, outcome = false) => setError({ attempt, message, outcome });
    setError(null);
    const result = await run({ deliveryId: entry.id, expectedAttempt: attempt }).catch(() => null);
    // Unclear when this row or the server's record says so: the row may predate another session's attempt.
    const unclear = entry.outcomeUnknown || unanswered;
    if (!result) return fail(RETRY_FAILED);
    if (!result.success)
      return fail(
        result.error === 'delivery_retry_expired' && unclear
          ? RETRY_EXPIRED_UNCLEAR
          : describeFailure(result.error, DELIVERY_FAILURE_MESSAGES, RETRY_FAILED),
      );
    if (result.state === 'failed')
      fail(
        deliveryOutcome(
          { failureCode: result.failureCode, outcomeUnknown: unclear || result.outcomeUnknown },
          'Versuche es später erneut.',
        ),
        true,
      );
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
          {(entry.state === 'failed' || unanswered) && !local?.outcome && (
            <p className="text-sm text-destructive">
              {deliveryOutcome(
                unanswered ? { failureCode: 'email_provider_unreachable', outcomeUnknown: true } : entry,
                sendable ? '' : null,
              )}
            </p>
          )}
          {/* A later attempt or a cancel, here or in another session, makes a retry's error stale. */}
          <ErrorText>{local?.message}</ErrorText>
        </div>
      </div>
      {sendable && retryable && (
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
  const sendable = defaults !== null;
  const clockEnd = lastClockChange(list.entries, sendable);
  const now = useMountedWallClockTick(60_000, clockEnd !== null, clockEnd);
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
          {list.entries.map((entry) => (
            <DeliveryRow key={entry.id} entry={entry} now={now} sendable={sendable} />
          ))}
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
