'use client';

import { Send } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { usePendingTask } from '@/hooks/use-server-action';
import { useMountedWallClockTick } from '@/hooks/use-wall-clock-tick';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import {
  DELIVERY_STATE_LABELS,
  type DeliveryEntry,
  type DeliveryList,
  type DeliveryState,
} from '@/lib/delivery/delivery-types';
import { deliveryOutcome } from '@/lib/delivery/failure-advice';
import { retryWindowAt, retryWindowEnd } from '@/lib/delivery/retry-window';
import { formatBerlinDateTime } from '@/lib/utils';
import { RETRY_EXPIRED_UNCLEAR } from './delivery-messages';

// The sends of one filed document (lib/delivery/): each with its state, a
// failed or unanswered email with „Erneut senden“. Its host binds its retry
// action with useServerAction and names its refusal sentences and how its
// view reads again; a document that takes no further send, such as a
// cancelled invoice, passes no host and lists its sends read-only.

const RETRY_FAILED = 'Die E-Mail konnte nicht erneut gesendet werden. Bitte versuche es erneut.';

const STATE_BADGE: Record<DeliveryState, 'secondary' | 'success' | 'destructive'> = {
  sending: 'secondary',
  sent: 'success',
  failed: 'destructive',
};

/**
 * A host's „Erneut senden“, its action's `run` from useServerAction; it
 * answers whether the delivery's record holds an attempt without an answer,
 * which a row that predates it does not show.
 */
export type RetryDelivery = (input: {
  deliveryId: string;
  expectedAttempt: number;
}) => Promise<ActionResult<{ state: DeliveryState; failureCode: string | null; outcomeUnknown: boolean }>>;

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

type RowHost = {
  retry: RetryDelivery;
  failureMessages: Readonly<Record<string, string>>;
  /** Reads the sends again after a retry: the page's refresh or the dialog's read. */
  onChange: () => void;
  /** True while the rows are not current, so no retry starts from a stale attempt. */
  stale?: boolean;
};

/**
 * What a retry's answer tells the office, and whether it stands in for the
 * row's stored outcome; null when it went out or is still sending.
 */
function retryFeedback(
  result: Awaited<ReturnType<RetryDelivery>> | null,
  failureMessages: Readonly<Record<string, string>>,
  unclear: boolean,
): { message: string; outcome: boolean } | null {
  if (!result) return { message: RETRY_FAILED, outcome: false };
  if (!result.success) {
    const message =
      result.error === 'delivery_retry_expired' && unclear
        ? RETRY_EXPIRED_UNCLEAR
        : describeFailure(result.error, failureMessages, RETRY_FAILED);
    return { message, outcome: false };
  }
  if (result.state !== 'failed') return null;
  const outcomeUnknown = unclear || result.outcomeUnknown;
  return {
    message: deliveryOutcome(
      { failureCode: result.failureCode, outcomeUnknown },
      'Versuche es später erneut.',
    ),
    outcome: true,
  };
}

/**
 * A delivery with its state at `now`, null before hydration, so the server
 * and the hydrating render show no clock-driven text. With a host the row
 * offers „Erneut senden“ while that may help; without one it names no step.
 * An attempt without the provider's answer may have reached the customer,
 * also when a later one failed.
 */
function DeliveryRow({
  entry,
  now,
  host,
}: {
  entry: DeliveryEntry;
  now: number | null;
  host: RowHost | null;
}) {
  const { showBanner } = useBanner();
  // The row's own pending state: the host's action runs for every row.
  const { run, isPending } = usePendingTask();
  // A retry's message belongs to the attempt it started from, and the refreshed row tells a later
  // one; a failed retry's outcome stands in for the stored one until that row arrives.
  const [error, setError] = useState<{ attempt: number; message: string; outcome: boolean } | null>(null);
  const { retryable, unanswered } =
    now === null ? { retryable: false, unanswered: false } : retryWindowAt(entry, now);
  const local = host && error?.attempt === entry.attempts && entry.state !== 'sent' ? error : null;
  const retry = (retryHost: RowHost) =>
    run(async () => {
      const attempt = entry.attempts;
      setError(null);
      const result = await retryHost
        .retry({ deliveryId: entry.id, expectedAttempt: attempt })
        .catch(() => null);
      // Unclear when this row or the server's record says so: the row may predate another session's attempt.
      const feedback = retryFeedback(result, retryHost.failureMessages, entry.outcomeUnknown || unanswered);
      if (feedback) setError({ attempt, ...feedback });
      if (result?.success && result.state === 'sent')
        showBanner({ variant: 'success', message: `E-Mail an ${entry.recipient ?? ''} versendet.` });
      if (result?.success) retryHost.onChange();
    });
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
                host ? '' : null,
              )}
            </p>
          )}
          {/* A later attempt or a read-only list, here or in another session, makes a retry's error stale. */}
          <ErrorText>{local?.message}</ErrorText>
        </div>
      </div>
      {host && retryable && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          pending={isPending}
          disabled={isPending || host.stale}
          onClick={() => retry(host)}
        >
          <Send className="size-4" />
          Erneut senden
        </Button>
      )}
    </li>
  );
}

/**
 * The newest sends, or the empty state, and how many the list leaves out.
 * Without a `host` the list is read-only: no row offers a retry.
 */
export function DeliveryEntryList({
  list,
  empty,
  host,
}: {
  list: DeliveryList;
  empty: { title: string; description: string };
  host: RowHost | null;
}) {
  const hidden = list.total - list.entries.length;
  const clockEnd = lastClockChange(list.entries, host !== null);
  const now = useMountedWallClockTick(60_000, clockEnd !== null, clockEnd);
  return (
    <>
      {list.entries.length === 0 ? (
        <EmptyState size="compact" title={empty.title} description={empty.description} />
      ) : (
        <ul className="divide-y rounded-lg border bg-card px-4 shadow-xs">
          {list.entries.map((entry) => (
            <DeliveryRow key={entry.id} entry={entry} now={now} host={host} />
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <p className="text-sm text-muted-foreground">
          Gezeigt werden die letzten {list.entries.length} von {list.total} Versendungen.
        </p>
      )}
    </>
  );
}
