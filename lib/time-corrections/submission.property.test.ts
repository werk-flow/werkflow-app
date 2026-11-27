import { describe, expect, mock, test } from 'bun:test';
import fc from 'fast-check';
import { createInMemoryAdmin } from '@/lib/testing/fixtures/in-memory-admin';
import { MINUTE_MS, correctionStartArbitrary } from '@/lib/testing/time-correction-arbitraries';
import { createActivitySelection } from '@/lib/time-tracking/segments';
import type { TimeActivitySelection, TimeSegmentKind } from '@/lib/time-tracking/types';
import type { SubmitTimeCorrectionInput } from './validation';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Added time as a timeline": added time is one proposal of the day's activities in order, and the
// server refuses added travel, standby or internal time without its details.

const ORGANIZATION = '88000000-0000-4000-8000-000000000001';
const RECORD = '88000000-0000-4000-8000-000000000002';
const USER = '88000000-0000-4000-8000-000000000003';
const OPERATION = '88000000-0000-4000-8000-000000000004';

// The proposal reads only the person's record and membership; jobless facts read no job.
const tables = {
  employee_records: [{ id: RECORD, organization_id: ORGANIZATION, user_id: USER }],
  organization_members: [{ organization_id: ORGANIZATION, user_id: USER, role: 'employee' }],
};
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => createInMemoryAdmin(tables) }));
const { proposeSubmission, submissionShapeError } = await import('./submission');

type ProposedFact = SubmitTimeCorrectionInput['proposedFacts'][number];

const submission = (
  kind: 'add' | 'missed_clock',
  proposedFacts: ProposedFact[],
): SubmitTimeCorrectionInput => ({
  organizationId: ORGANIZATION,
  subjectEmployeeRecordId: RECORD,
  kind,
  reason: 'Zeit vergessen',
  source: null,
  proposedFacts,
  operationId: OPERATION,
});

const addedKind = fc.constantFrom<'add' | 'missed_clock'>('add', 'missed_clock');

/**
 * Jobless work in pieces within 23 hours: clock-ins and clock-outs in time order. Neighbours may share
 * an instant, as a switch's clock-out and the next clock-in do.
 */
const orderedFactsArbitrary = fc
  .tuple(
    correctionStartArbitrary,
    fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 110 })), { minLength: 2, maxLength: 12 }),
  )
  .map(([start, gaps]) => {
    let offset = 0;
    return gaps.slice(0, gaps.length - (gaps.length % 2)).map((gap, index): ProposedFact => {
      offset += gap;
      return {
        factId: `fact-${index}`,
        employeeRecordId: RECORD,
        entryType: index % 2 === 0 ? 'clock_in' : 'clock_out',
        timestamp: new Date(start + offset * MINUTE_MS).toISOString(),
        jobId: null,
        activityKind: 'work',
        activity: createActivitySelection('work'),
      };
    });
  });

async function refusalOf(kind: 'add' | 'missed_clock', facts: ProposedFact[]): Promise<string> {
  const result = await proposeSubmission({
    submission: submission(kind, facts),
    subject: { id: RECORD, userId: USER, role: 'employee' },
    sourceInputs: [null],
    contexts: [],
  });
  return result.success ? 'accepted' : result.error;
}

describe('A proposal of added time', () => {
  test('with its facts in time order is accepted', async () => {
    await fc.assert(
      fc.asyncProperty(addedKind, orderedFactsArbitrary, async (kind, facts) => {
        expect(await refusalOf(kind, facts)).toBe('accepted');
      }),
    );
  });

  test('with a fact before the fact ahead of it is refused as out of order', async () => {
    await fc.assert(
      fc.asyncProperty(
        addedKind,
        orderedFactsArbitrary,
        fc.nat(),
        fc.integer({ min: 1, max: 60 }),
        async (kind, facts, draw, minutes) => {
          // One fact moves to before the fact ahead of it; the rest keep their times.
          const index = 1 + (draw % (facts.length - 1));
          const [ahead, moved] = [facts[index - 1], facts[index]];
          if (!ahead || !moved) throw new Error('A drawn proposal has two facts or more.');
          const timestamp = new Date(Date.parse(ahead.timestamp) - minutes * MINUTE_MS).toISOString();
          const reordered = facts.with(index, { ...moved, timestamp });
          expect(await refusalOf(kind, reordered)).toBe('invalid_time_order');
        },
      ),
    );
  });
});

const NEEDS_DETAILS: readonly TimeSegmentKind[] = ['travel', 'standby', 'internal_activity'];

/** An activity with every detail live capture asks for. */
const detailedActivityArbitrary: fc.Arbitrary<TimeActivitySelection> = fc.oneof(
  fc.constantFrom<TimeSegmentKind>('work', 'callout', 'break').map((kind) => createActivitySelection(kind)),
  fc
    .tuple(
      fc.constantFrom(
        'company_to_site',
        'home_to_site',
        'site_to_site',
        'site_to_company',
        'other',
        'unspecified',
      ),
      fc.constantFrom('driver', 'passenger', 'unspecified'),
    )
    .map(
      ([travelRoute, travelRole]): TimeActivitySelection => ({
        kind: 'travel',
        allocationKind: 'unallocated',
        jobId: null,
        travelRoute,
        travelRole,
      }),
    ),
  fc.constantFrom('on_site', 'remote', 'unspecified').map(
    (standbyContext): TimeActivitySelection => ({
      kind: 'standby',
      allocationKind: 'none',
      standbyContext,
    }),
  ),
  fc.constantFrom('internal_work', 'meeting', 'training', 'other').map(
    (internalType): TimeActivitySelection => ({
      kind: 'internal_activity',
      allocationKind: 'internal_activity',
      internalType,
    }),
  ),
);

/** A fact of added time, with or without its activity's details. */
const addedFactArbitrary = fc.tuple(detailedActivityArbitrary, fc.boolean(), fc.nat()).map(
  ([activity, detailed, minute]): ProposedFact => ({
    factId: `fact-${minute}`,
    employeeRecordId: RECORD,
    entryType: 'clock_in',
    timestamp: new Date(Date.UTC(2026, 9, 26) + (minute % 1440) * MINUTE_MS).toISOString(),
    jobId: null,
    activityKind: activity.kind,
    ...(detailed ? { activity } : {}),
  }),
);

describe('Added time', () => {
  test('of travel, standby or internal activity without its details is refused, and with them is not', () => {
    fc.assert(
      fc.property(addedKind, fc.array(addedFactArbitrary, { minLength: 1, maxLength: 8 }), (kind, facts) => {
        const missing = facts.some(
          (fact) => !fact.activity && NEEDS_DETAILS.some((needed) => needed === fact.activityKind),
        );
        expect(submissionShapeError(submission(kind, facts))).toBe(
          missing ? 'activity_context_required' : null,
        );
      }),
    );
  });
});
