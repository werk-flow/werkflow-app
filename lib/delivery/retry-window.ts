import type { DeliveryEntry } from './delivery-types';

// Where a delivery's row stands on the clock (list_document_deliveries sends
// retryFrom and retryUntil): crossing ten minutes or 23 hours sends no event,
// so the page follows the clock; retry_document_delivery decides.

type RetryClock = Pick<DeliveryEntry, 'state' | 'retryFrom' | 'retryUntil'>;

const instant = (value: string | null): number | null => (value === null ? null : Date.parse(value));

/** Whether „Erneut senden“ shows at `now`, and whether the current attempt went unanswered. */
export function retryWindowAt(entry: RetryClock, now: number): { retryable: boolean; unanswered: boolean } {
  const from = instant(entry.retryFrom);
  const until = instant(entry.retryUntil);
  const begun = from !== null && now >= from;
  return {
    retryable: begun && until !== null && now < until,
    unanswered: entry.state === 'sending' && begun,
  };
}

/**
 * The instant after which the row no longer changes by the clock alone; null
 * when it never does. An attempt begun late may turn unanswered after the
 * retry closed, so a sending row runs until then.
 */
export function retryWindowEnd(entry: RetryClock): number | null {
  const from = instant(entry.retryFrom);
  const until = instant(entry.retryUntil);
  if (entry.state === 'sending' && from !== null && until !== null) return Math.max(from, until);
  return until;
}
