import { describe, expect, test } from 'bun:test';

import { subscriptionViewOf, type SubscriptionRow } from './billing-view';

// The billing page's subscription states (werk-flow/werkflow-planning#252).
// The page and the cancel action share these rules, so a change the page
// offers is one the action accepts.

const NOW = new Date('2026-11-20T08:00:00Z');
const row = (fields: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  stripe_subscription_id: 'sub_test_0001',
  status: 'active',
  cancellation_reason: null,
  cancel_at_period_end: false,
  current_period_end: '2026-12-15T10:00:00Z',
  ...fields,
});

describe('the subscription state in plain terms', () => {
  test('a pilot organization without a subscription shows none', () => {
    expect(subscriptionViewOf(null, NOW)).toBeNull();
    expect(subscriptionViewOf(row({ stripe_subscription_id: null, status: null }), NOW)).toBeNull();
  });

  test('a failed payment is open, never ended, and can still be cancelled while Stripe retries', () => {
    expect(subscriptionViewOf(row({ status: 'past_due' }), NOW)).toEqual({
      state: { kind: 'payment_open', ended: false },
      canCancel: true,
      canResume: false,
      canSubscribe: false,
    });
    // Stripe ends a subscription whose first debit failed: access stays, nothing is left to cancel,
    // and the Admin subscribes again (werk-flow/werkflow-planning#495).
    expect(
      subscriptionViewOf(row({ status: 'canceled', cancellation_reason: 'payment_failed' }), NOW),
    ).toEqual({
      state: { kind: 'payment_open', ended: true },
      canCancel: false,
      canResume: false,
      canSubscribe: true,
    });
  });

  test('a cancellation runs to the end of the paid period and can be taken back only until then', () => {
    expect(subscriptionViewOf(row({ cancel_at_period_end: true }), NOW)).toEqual({
      state: { kind: 'ending', endsAt: '2026-12-15T10:00:00Z' },
      canCancel: false,
      canResume: true,
      canSubscribe: false,
    });
    const afterTheEnd = new Date('2026-12-15T10:00:01Z');
    expect(subscriptionViewOf(row({ cancel_at_period_end: true }), afterTheEnd)?.canResume).toBe(false);
  });

  test('a status Stripe adds later offers no change', () => {
    expect(subscriptionViewOf(row({ status: 'paused' }), NOW)).toEqual({
      state: { kind: 'unknown' },
      canCancel: false,
      canResume: false,
      canSubscribe: false,
    });
  });
});
