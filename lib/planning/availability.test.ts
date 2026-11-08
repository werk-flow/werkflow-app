import { describe, expect, test } from 'bun:test';

import { accessEndDatesByRecord, availabilityNote, type AvailabilityRecord } from './availability';

function record(overrides: Partial<AvailabilityRecord>): AvailabilityRecord {
  return {
    id: 'record',
    entry_date: '2020-01-01',
    exit_date: null,
    personnel_access_lifecycles: [],
    ...overrides,
  };
}

const ENDED_ACCESS = {
  state: 'ended',
  state_effective_at: '2026-10-29T23:30:00.000Z',
  scheduled_state: null,
  scheduled_for: null,
} as const;

describe('access end dates', () => {
  test('an ended state ends access on its Berlin effective date; a scheduled end on its scheduled date', () => {
    const endDates = accessEndDatesByRecord([
      { id: 'ended', personnel_access_lifecycles: [ENDED_ACCESS] },
      {
        id: 'scheduled-end',
        personnel_access_lifecycles: [
          {
            state: 'active',
            state_effective_at: '2026-01-01T08:00:00.000Z',
            scheduled_state: 'ended',
            scheduled_for: '2026-11-15T08:00:00.000Z',
          },
        ],
      },
    ]);
    expect([...endDates]).toEqual([
      ['ended', '2026-10-30'],
      ['scheduled-end', '2026-11-15'],
    ]);
  });

  test('active or suspended access and a missing lifecycle never end access', () => {
    const endDates = accessEndDatesByRecord([
      {
        id: 'suspended',
        personnel_access_lifecycles: [
          {
            state: 'suspended',
            state_effective_at: '2026-01-01T08:00:00.000Z',
            scheduled_state: 'active',
            scheduled_for: '2026-11-15T08:00:00.000Z',
          },
        ],
      },
      { id: 'no-lifecycle', personnel_access_lifecycles: [] },
    ]);
    expect(endDates.size).toBe(0);
  });
});

describe('availability note of the assignment picker', () => {
  test('a person who left before the date is marked with the exit date', () => {
    expect(availabilityNote(record({ exit_date: '2026-10-29' }), '2026-11-04')).toBe(
      'Ausgetreten am 29.10.2026',
    );
  });

  test('the exit day itself is still a working day', () => {
    expect(availabilityNote(record({ exit_date: '2026-10-29' }), '2026-10-29')).toBeNull();
  });

  test('a future starter is marked with the entry date', () => {
    expect(availabilityNote(record({ entry_date: '2026-12-01' }), '2026-11-04')).toBe(
      'Eintritt am 01.12.2026',
    );
  });

  test('ended app access is marked from its Berlin end date on', () => {
    const ended = record({ personnel_access_lifecycles: [ENDED_ACCESS] });
    expect(availabilityNote(ended, '2026-10-30')).toBe('App-Zugang beendet am 30.10.2026');
    expect(availabilityNote(ended, '2026-10-29')).toBeNull();
  });

  test('an employed person with access is not marked', () => {
    expect(availabilityNote(record({}), '2026-11-04')).toBeNull();
  });
});
