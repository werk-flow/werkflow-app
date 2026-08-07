import { describe, expect, test } from 'bun:test';

import {
  computeOpenSinceDays,
  dedupeAttentionItems,
  isNotificationUnread,
  isWithinNotificationWindow,
  notificationWindowStartIso,
  resolveVacationDecisionFacts,
  sortNotificationsNewestFirst,
} from './resolution';
import { attentionItemKey } from './types';
import type { AttentionNotification } from './types';

function makeDecisionRequest(overrides: {
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled';
  decidedAt?: string | null;
  cancelledAt?: string | null;
}) {
  return {
    status: overrides.status,
    decidedAt: overrides.decidedAt ?? null,
    cancelledAt: overrides.cancelledAt ?? null,
  };
}

describe('attentionItemKey', () => {
  test('is stable and unique per source_type + source_id', () => {
    expect(
      attentionItemKey({ sourceType: 'vacation_decision', sourceId: 'r1' })
    ).toBe('vacation_decision:r1');
    expect(
      attentionItemKey({ sourceType: 'vacation_decision', sourceId: 'r1' })
    ).toBe(
      attentionItemKey({ sourceType: 'vacation_decision', sourceId: 'r1' })
    );
    expect(
      attentionItemKey({
        sourceType: 'vacation_request_approval',
        sourceId: 'r1',
      })
    ).not.toBe(
      attentionItemKey({ sourceType: 'vacation_decision', sourceId: 'r1' })
    );
  });
});

describe('dedupeAttentionItems', () => {
  test('collapses the same identity from multiple derivation paths to one item', () => {
    // A substitute who is also role-eligible must never see a request twice.
    const items = [
      { sourceType: 'vacation_request_approval' as const, sourceId: 'r1' },
      { sourceType: 'vacation_request_approval' as const, sourceId: 'r1' },
      { sourceType: 'vacation_request_approval' as const, sourceId: 'r2' },
    ];
    const deduped = dedupeAttentionItems(items);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((item) => item.sourceId)).toEqual(['r1', 'r2']);
  });

  test('keeps items of different types with the same source id distinct', () => {
    const items = [
      { sourceType: 'vacation_request_approval' as const, sourceId: 'r1' },
      { sourceType: 'vacation_decision' as const, sourceId: 'r1' },
    ];
    expect(dedupeAttentionItems(items)).toHaveLength(2);
  });

  test('preserves order (first occurrence wins)', () => {
    const items = [
      { sourceType: 'client_request_open' as const, sourceId: 'b' },
      { sourceType: 'client_request_open' as const, sourceId: 'a' },
      { sourceType: 'client_request_open' as const, sourceId: 'b' },
    ];
    expect(dedupeAttentionItems(items).map((item) => item.sourceId)).toEqual([
      'b',
      'a',
    ]);
  });
});

describe('resolveVacationDecisionFacts', () => {
  test('pending and withdrawn requests produce no notification', () => {
    expect(
      resolveVacationDecisionFacts(makeDecisionRequest({ status: 'pending' }))
    ).toBeNull();
    expect(
      resolveVacationDecisionFacts(makeDecisionRequest({ status: 'withdrawn' }))
    ).toBeNull();
  });

  test('approval and rejection version on the decision timestamp', () => {
    const approved = resolveVacationDecisionFacts(
      makeDecisionRequest({
        status: 'approved',
        decidedAt: '2026-08-07T10:00:00Z',
      })
    );
    expect(approved).toEqual({
      status: 'approved',
      stateVersion: 'approved:2026-08-07T10:00:00Z',
      occurredAt: '2026-08-07T10:00:00Z',
    });

    const rejected = resolveVacationDecisionFacts(
      makeDecisionRequest({
        status: 'rejected',
        decidedAt: '2026-08-07T11:00:00Z',
      })
    );
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.stateVersion).toBe('rejected:2026-08-07T11:00:00Z');
  });

  test('cancellation of an approved request changes the version of the SAME item', () => {
    // Deduplication contract: approve → cancel is one notification whose
    // state version moves, never a second notification row.
    const approved = resolveVacationDecisionFacts(
      makeDecisionRequest({
        status: 'approved',
        decidedAt: '2026-08-07T10:00:00Z',
      })
    );
    const cancelled = resolveVacationDecisionFacts(
      makeDecisionRequest({
        status: 'cancelled',
        decidedAt: '2026-08-07T10:00:00Z',
        cancelledAt: '2026-08-08T09:00:00Z',
      })
    );
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.occurredAt).toBe('2026-08-08T09:00:00Z');
    expect(cancelled?.stateVersion).not.toBe(approved?.stateVersion);
  });

  test('decision states without their timestamp produce no notification', () => {
    expect(
      resolveVacationDecisionFacts(
        makeDecisionRequest({ status: 'approved', decidedAt: null })
      )
    ).toBeNull();
    expect(
      resolveVacationDecisionFacts(
        makeDecisionRequest({ status: 'cancelled', cancelledAt: null })
      )
    ).toBeNull();
  });
});

describe('isNotificationUnread', () => {
  test('unread without a marker, read at exactly the seen version', () => {
    expect(isNotificationUnread('approved:t1', null)).toBe(true);
    expect(isNotificationUnread('approved:t1', 'approved:t1')).toBe(false);
  });

  test('a domain state change makes the item unread again', () => {
    // The user read the approval; the later cancellation must resurface it.
    expect(isNotificationUnread('cancelled:t2', 'approved:t1')).toBe(true);
  });
});

describe('isWithinNotificationWindow', () => {
  test('recent decisions are inside, old ones outside', () => {
    expect(
      isWithinNotificationWindow('2026-08-01T10:00:00Z', '2026-08-07')
    ).toBe(true);
    expect(
      isWithinNotificationWindow('2026-01-01T10:00:00Z', '2026-08-07')
    ).toBe(false);
  });

  test('the boundary day is inclusive and DST-independent', () => {
    // Exactly NOTIFICATION_WINDOW_DAYS ago at the UTC day start.
    const businessToday = '2026-08-07';
    const boundary = notificationWindowStartIso(businessToday);
    expect(isWithinNotificationWindow(boundary, businessToday)).toBe(true);
    expect(
      isWithinNotificationWindow(
        new Date(Date.parse(boundary) - 1).toISOString(),
        businessToday
      )
    ).toBe(false);
  });

  test('unparseable timestamps are excluded, not crashing', () => {
    expect(isWithinNotificationWindow('not-a-date', '2026-08-07')).toBe(false);
  });
});

describe('computeOpenSinceDays', () => {
  test('same business day is 0, yesterday is 1', () => {
    expect(computeOpenSinceDays('2026-08-07', '2026-08-07')).toBe(0);
    expect(computeOpenSinceDays('2026-08-06', '2026-08-07')).toBe(1);
  });

  test('month boundaries count calendar days', () => {
    expect(computeOpenSinceDays('2026-07-28', '2026-08-07')).toBe(10);
  });

  test('a future received date clamps to 0 instead of going negative', () => {
    expect(computeOpenSinceDays('2026-08-09', '2026-08-07')).toBe(0);
  });
});

describe('sortNotificationsNewestFirst', () => {
  test('orders by occurrence time descending without mutating the input', () => {
    const older: AttentionNotification = {
      sourceType: 'vacation_decision',
      sourceId: 'r1',
      status: 'approved',
      startDate: '2026-08-10',
      endDate: '2026-08-10',
      dayPortion: 'full',
      comment: null,
      stateVersion: 'approved:2026-08-01T10:00:00Z',
      occurredAt: '2026-08-01T10:00:00Z',
      unread: false,
    };
    const newer: AttentionNotification = {
      ...older,
      sourceId: 'r2',
      stateVersion: 'approved:2026-08-05T10:00:00Z',
      occurredAt: '2026-08-05T10:00:00Z',
    };
    const input = [older, newer];
    const sorted = sortNotificationsNewestFirst(input);
    expect(sorted.map((notification) => notification.sourceId)).toEqual([
      'r2',
      'r1',
    ]);
    expect(input.map((notification) => notification.sourceId)).toEqual([
      'r1',
      'r2',
    ]);
  });
});
