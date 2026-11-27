'use client';

import { Send } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { usePendingTask } from '@/hooks/use-server-action';
import { useWallClockTick } from '@/hooks/use-wall-clock-tick';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import {
  DELIVERY_STATE_LABELS,
  type DeliveryEntry,
  type DeliveryList,
  type DeliveryState,
} from '@/lib/delivery/delivery-types';
import { deliveryFailureAdvice } from '@/lib/delivery/failure-advice';
import { retryWindowAt, retryWindowEnd } from '@/lib/delivery/retry-window';
import { formatBerlinDateTime } from '@/lib/utils';

// The sends of one filed document (lib/delivery/): each with its state, a
// failed or unanswered email with „Erneut senden“. Its host binds its retry
// action with useServerAction and names its refusal sentences and how its
// view reads again.

const RETRY_FAILED = 'Die E-Mail konnte nicht erneut gesendet werden. Bitte versuche es erneut.';

const STATE_BADGE: Record<DeliveryState, 'secondary' | 'success' | 'destructive'> = {
  sending: 'secondary',
  sent: 'success',
  failed: 'destructive',
};

/** A host's „Erneut senden“, its action's `run` from useServerAction. */
export type RetryDelivery = (input: {
  deliveryId: string;
  expectedAttempt: number;
}) => Promise<ActionResult<{ state: DeliveryState; failureCode: string | null }>>;

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

type RowHost = {
  retry: RetryDelivery;
  failureMessages: Readonly<Record<string, string>>;
  /** Reads the sends again after a retry: the page's refresh or the dialog's read. */
  onChange: () => void;
  /** True while the rows are not current, so no retry starts from a stale attempt. */
  stale?: boolean;
};

function DeliveryRow({ entry, host }: { entry: DeliveryEntry; host: RowHost }) {
  const { showBanner } = useBanner();
  // The row's own pending state: the host's action runs for every row.
  const { run, isPending } = usePendingTask();
  const [error, setError] = useState<string | null>(null);
  const { retryable, unanswered } = useRetryWindow(entry);
  const retry = () =>
    run(async () => {
      setError(null);
      const result = await host
        .retry({ deliveryId: entry.id, expectedAttempt: entry.attempts })
        .catch(() => null);
      if (!result) return setError(RETRY_FAILED);
      if (!result.success) return setError(describeFailure(result.error, host.failureMessages, RETRY_FAILED));
      if (result.state === 'failed')
        setError(deliveryFailureAdvice(result.failureCode, 'Versuche es später erneut.'));
      else if (result.state === 'sent')
        showBanner({ variant: 'success', message: `E-Mail an ${entry.recipient ?? ''} versendet.` });
      host.onChange();
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
          {(entry.state === 'failed' || unanswered) && (
            <p className="text-sm text-destructive">
              {deliveryFailureAdvice(unanswered ? 'email_provider_unreachable' : entry.failureCode)}
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
          disabled={isPending || host.stale}
          onClick={retry}
        >
          <Send className="size-4" />
          Erneut senden
        </Button>
      )}
    </li>
  );
}

/** The newest sends, or the empty state, and how many the list leaves out. */
export function DeliveryEntryList({
  list,
  empty,
  ...host
}: RowHost & { list: DeliveryList; empty: { title: string; description: string } }) {
  const hidden = list.total - list.entries.length;
  return (
    <>
      {list.entries.length === 0 ? (
        <EmptyState size="compact" title={empty.title} description={empty.description} />
      ) : (
        <ul className="divide-y rounded-lg border bg-card px-4 shadow-xs">
          {list.entries.map((entry) => (
            <DeliveryRow key={entry.id} entry={entry} host={host} />
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
