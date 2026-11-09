// The actual submitTimeCorrection and planned-visit reader over the in-memory
// database (werk-flow/werkflow-planning#153). A forgotten day's timeline goes
// in as one request: its break, travel details and job reach the proposal,
// and an overnight timeline still splits at Berlin midnight (#57). A job of
// another organization, a forged activity and added travel without its
// details are refused before any request is written. The planned visits of a
// day answer the caller's own record and, for Admin and Büro, anyone's;
// another person's record refuses an employee, and a record of another
// organization is not found. Only legacy entries are recorded here.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const ownRecordId = '87000000-0000-4000-8000-000000000001';
const colleagueRecordId = '87000000-0000-4000-8000-000000000002';
const foreignRecordId = '87000000-0000-4000-8000-000000000003';
const colleagueId = '87000000-0000-4000-8000-000000000004';
const jobId = '87000000-0000-4000-8000-000000000005';
const foreignJobId = '87000000-0000-4000-8000-000000000006';
const visitId = '87000000-0000-4000-8000-000000000007';
const otherDayVisitId = '87000000-0000-4000-8000-000000000008';
const colleagueVisitId = '87000000-0000-4000-8000-000000000009';
const operationIds = Array.from(
  { length: 8 },
  (_, index) => `87000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
);

const world = installActionWorld({
  employee_records: [
    { id: ownRecordId, organization_id: ORGANIZATION_A, user_id: CALLER_ID },
    { id: colleagueRecordId, organization_id: ORGANIZATION_A, user_id: colleagueId },
    { id: foreignRecordId, organization_id: ORGANIZATION_B, user_id: CALLER_ID },
  ],
  organization_members: [
    { organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'employee' },
    { organization_id: ORGANIZATION_A, user_id: colleagueId, role: 'employee' },
  ],
  jobs: [
    { id: jobId, organization_id: ORGANIZATION_A },
    { id: foreignJobId, organization_id: ORGANIZATION_B },
  ],
  time_entries: [],
  // Each visit carries its people, as the read's `!inner` join hands them out.
  planning_occurrences: [
    {
      id: visitId,
      organization_id: ORGANIZATION_A,
      entry_kind: 'job_visit',
      status: 'scheduled',
      job_id: jobId,
      time_kind: 'timed',
      start_at: '2026-10-26T06:00:00.000Z',
      end_at: '2026-10-26T14:30:00.000Z',
      start_date: null,
      end_date_exclusive: null,
      assignee: [{ employee_record_id: ownRecordId }],
    },
    // The colleague's visit on the same day: never part of the caller's timeline.
    {
      id: colleagueVisitId,
      organization_id: ORGANIZATION_A,
      entry_kind: 'job_visit',
      status: 'scheduled',
      job_id: jobId,
      time_kind: 'timed',
      start_at: '2026-10-26T07:00:00.000Z',
      end_at: '2026-10-26T09:00:00.000Z',
      start_date: null,
      end_date_exclusive: null,
      assignee: [{ employee_record_id: colleagueRecordId }],
    },
    {
      id: otherDayVisitId,
      organization_id: ORGANIZATION_A,
      entry_kind: 'job_visit',
      status: 'scheduled',
      job_id: jobId,
      time_kind: 'timed',
      start_at: '2026-10-27T06:00:00.000Z',
      end_at: '2026-10-27T14:30:00.000Z',
      start_date: null,
      end_date_exclusive: null,
      assignee: [{ employee_record_id: ownRecordId }],
    },
  ],
});
mock.module('@/lib/time-tracking/canonical-entries', () => ({
  getCanonicalTimeEntries: async () => ({ success: true, entries: [] }),
}));
mock.module('@/lib/time-corrections/approved-projection', () => ({
  loadApprovedCorrectionProjection: async () => [],
}));
world.rpc = ({ name }) => {
  assert.equal(name, 'create_time_correction_request');
  return { data: { requestId: 'request', status: 'submitted', replayed: false }, error: null };
};
const { submitTimeCorrection } = await import('@/lib/time-corrections/actions');
const { getPlannedCorrectionVisits } = await import('@/lib/time-corrections/planned-visit-reads');
const { buildTimelineFacts, newTimelineRow, resolveCorrectionTimeline } = await import(
  '@/lib/time-corrections/timeline'
);
type Row = Parameters<typeof newTimelineRow>[1];

function timelineFacts(dateIso: string, rows: Row[]) {
  const resolved = resolveCorrectionTimeline(
    dateIso,
    rows.map((row, index) => newTimelineRow(`row-${index}`, row)),
  );
  assert.ok(resolved.valid, 'the fixture timeline is valid');
  return buildTimelineFacts(resolved.segments, ownRecordId);
}

const request = (operationId: string | undefined) => ({
  organizationId: ORGANIZATION_A,
  subjectEmployeeRecordId: ownRecordId,
  kind: 'add' as const,
  reason: 'Ganzen Tag vergessen zu stempeln',
  source: null,
  operationId: operationId ?? '',
});
const submit = (operationId: string | undefined, proposedFacts: ReturnType<typeof timelineFacts>) =>
  submitTimeCorrection({ ...request(operationId), proposedFacts });

function proposedFacts(callIndex: number) {
  const snapshot = world.rpcCalls[callIndex]?.args.p_proposed_snapshot;
  assert.ok(snapshot && typeof snapshot === 'object' && 'facts' in snapshot && Array.isArray(snapshot.facts));
  return snapshot.facts.map(
    (fact: { entryType: string; timestamp: string; jobId: string | null; activity?: { kind: string } }) => [
      fact.entryType,
      fact.timestamp,
      fact.activity?.kind,
      fact.jobId,
    ],
  );
}

signInAs(world, 'employee');

// A day with travel, work, a break and work again: one request carrying all of it.
const day = timelineFacts('2026-10-26', [
  {
    kind: 'travel',
    start: '06:30',
    end: '07:00',
    jobId,
    travelRoute: 'company_to_site',
    travelRole: 'driver',
  },
  { kind: 'work', start: '07:00', end: '12:00', jobId },
  { kind: 'break', start: '12:00', end: '12:30' },
  { kind: 'work', start: '12:30', end: '15:30', jobId },
]);
assert.deepEqual(await submit(operationIds[0], day), {
  success: true,
  requestId: 'request',
  status: 'submitted',
  replayed: false,
});
assert.deepEqual(proposedFacts(0), [
  ['clock_in', '2026-10-26T05:30:00.000Z', 'travel', jobId],
  ['clock_out', '2026-10-26T06:00:00.000Z', 'travel', jobId],
  ['clock_in', '2026-10-26T06:00:00.000Z', 'work', jobId],
  ['break_start', '2026-10-26T11:00:00.000Z', 'break', null],
  ['break_end', '2026-10-26T11:30:00.000Z', 'work', jobId],
  ['clock_out', '2026-10-26T14:30:00.000Z', 'work', jobId],
]);
const travelActivity = world.rpcCalls[0]?.args.p_proposed_snapshot;
assert.match(JSON.stringify(travelActivity), /"travelRoute":"company_to_site","travelRole":"driver"/);

// A night call-out with its break across midnight: the proposal still closes and reopens at 00:00.
const night = timelineFacts('2026-10-20', [
  { kind: 'callout', start: '22:00', end: '23:30', jobId },
  { kind: 'break', start: '23:30', end: '00:15', endsNextDay: true },
  { kind: 'callout', start: '00:15', end: '01:30', jobId },
]);
assert.equal((await submit(operationIds[1], night)).success, true);
assert.deepEqual(proposedFacts(1), [
  ['clock_in', '2026-10-20T20:00:00.000Z', 'callout', jobId],
  ['break_start', '2026-10-20T21:30:00.000Z', 'break', null],
  ['break_end', '2026-10-20T22:00:00.000Z', 'break', null],
  ['clock_out', '2026-10-20T22:00:00.000Z', 'break', null],
  ['clock_in', '2026-10-20T22:00:00.000Z', 'break', null],
  ['break_start', '2026-10-20T22:00:00.000Z', 'break', null],
  ['break_end', '2026-10-20T22:15:00.000Z', 'callout', jobId],
  ['clock_out', '2026-10-20T23:30:00.000Z', 'callout', jobId],
]);

// Refused before any request is written.
const written = world.rpcCalls.length;
const foreignJob = timelineFacts('2026-10-26', [
  { kind: 'work', start: '07:00', end: '15:30', jobId: foreignJobId },
]);
assert.deepEqual(await submit(operationIds[2], foreignJob), { success: false, error: 'source_not_found' });
const [travel] = timelineFacts('2026-10-26', [{ kind: 'travel', start: '06:30', end: '07:00', jobId }]);
assert.ok(travel);
const travelWithoutDetails = {
  factId: travel.factId,
  employeeRecordId: travel.employeeRecordId,
  entryType: travel.entryType,
  timestamp: travel.timestamp,
  jobId: travel.jobId,
  activityKind: travel.activityKind,
};
assert.deepEqual(
  await submitTimeCorrection({ ...request(operationIds[3]), proposedFacts: [travelWithoutDetails] }),
  {
    success: false,
    error: 'activity_context_required',
  },
);
assert.deepEqual(
  await submit(operationIds[4], [{ ...travel, activity: { kind: 'work', allocationKind: 'job', jobId } }]),
  { success: false, error: 'invalid_input' },
);
assert.equal(world.rpcCalls.length, written, 'a refused timeline writes nothing');

// The planned visits of a day.
assert.deepEqual(
  await getPlannedCorrectionVisits({ organizationId: ORGANIZATION_A, localDate: '2026-10-26' }),
  {
    success: true,
    visits: [{ jobId, startAt: '2026-10-26T06:00:00.000Z', endAt: '2026-10-26T14:30:00.000Z' }],
  },
);
assert.deepEqual(
  await getPlannedCorrectionVisits({
    organizationId: ORGANIZATION_A,
    localDate: '2026-10-26',
    employeeRecordId: colleagueRecordId,
  }),
  { success: false, error: 'not_authorized' },
);
assert.deepEqual(
  await getPlannedCorrectionVisits({
    organizationId: ORGANIZATION_A,
    localDate: '2026-10-26',
    employeeRecordId: foreignRecordId,
  }),
  { success: false, error: 'not_found' },
);
assert.deepEqual(
  await getPlannedCorrectionVisits({ organizationId: ORGANIZATION_B, localDate: '2026-10-26' }),
  { success: false, error: 'not_a_member' },
);
signInAs(world, 'buero');
assert.deepEqual(
  await getPlannedCorrectionVisits({
    organizationId: ORGANIZATION_A,
    localDate: '2026-10-26',
    employeeRecordId: colleagueRecordId,
  }),
  {
    success: true,
    // The office reads the colleague's day: their visit, never the caller's.
    visits: [{ jobId, startAt: '2026-10-26T07:00:00.000Z', endAt: '2026-10-26T09:00:00.000Z' }],
  },
);
