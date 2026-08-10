import { describe, expect, test } from 'bun:test';

import {
  buildTimelinePage,
  decodeTimelineCursor,
  isFollowUpOverdue,
  resolveCommunicationGuidance,
  timelineItemKey,
} from './resolution';
import type {
  CommunicationPreference,
  CommunicationSettings,
  TimelineItem,
} from './types';

function timelineItem(
  stableKey: string,
  occurredAt: string,
  overrides: Partial<TimelineItem> = {}
): TimelineItem {
  return {
    stableKey,
    kind: 'job_created',
    category: 'work',
    sourceId: stableKey,
    occurredAt,
    actorId: null,
    actorName: null,
    reference: stableKey,
    detail: null,
    sourceHref: null,
    sourceAvailable: false,
    currentStateOnly: true,
    metadata: {},
    ...overrides,
  };
}

function preference(
  overrides: Partial<CommunicationPreference>
): CommunicationPreference {
  return {
    id: 'preference-1',
    clientId: 'client-1',
    contactId: null,
    channel: 'phone',
    purpose: 'appointment_service',
    state: 'unknown',
    sourceNote: null,
    updatedBy: 'user-1',
    updatedAt: '2026-08-10T08:00:00.000Z',
    ...overrides,
  };
}

const SETTINGS: CommunicationSettings = {
  id: 'settings-1',
  clientId: 'client-1',
  preferredContactId: null,
  preferredChannel: null,
  doNotContactInstruction: null,
  contactTimeNote: null,
  languageNote: null,
  accessibilityNote: null,
  sourceNote: null,
  updatedBy: 'user-1',
  updatedAt: '2026-08-10T08:00:00.000Z',
};

describe('customer timeline resolution', () => {
  test('uses source kind and source id as stable identity', () => {
    expect(timelineItemKey('job_created', 'source-1')).toBe(
      'job_created:source-1'
    );
    expect(timelineItemKey('project_created', 'source-1')).not.toBe(
      timelineItemKey('job_created', 'source-1')
    );
  });

  test('orders by occurrence time and then stable key deterministically', () => {
    const page = buildTimelinePage(
      [
        timelineItem('job:b', '2026-08-10T08:00:00.000Z'),
        timelineItem('job:a', '2026-08-10T08:00:00.000Z'),
        timelineItem('job:c', '2026-08-11T08:00:00.000Z'),
      ],
      null,
      10
    );
    expect(page.items.map((item) => item.stableKey)).toEqual([
      'job:c',
      'job:b',
      'job:a',
    ]);
  });

  test('deduplicates source identities and keeps the newest projection', () => {
    const page = buildTimelinePage(
      [
        timelineItem('job:a', '2026-08-09T08:00:00.000Z'),
        timelineItem('job:a', '2026-08-10T08:00:00.000Z'),
      ],
      null,
      10
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.occurredAt).toBe('2026-08-10T08:00:00.000Z');
  });

  test('cursor pagination does not repeat equal-timestamp items', () => {
    const sourceIds = [
      '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001',
    ];
    const candidates = [
      timelineItem(`job_created:${sourceIds[0]}`, '2026-08-10T08:00:00.000Z'),
      timelineItem(`job_created:${sourceIds[1]}`, '2026-08-10T08:00:00.000Z'),
      timelineItem(`job_created:${sourceIds[2]}`, '2026-08-10T08:00:00.000Z'),
      timelineItem(`job_created:${sourceIds[3]}`, '2026-08-10T08:00:00.000Z'),
    ];
    const first = buildTimelinePage(candidates, null, 2);
    expect(first.items.map((item) => item.stableKey)).toEqual([
      `job_created:${sourceIds[0]}`,
      `job_created:${sourceIds[1]}`,
    ]);
    expect(decodeTimelineCursor(first.nextCursor)?.stableKey).toBe(
      `job_created:${sourceIds[1]}`
    );

    const second = buildTimelinePage(candidates, first.nextCursor, 2);
    expect(second.items.map((item) => item.stableKey)).toEqual([
      `job_created:${sourceIds[2]}`,
      `job_created:${sourceIds[3]}`,
    ]);
    expect(second.nextCursor).toBeNull();
  });

  test('emits no cursor when the page consumes every candidate', () => {
    const page = buildTimelinePage(
      [
        timelineItem('job:b', '2026-08-10T08:00:00.000Z'),
        timelineItem('job:a', '2026-08-10T08:00:00.000Z'),
      ],
      null,
      2
    );
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  test('rejects malformed and unsupported cursors', () => {
    expect(decodeTimelineCursor('not-a-cursor')).toBeNull();
    const unsupported = Buffer.from(
      JSON.stringify({ version: 2, occurredAt: '2026-08-10T08:00:00Z', stableKey: 'a' })
    ).toString('base64url');
    expect(decodeTimelineCursor(unsupported)).toBeNull();
  });

  test('rejects cursor values that could alter a PostgREST filter', () => {
    const injected = Buffer.from(
      JSON.stringify({
        version: 1,
        occurredAt: '2026-08-10T08:00:00Z',
        stableKey:
          'job_created:00000000-0000-4000-8000-000000000001,or(created_at.gt.2000-01-01T00:00:00Z)',
      })
    ).toString('base64url');

    expect(decodeTimelineCursor(injected)).toBeNull();
  });
});

describe('follow-up overdue boundary', () => {
  const now = new Date('2026-08-10T10:00:00.000Z');

  test('only an open follow-up strictly before now is overdue', () => {
    expect(isFollowUpOverdue('2026-08-10T09:59:59.999Z', 'open', now)).toBe(true);
    expect(isFollowUpOverdue('2026-08-10T10:00:00.000Z', 'open', now)).toBe(false);
    expect(isFollowUpOverdue('2026-08-10T09:00:00.000Z', 'completed', now)).toBe(false);
    expect(isFollowUpOverdue('2026-08-10T09:00:00.000Z', 'cancelled', now)).toBe(false);
  });
});

describe('communication guidance', () => {
  test('leaves missing configuration visibly unknown without inventing permission', () => {
    expect(
      resolveCommunicationGuidance({
        contactId: 'contact-1',
        channel: 'phone',
        purpose: 'appointment_service',
        settings: null,
        preferences: [],
      })
    ).toEqual({ state: 'unknown', source: 'unconfigured', warnings: [] });
  });

  test('contact-specific state overrides the customer default', () => {
    const result = resolveCommunicationGuidance({
      contactId: 'contact-1',
      channel: 'email',
      purpose: 'marketing',
      settings: SETTINGS,
      preferences: [
        preference({ channel: 'email', purpose: 'marketing', state: 'allowed' }),
        preference({
          id: 'preference-2',
          contactId: 'contact-1',
          channel: 'email',
          purpose: 'marketing',
          state: 'disallowed',
        }),
      ],
    });
    expect(result.state).toBe('disallowed');
    expect(result.source).toBe('contact');
    expect(result.warnings).toContain('disallowed_channel');
  });

  test('classifies a customer-level rule as the customer source', () => {
    const result = resolveCommunicationGuidance({
      contactId: null,
      channel: 'phone',
      purpose: 'appointment_service',
      settings: SETTINGS,
      preferences: [preference({ state: 'allowed' })],
    });
    expect(result).toMatchObject({ state: 'allowed', source: 'customer' });
  });

  test('warns for the wrong person and do-not-contact instruction without hard-blocking', () => {
    const result = resolveCommunicationGuidance({
      contactId: 'contact-2',
      channel: 'phone',
      purpose: 'appointment_service',
      settings: {
        ...SETTINGS,
        preferredContactId: 'contact-1',
        doNotContactInstruction: 'Nur nach Rücksprache anrufen.',
      },
      preferences: [],
    });
    expect(result.state).toBe('unknown');
    expect(result.warnings).toEqual(['do_not_contact', 'wrong_contact']);
  });

  test('keeps purposes separate', () => {
    const result = resolveCommunicationGuidance({
      contactId: null,
      channel: 'email',
      purpose: 'commercial_required',
      settings: SETTINGS,
      preferences: [
        preference({
          channel: 'email',
          purpose: 'marketing',
          state: 'disallowed',
        }),
      ],
    });
    expect(result).toEqual({ state: 'unknown', source: 'unconfigured', warnings: [] });
  });
});
