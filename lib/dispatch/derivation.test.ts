import { describe, expect, test } from 'bun:test';

import {
  deriveRecipientState,
  deriveTravelNotes,
  isAcknowledgementPending,
  latestAcknowledgementByRecipient,
  type AcknowledgementFact,
  type TravelVisitFact,
} from './derivation';

function fact(overrides: Partial<AcknowledgementFact>): AcknowledgementFact {
  return {
    id: 'ack-1',
    employeeRecordId: 'record-1',
    state: 'acknowledged',
    reason: null,
    challengeResolvedAt: null,
    createdAt: '2026-09-01T08:00:00Z',
    ...overrides,
  };
}

describe('dispatch acknowledgement derivation', () => {
  test('latest row per recipient wins, ties broken by id', () => {
    const latest = latestAcknowledgementByRecipient([
      fact({ id: 'a', state: 'challenged', reason: 'Termin passt nicht.', createdAt: '2026-09-01T08:00:00Z' }),
      fact({ id: 'b', state: 'acknowledged', createdAt: '2026-09-01T09:00:00Z' }),
      fact({ id: 'c', employeeRecordId: 'record-2', state: 'carried_forward' }),
    ]);
    expect(latest.get('record-1')?.id).toBe('b');
    expect(latest.get('record-2')?.state).toBe('carried_forward');

    const tied = latestAcknowledgementByRecipient([
      fact({ id: 'a' }),
      fact({ id: 'b', state: 'challenged', reason: 'Grund mit acht Zeichen.' }),
    ]);
    expect(tied.get('record-1')?.id).toBe('b');

    // Mixed fractional-second precision must compare as instants, not text:
    // "…08:00:00Z" and "…08:00:00.000Z" are the same moment (id breaks the
    // tie), and "…08:00:00.100Z" is later despite sorting earlier as a string
    // than "…08:00:01Z" would.
    const mixed = latestAcknowledgementByRecipient([
      fact({ id: 'a', createdAt: '2026-09-01T08:00:00.100Z' }),
      fact({ id: 'b', state: 'challenged', reason: 'Grund mit acht Zeichen.', createdAt: '2026-09-01T08:00:00Z' }),
    ]);
    expect(mixed.get('record-1')?.id).toBe('a');
    const sameInstant = latestAcknowledgementByRecipient([
      fact({ id: 'a', createdAt: '2026-09-01T08:00:00.000Z' }),
      fact({ id: 'b', state: 'challenged', reason: 'Grund mit acht Zeichen.', createdAt: '2026-09-01T08:00:00Z' }),
    ]);
    expect(sameInstant.get('record-1')?.id).toBe('b');
  });

  test('a record without an active login is a labeled fact, never pending or approved', () => {
    expect(deriveRecipientState({ hasLogin: false, latest: null })).toBe(
      'nicht_moeglich'
    );
    expect(
      deriveRecipientState({ hasLogin: false, latest: fact({}) })
    ).toBe('nicht_moeglich');
    expect(isAcknowledgementPending('nicht_moeglich')).toBe(false);
  });

  test('state matrix: none → ausstehend, acknowledged → bestätigt, carried → übernommen', () => {
    expect(deriveRecipientState({ hasLogin: true, latest: null })).toBe(
      'ausstehend'
    );
    expect(
      deriveRecipientState({ hasLogin: true, latest: fact({}) })
    ).toBe('bestaetigt');
    expect(
      deriveRecipientState({
        hasLogin: true,
        latest: fact({ state: 'carried_forward' }),
      })
    ).toBe('uebernommen');
  });

  test('an open challenge blocks; a kept-resolved challenge returns the recipient to pending', () => {
    expect(
      deriveRecipientState({
        hasLogin: true,
        latest: fact({ state: 'challenged', reason: 'Begründung lang genug.' }),
      })
    ).toBe('rueckfrage');
    expect(
      deriveRecipientState({
        hasLogin: true,
        latest: fact({
          state: 'challenged',
          reason: 'Begründung lang genug.',
          challengeResolvedAt: '2026-09-01T10:00:00Z',
        }),
      })
    ).toBe('ausstehend');
    expect(isAcknowledgementPending('ausstehend')).toBe(true);
    expect(isAcknowledgementPending('rueckfrage')).toBe(false);
  });
});

function visit(overrides: Partial<TravelVisitFact>): TravelVisitFact {
  return {
    occurrenceId: 'occurrence-1',
    title: 'Besuch A',
    employeeRecordId: 'record-1',
    employeeName: 'Emil',
    localDate: '2026-09-07',
    startMinutes: 8 * 60,
    endMinutes: 10 * 60,
    siteId: 'site-1',
    ...overrides,
  };
}

describe('travel-gap facts', () => {
  test('same known site raises nothing; different sites with zero gap warn', () => {
    expect(
      deriveTravelNotes([
        visit({}),
        visit({ occurrenceId: 'occurrence-2', title: 'Besuch B', startMinutes: 10 * 60, endMinutes: 12 * 60 }),
      ])
    ).toEqual([]);

    const notes = deriveTravelNotes([
      visit({}),
      visit({
        occurrenceId: 'occurrence-2',
        title: 'Besuch B',
        siteId: 'site-2',
        startMinutes: 10 * 60,
        endMinutes: 12 * 60,
      }),
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe('no_gap_different_sites');
    expect(notes[0].previousTitle).toBe('Besuch A');
    expect(notes[0].nextTitle).toBe('Besuch B');
  });

  test('unknown sites never pass silently: positive gaps stay "nicht bewertet"', () => {
    const notes = deriveTravelNotes([
      visit({ siteId: null }),
      visit({
        occurrenceId: 'occurrence-2',
        title: 'Besuch B',
        siteId: null,
        startMinutes: 11 * 60,
        endMinutes: 12 * 60,
      }),
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe('gap_unassessed');
    expect(notes[0].gapMinutes).toBe(60);
  });

  test('overlapping different-site visits count as negative gap warnings', () => {
    const notes = deriveTravelNotes([
      visit({}),
      visit({
        occurrenceId: 'occurrence-2',
        siteId: 'site-2',
        startMinutes: 9 * 60,
        endMinutes: 11 * 60,
      }),
    ]);
    expect(notes[0].kind).toBe('no_gap_different_sites');
    expect(notes[0].gapMinutes).toBe(-60);
  });

  test('days and employees are assessed independently', () => {
    const notes = deriveTravelNotes([
      visit({}),
      visit({
        occurrenceId: 'occurrence-2',
        siteId: 'site-2',
        localDate: '2026-09-08',
        startMinutes: 10 * 60,
      }),
      visit({
        occurrenceId: 'occurrence-3',
        employeeRecordId: 'record-2',
        employeeName: 'Bruno',
        siteId: 'site-2',
        startMinutes: 10 * 60,
      }),
    ]);
    expect(notes).toEqual([]);
  });
});
