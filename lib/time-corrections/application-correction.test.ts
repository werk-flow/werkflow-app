import { describe, expect, mock, test } from 'bun:test';
import { createInMemoryAdmin } from '@/lib/testing/fixtures/in-memory-admin';
import { proposeCalendarCorrection } from './calendar-proposal';
import type { TimeCorrectionFact, TimeCorrectionSnapshot } from './types';
import type { SubmitTimeCorrectionInput } from './validation';

// docs/features/time-tracking.md, "Corrections": a correction of time that
// came from an approved correction changes exactly the interval it names.
// Every sibling interval of that application stays as it was, or the server
// refuses the correction; it never changes or drops a sibling.

const ORGANIZATION = '89000000-0000-4000-8000-000000000001';
const RECORD = '89000000-0000-4000-8000-000000000002';
const USER = '89000000-0000-4000-8000-000000000003';
const OTHER_RECORD = '89000000-0000-4000-8000-000000000004';
const OTHER_USER = '89000000-0000-4000-8000-000000000005';
const JOB = '89000000-0000-4000-8000-000000000006';
const APPLICATION = '89000000-0000-4000-8000-000000000007';
const OPERATION = '89000000-0000-4000-8000-000000000008';

const tables = {
  employee_records: [
    { id: RECORD, organization_id: ORGANIZATION, user_id: USER },
    { id: OTHER_RECORD, organization_id: ORGANIZATION, user_id: OTHER_USER },
  ],
  organization_members: [
    { organization_id: ORGANIZATION, user_id: USER, role: 'employee' },
    { organization_id: ORGANIZATION, user_id: OTHER_USER, role: 'employee' },
  ],
  jobs: [{ id: JOB, organization_id: ORGANIZATION }],
};
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => createInMemoryAdmin(tables) }));
const { proposeSubmission } = await import('./submission');

type Kind = SubmitTimeCorrectionInput['kind'];
type ProposedFact = SubmitTimeCorrectionInput['proposedFacts'][number];

const at = (time: string) => `2026-10-14T${time}:00.000Z`;

const fact = (
  factId: string,
  entryType: TimeCorrectionFact['entryType'],
  time: string,
): TimeCorrectionFact => ({
  factId,
  employeeRecordId: RECORD,
  userId: USER,
  entryType,
  timestamp: at(time),
  jobId: null,
  activityKind: 'work',
  isManual: true,
});

/** Approved added time of two separate intervals: 08:00–10:00 and 13:00–15:00 (UTC). */
const twoIntervals: TimeCorrectionSnapshot = {
  schemaVersion: 1,
  facts: [
    fact('a0', 'clock_in', '08:00'),
    fact('a1', 'clock_out', '10:00'),
    fact('a2', 'clock_in', '13:00'),
    fact('a3', 'clock_out', '15:00'),
  ],
};

const proposed = (
  entryType: ProposedFact['entryType'],
  time: string,
  overrides: Partial<ProposedFact> = {},
) => ({
  factId: `changed-${entryType}-${time}`,
  employeeRecordId: RECORD,
  entryType,
  timestamp: at(time),
  jobId: null,
  activityKind: 'work' as const,
  ...overrides,
});

async function correct(input: {
  kind: Kind;
  factId: string;
  proposedFacts: ProposedFact[];
  snapshot?: TimeCorrectionSnapshot;
}) {
  const snapshot = input.snapshot ?? twoIntervals;
  const source = { kind: 'correction_application' as const, id: APPLICATION };
  const result = await proposeSubmission({
    submission: {
      organizationId: ORGANIZATION,
      subjectEmployeeRecordId: RECORD,
      kind: input.kind,
      reason: 'Zeit falsch',
      source: { ...source, factId: input.factId },
      proposedFacts: input.proposedFacts,
      operationId: OPERATION,
    },
    subject: { id: RECORD, userId: USER, role: 'employee' },
    sourceInputs: [source],
    contexts: [{ source: { ...source, version: 'fingerprint' }, snapshot }],
  });
  return result.success ? result : { error: result.error };
}

/** The facts as entry type, time and job, which is what recorded time counts. */
const recorded = (facts: readonly TimeCorrectionFact[]) =>
  facts.map((item) => [item.entryType, item.timestamp.slice(11, 16), item.jobId, item.employeeRecordId]);

const firstInterval = [
  ['clock_in', '08:00', null, RECORD],
  ['clock_out', '10:00', null, RECORD],
];

describe('A correction of one interval of an approved correction', () => {
  test('edits the start of that interval, not the first start of the application', async () => {
    const result = await correct({
      kind: 'edit',
      factId: 'a2',
      proposedFacts: [proposed('clock_in', '13:30')],
    });
    if (!('proposed' in result)) throw new Error(`refused: ${result.error}`);
    expect(recorded(result.proposed.facts)).toEqual([
      ...firstInterval,
      ['clock_in', '13:30', null, RECORD],
      ['clock_out', '15:00', null, RECORD],
    ]);
    expect(recorded(result.before.facts)).toEqual(recorded(twoIntervals.facts));
  });

  test('deletes that interval and keeps the other', async () => {
    const result = await correct({ kind: 'delete', factId: 'a2', proposedFacts: [] });
    if (!('proposed' in result)) throw new Error(`refused: ${result.error}`);
    expect(recorded(result.proposed.facts)).toEqual(firstInterval);
  });

  test('splits that interval and keeps the other', async () => {
    const result = await correct({
      kind: 'split',
      factId: 'a2',
      proposedFacts: [
        proposed('clock_in', '13:00'),
        proposed('clock_out', '14:00'),
        proposed('clock_in', '14:00'),
        proposed('clock_out', '15:00'),
      ],
    });
    if (!('proposed' in result)) throw new Error(`refused: ${result.error}`);
    expect(recorded(result.proposed.facts)).toEqual([
      ...firstInterval,
      ['clock_in', '13:00', null, RECORD],
      ['clock_out', '14:00', null, RECORD],
      ['clock_in', '14:00', null, RECORD],
      ['clock_out', '15:00', null, RECORD],
    ]);
    expect(new Set(result.proposed.facts.map((item) => item.factId)).size).toBe(6);
  });

  test('reallocates that interval and keeps the other on its job', async () => {
    const result = await correct({
      kind: 'reallocate',
      factId: 'a3',
      proposedFacts: [proposed('clock_in', '13:00', { jobId: JOB })],
    });
    if (!('proposed' in result)) throw new Error(`refused: ${result.error}`);
    expect(recorded(result.proposed.facts)).toEqual([
      ...firstInterval,
      ['clock_in', '13:00', JOB, RECORD],
      ['clock_out', '15:00', JOB, RECORD],
    ]);
  });

  test('is refused as a reassignment, which would move only part of the application', async () => {
    const result = await correct({
      kind: 'reassign',
      factId: 'a2',
      proposedFacts: [proposed('clock_in', '13:00', { employeeRecordId: OTHER_RECORD })],
    });
    expect(result).toEqual({ error: 'time_correction_multiple_intervals' });
  });

  test('of one activity inside a session with a break is refused for a deletion', async () => {
    const withBreak: TimeCorrectionSnapshot = {
      schemaVersion: 1,
      facts: [
        fact('b0', 'clock_in', '08:00'),
        fact('b1', 'break_start', '10:00'),
        fact('b2', 'break_end', '10:30'),
        fact('b3', 'clock_out', '12:00'),
      ],
    };
    const result = await correct({ kind: 'delete', factId: 'b2', proposedFacts: [], snapshot: withBreak });
    expect(result).toEqual({ error: 'time_correction_multiple_intervals' });
  });

  test('edits the second break of a session, not the first', async () => {
    const twoBreaks: TimeCorrectionSnapshot = {
      schemaVersion: 1,
      facts: [
        fact('c0', 'clock_in', '07:00'),
        fact('c1', 'break_start', '09:00'),
        fact('c2', 'break_end', '09:15'),
        fact('c3', 'break_start', '12:00'),
        fact('c4', 'break_end', '12:30'),
        fact('c5', 'clock_out', '15:00'),
      ],
    };
    const result = await correct({
      kind: 'edit',
      factId: 'c3',
      proposedFacts: [proposed('break_start', '12:10')],
      snapshot: twoBreaks,
    });
    if (!('proposed' in result)) throw new Error(`refused: ${result.error}`);
    expect(result.proposed.facts.map((item) => item.timestamp.slice(11, 16))).toEqual([
      '07:00',
      '09:00',
      '09:15',
      '12:10',
      '12:30',
      '15:00',
    ]);
  });

  test('without the fact it names is refused', async () => {
    expect(await correct({ kind: 'delete', factId: 'gone', proposedFacts: [] })).toEqual({
      error: 'source_not_found',
    });
  });
});

describe('A correction of an approved correction of one interval', () => {
  const oneInterval: TimeCorrectionSnapshot = {
    schemaVersion: 1,
    facts: [fact('d0', 'clock_in', '08:00'), fact('d1', 'clock_out', '10:00')],
  };

  test('deletes it whole', async () => {
    const result = await correct({ kind: 'delete', factId: 'd0', proposedFacts: [], snapshot: oneInterval });
    if (!('proposed' in result)) throw new Error(`refused: ${result.error}`);
    expect(result.proposed.facts).toEqual([]);
  });

  test('reassigns it whole', async () => {
    const result = await correct({
      kind: 'reassign',
      factId: 'd0',
      proposedFacts: [proposed('clock_in', '08:00', { employeeRecordId: OTHER_RECORD })],
      snapshot: oneInterval,
    });
    if (!('proposed' in result)) throw new Error(`refused: ${result.error}`);
    expect(recorded(result.proposed.facts)).toEqual([
      ['clock_in', '08:00', null, OTHER_RECORD],
      ['clock_out', '10:00', null, OTHER_RECORD],
    ]);
  });
});

describe("The calendar's correction of an approved correction", () => {
  const source = { kind: 'correction_application' as const, id: APPLICATION, version: 'fingerprint' };
  const boundary = (entryType: TimeCorrectionFact['entryType'], time: string, newTime = time) => ({
    source,
    entryType,
    originalTimestamp: at(time),
    timestamp: at(newTime),
    employeeRecordId: RECORD,
  });

  test('of one interval of several is refused, never a partial replacement', () => {
    expect(
      proposeCalendarCorrection({
        contexts: [{ source, snapshot: twoIntervals }],
        boundaries: [boundary('clock_in', '13:00', '13:30'), boundary('clock_out', '15:00')],
      }),
    ).toEqual({ success: false, error: 'calendar_incomplete_source' });
  });

  test('moves each boundary by its own original time, not the first of its type', () => {
    const result = proposeCalendarCorrection({
      contexts: [{ source, snapshot: twoIntervals }],
      boundaries: [
        boundary('clock_in', '08:00'),
        boundary('clock_out', '10:00'),
        boundary('clock_in', '13:00', '13:30'),
        boundary('clock_out', '15:00'),
      ],
    });
    if (!result.success) throw new Error(result.error);
    expect(recorded(result.snapshot.facts)).toEqual([
      ...firstInterval,
      ['clock_in', '13:30', null, RECORD],
      ['clock_out', '15:00', null, RECORD],
    ]);
  });
});
