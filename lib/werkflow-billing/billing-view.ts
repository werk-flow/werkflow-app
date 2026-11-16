import type { Database } from '@/lib/supabase/database.types';

// What the Admin's billing page shows of WerkFlow's own subscription and
// invoices (werk-flow/werkflow-planning#252), from WerkFlow's records. The
// page and the cancel action share these rules, so the page offers only what
// the action accepts.

/** The columns of an organization's `werkflow_subscriptions` row the page reads. */
export type SubscriptionRow = Pick<
  Database['public']['Tables']['werkflow_subscriptions']['Row'],
  'stripe_subscription_id' | 'status' | 'cancellation_reason' | 'cancel_at_period_end' | 'current_period_end'
>;

type InvoiceRow = Pick<
  Database['public']['Tables']['werkflow_invoices']['Row'],
  | 'id'
  | 'number'
  | 'issue_date'
  | 'type_code'
  | 'line_names'
  | 'service_start'
  | 'service_end'
  | 'gross_cents'
  | 'due_cents'
>;

/**
 * The subscription in the page's terms. `ending` is a cancellation that takes
 * effect at the end of the paid period (owner, 2026-11-15): access runs until
 * `endsAt`. A failed payment never ends access in stage A.
 */
export type SubscriptionState =
  | { kind: 'active'; renewsAt: string | null }
  | { kind: 'ending'; endsAt: string | null }
  | { kind: 'payment_open' }
  | { kind: 'ended'; endedAt: string | null }
  | { kind: 'unknown' };

export type SubscriptionView = {
  state: SubscriptionState;
  canCancel: boolean;
  canResume: boolean;
};

export type WerkflowInvoiceView = {
  id: string;
  number: string;
  issueDate: string;
  /** A Stornorechnung cancels an earlier invoice. */
  isStorno: boolean;
  /** The names of the invoice's lines, as its original states them. */
  lineNames: string[];
  servicePeriod: { start: string; end: string } | null;
  grossCents: number;
  dueCents: number;
};

const RUNNING = new Set(['active', 'trialing']);
const PAYMENT_OPEN = new Set(['past_due', 'unpaid', 'incomplete']);
/** A subscription Stripe still renews, so its end can be set or taken back. */
const CHANGEABLE = new Set(['active', 'trialing', 'past_due', 'unpaid']);
const ENDED = new Set(['canceled', 'incomplete_expired']);

function stateOf(row: SubscriptionRow): SubscriptionState {
  const status = row.status ?? '';
  if (row.cancel_at_period_end && !ENDED.has(status)) {
    return { kind: 'ending', endsAt: row.current_period_end };
  }
  if (RUNNING.has(status)) return { kind: 'active', renewsAt: row.current_period_end };
  // Stripe ends a subscription whose first debit failed; access stays (no lockout in stage A).
  if (PAYMENT_OPEN.has(status) || (status === 'canceled' && row.cancellation_reason === 'payment_failed')) {
    return { kind: 'payment_open' };
  }
  if (ENDED.has(status)) return { kind: 'ended', endedAt: row.current_period_end };
  return { kind: 'unknown' };
}

/** The organization's subscription for the page; null before the first one, as for a pilot organization. */
export function subscriptionViewOf(row: SubscriptionRow | null, now: Date): SubscriptionView | null {
  if (!row?.stripe_subscription_id) return null;
  const changeable = CHANGEABLE.has(row.status ?? '');
  const periodRuns = row.current_period_end === null || Date.parse(row.current_period_end) > now.getTime();
  return {
    state: stateOf(row),
    canCancel: changeable && !row.cancel_at_period_end,
    canResume: changeable && row.cancel_at_period_end && periodRuns,
  };
}

export function invoiceViewOf(row: InvoiceRow): WerkflowInvoiceView {
  return {
    id: row.id,
    number: row.number,
    issueDate: row.issue_date,
    isStorno: row.type_code === '384',
    lineNames: row.line_names,
    servicePeriod:
      row.service_start && row.service_end ? { start: row.service_start, end: row.service_end } : null,
    grossCents: row.gross_cents,
    dueCents: row.due_cents,
  };
}
