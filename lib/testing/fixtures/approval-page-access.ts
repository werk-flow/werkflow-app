// Actual time and vacation approval actions and the real Zeiterfassung page
// over the in-memory database, with the real responsibility resolution at
// action time: the page opens the time and leave approval surfaces (the
// pending entries and the correction review, the vacation requests) only for
// their holders; a holder never sees or decides an own entry or request (four
// eyes); a member who holds no approval sees no queue entry and is refused the
// decision; a substitute approves inside the delegation and is refused once it
// ended; a holder who lost the responsibility is refused although an open card
// still shows the request; and a member of another organization reviews
// nothing. The vacation queue tells the approver that another absence
// overlaps, never which kind. Each refusal is checked against a holder who
// reaches the database function for the same entry or request.
import assert from 'node:assert/strict';
import { mock, setSystemTime } from 'bun:test';
import { EMPTY_HOLIDAY_CALENDAR } from '@/lib/personnel/targets';
import { getDefaultTimeTrackingSettings } from '@/lib/time-tracking/settings';
import { ORGANIZATION_A, ORGANIZATION_B, signInAs } from './action-boundary-world';
import { field, installPageWorld, renderTree } from './page-render';

const adminId = '6d000000-0000-4000-8000-000000000001';
const bueroId = '6d000000-0000-4000-8000-000000000002';
const employeeId = '6d000000-0000-4000-8000-000000000003';
const adminRecordId = '6d000000-0000-4000-8000-000000000011';
const bueroRecordId = '6d000000-0000-4000-8000-000000000012';
const employeeRecordId = '6d000000-0000-4000-8000-000000000013';
const configurationId = '6d000000-0000-4000-8000-000000000021';
const delegationId = '6d000000-0000-4000-8000-000000000031';
const bueroRequestId = '6d000000-0000-4000-8000-000000000041';
const employeeRequestId = '6d000000-0000-4000-8000-000000000042';
const today = '2026-10-14';
setSystemTime(new Date(`${today}T10:00:00.000Z`));

type Role = 'admin' | 'buero' | 'employee';
type Responsibility = 'time_approval' | 'leave_approval';
const people = [
  { userId: adminId, recordId: adminRecordId, role: 'admin' },
  { userId: bueroId, recordId: bueroRecordId, role: 'buero' },
  { userId: employeeId, recordId: employeeRecordId, role: 'employee' },
] as const;

/** One pending manual submission of yesterday: a clock-in and a clock-out. */
const submission = (userId: string, index: number) =>
  (['clock_in', 'clock_out'] as const).map((entryType, offset) => ({
    id: `6d000000-0000-4000-8000-0000000001${index}${offset}`,
    organization_id: ORGANIZATION_A,
    user_id: userId,
    entry_type: entryType,
    status: 'pending',
    timestamp: `2026-10-13T0${6 + offset}:00:00.000Z`,
    created_at: `2026-10-13T09:00:00.00${index}Z`,
    job_id: null,
    notes: null,
  }));
const [bueroIn, bueroOut] = submission(bueroId, 1);
const [employeeIn, employeeOut] = submission(employeeId, 2);
assert.ok(bueroIn && bueroOut && employeeIn && employeeOut);
const bueroEntries = [bueroIn.id, bueroOut.id];
const employeeEntries = [employeeIn.id, employeeOut.id];

const vacationRequest = (id: string, employeeRecordIdOfRequest: string) => ({
  id,
  organization_id: ORGANIZATION_A,
  employee_record_id: employeeRecordIdOfRequest,
  start_date: '2026-11-16',
  end_date: '2026-11-16',
  day_portion: 'full',
  status: 'pending',
  comment: null,
  created_at: '2026-10-13T09:00:00.000Z',
});

const world = await installPageWorld({
  organizations: [{ id: ORGANIZATION_A, admin_id: adminId }],
  organization_members: people.map(({ userId, role }, index) => ({
    id: `6d000000-0000-4000-8000-00000000005${index}`,
    organization_id: ORGANIZATION_A,
    user_id: userId,
    role,
  })),
  // The responsibility read embeds each record's access lifecycle and open access blockers.
  employee_records: people.map(({ userId, recordId }) => ({
    id: recordId,
    organization_id: ORGANIZATION_A,
    user_id: userId,
    first_name: 'Erika',
    last_name: 'Beispiel',
    exit_date: null,
    personnel_access_lifecycles: [],
    personnel_onboarding_requirements: [],
  })),
  profiles: people.map(({ userId }) => ({ id: userId, first_name: 'Erika', last_name: 'Beispiel' })),
  time_entries: [bueroIn, bueroOut, employeeIn, employeeOut],
  vacation_requests: [
    vacationRequest(bueroRequestId, bueroRecordId),
    vacationRequest(employeeRequestId, employeeRecordId),
  ],
  // The field worker is also reported sick on the requested day.
  sickness_reports: [
    {
      id: '6d000000-0000-4000-8000-000000000061',
      organization_id: ORGANIZATION_A,
      employee_record_id: employeeRecordId,
      absence_type: 'krankheit',
      start_date: '2026-11-16',
      end_date: '2026-11-16',
      day_portion: 'full',
      status: 'reported',
    },
  ],
});
// The vacation queue counts each request against the organization's holidays; it has none.
const cached = { ...(await import('@/lib/data/cached')) };
mock.module('@/lib/data/cached', () => ({
  ...cached,
  getCachedOrganizationCalendar: async () => EMPTY_HOLIDAY_CALENDAR,
  getCachedOrganizationSettings: async (organizationId: string) =>
    getDefaultTimeTrackingSettings(organizationId),
}));
const { default: ZeiterfassungPage } = await import('@/app/(app)/zeiterfassung/page');

/** Which approval surfaces the real Zeiterfassung page opens for the caller. */
async function approvalSurfaces(): Promise<{ time: unknown; leave: unknown }> {
  const tree = await renderTree(() =>
    ZeiterfassungPage({ searchParams: Promise.resolve({ tab: 'approvals' }) }),
  );
  const content = tree.find((element) => field(element, 'props', 'canApproveTime') !== undefined);
  assert.ok(content, 'the Zeiterfassung page rendered no content');
  return {
    time: field(content, 'props', 'canApproveTime'),
    leave: field(content, 'props', 'canApproveLeave'),
  };
}
// The decision function answers with the decided row; the database keeps it pending for the next case.
world.rpc = ({ name, args }) => ({
  data:
    name === 'decide_vacation_request'
      ? { ...world.tables.vacation_requests?.find((row) => row.id === args.p_request_id), status: 'rejected' }
      : null,
  error: null,
});
const { getPendingSessions, reviewEntries } = await import('@/lib/time-tracking/review-actions');
const { decideVacationRequest, getPendingVacationRequestsForApprover } = await import(
  '@/lib/vacation/actions'
);

function actAs(userId: string, role: Role, organizationId = ORGANIZATION_A): void {
  signInAs(world, role, organizationId);
  world.callerId = userId;
}

function selectHolders(responsibility: Responsibility, recordIds: readonly string[]): void {
  world.tables.organization_responsibility_configurations = [
    {
      id: configurationId,
      organization_id: ORGANIZATION_A,
      responsibility,
      mode: 'selected',
      effective_from: '2026-01-01T00:00:00.000Z',
      created_by: adminId,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ];
  world.tables.organization_responsibility_assignments = recordIds.map((recordId, index) => ({
    id: `6d000000-0000-4000-8000-00000000002${index + 2}`,
    organization_id: ORGANIZATION_A,
    configuration_id: configurationId,
    employee_record_id: recordId,
    source: 'direct',
    role_snapshot: null,
    created_at: '2026-01-01T00:00:00.000Z',
  }));
}

function roleDefaults(): void {
  world.tables.organization_responsibility_configurations = [];
  world.tables.organization_responsibility_assignments = [];
  world.tables.organization_responsibility_delegations = [];
}

/** Asserts the decision reached its database function once, or the refusal and no database call. */
async function expectDecision(
  decide: () => Promise<unknown>,
  functionName: string,
  expected: 'decided' | string,
): Promise<void> {
  world.rpcCalls.length = 0;
  const result = await decide();
  if (expected === 'decided') {
    assert.equal(field(result, 'success'), true, `the holder was refused: ${JSON.stringify(result)}`);
    assert.deepEqual(
      world.rpcCalls.map(({ name }) => name),
      [functionName],
    );
  } else {
    assert.deepEqual(result, { success: false, error: expected });
    assert.equal(world.rpcCalls.length, 0, `${expected}: a refused decision reached the database`);
  }
}

const review = (entryIds: string[], expected: string) =>
  expectDecision(() => reviewEntries(entryIds, 'approved'), 'review_time_entries', expected);
const decideVacation = (requestId: string, expected: string) =>
  expectDecision(
    () => decideVacationRequest({ requestId, decision: 'reject', comment: 'Betriebsurlaub' }),
    'decide_vacation_request',
    expected,
  );

/** The users whose sessions the caller's time approval queue lists. */
async function queuedTimeUsers(): Promise<string[]> {
  const result = await getPendingSessions();
  assert.ok(result.success, `the time queue failed: ${JSON.stringify(result)}`);
  return [...new Set(result.sessions.map((session) => session.userId))].sort();
}

/** The requests the caller's vacation queue lists. */
async function queuedVacationRequests() {
  const result = await getPendingVacationRequestsForApprover();
  assert.ok(result.success, `the vacation queue failed: ${JSON.stringify(result)}`);
  return result.requests;
}
const queuedRequestIds = async (): Promise<string[]> =>
  (await queuedVacationRequests()).map((entry) => entry.request.id).sort();

// Time approval by role default (A3-11): the field worker holds none; Büro
// never sees or approves its own entry, and the admin approves it.
actAs(employeeId, 'employee');
assert.deepEqual(await approvalSurfaces(), { time: false, leave: false });
assert.deepEqual(await queuedTimeUsers(), []);
await review(bueroEntries, 'not_responsible');
actAs(bueroId, 'buero');
assert.deepEqual(await approvalSurfaces(), { time: true, leave: true });
assert.deepEqual(await queuedTimeUsers(), [employeeId]);
await review(bueroEntries, 'self_approval_not_allowed');
actAs(adminId, 'admin');
assert.deepEqual(await queuedTimeUsers(), [bueroId, employeeId]);
await review(bueroEntries, 'decided');

// Selected time approvers Admin and field worker (P1-05): the field worker
// approves Büro's entry but never their own; Büro, no longer a holder, sees
// nothing and is refused; the admin approves the field worker's entry.
selectHolders('time_approval', [adminRecordId, employeeRecordId]);
actAs(employeeId, 'employee');
assert.deepEqual(await approvalSurfaces(), { time: true, leave: false });
assert.deepEqual(await queuedTimeUsers(), [bueroId]);
await review(employeeEntries, 'self_approval_not_allowed');
await review(bueroEntries, 'decided');
actAs(bueroId, 'buero');
assert.deepEqual(await approvalSurfaces(), { time: false, leave: true });
assert.deepEqual(await queuedTimeUsers(), []);
await review(employeeEntries, 'not_responsible');
actAs(adminId, 'admin');
await review(employeeEntries, 'decided');

// A substitution (P1-05): the field worker substitutes the admin inside the
// window, and is refused at action time once it ended.
selectHolders('time_approval', [adminRecordId, bueroRecordId]);
const delegation = {
  id: delegationId,
  organization_id: ORGANIZATION_A,
  responsibility: 'time_approval',
  delegator_employee_record_id: adminRecordId,
  substitute_employee_record_id: employeeRecordId,
  valid_from: today,
  valid_until: '2026-10-15',
  revoked_from: null,
};
world.tables.organization_responsibility_delegations = [delegation];
actAs(employeeId, 'employee');
assert.deepEqual(await queuedTimeUsers(), [bueroId]);
await review(bueroEntries, 'decided');
world.tables.organization_responsibility_delegations = [{ ...delegation, revoked_from: today }];
await review(bueroEntries, 'not_responsible');
assert.deepEqual(await queuedTimeUsers(), []);
world.tables.organization_responsibility_delegations = [
  { ...delegation, valid_from: '2026-10-01', valid_until: '2026-10-13' },
];
await review(bueroEntries, 'not_responsible');

// Leave approval by role default (P1-06): Büro's own request never reaches
// Büro's queue and Büro cannot decide it; the admin decides it.
roleDefaults();
actAs(bueroId, 'buero');
assert.deepEqual(await queuedRequestIds(), [employeeRequestId]);
await decideVacation(bueroRequestId, 'self_approval_not_allowed');
actAs(employeeId, 'employee');
assert.deepEqual(await queuedRequestIds(), []);
await decideVacation(bueroRequestId, 'not_responsible');
actAs(adminId, 'admin');
await decideVacation(bueroRequestId, 'decided');

// The approver learns that another absence overlaps the request, never its kind (A4-R02).
const employeeEntry = (await queuedVacationRequests()).find(
  (entry) => entry.request.id === employeeRequestId,
);
assert.ok(employeeEntry, 'the admin does not see the field worker’s request');
assert.equal(employeeEntry.hasAbsenceOverlap, true);
assert.doesNotMatch(JSON.stringify(employeeEntry), /krankheit|sickness|absence_type/i);

// The owner narrows leave approval to the admin while Büro's card still shows
// the field worker's request: the decision is refused at action time (P1-06).
actAs(bueroId, 'buero');
assert.deepEqual(await queuedRequestIds(), [employeeRequestId]);
await decideVacation(employeeRequestId, 'decided');
selectHolders('leave_approval', [adminRecordId]);
await decideVacation(employeeRequestId, 'not_responsible');
assert.deepEqual(await queuedRequestIds(), []);
actAs(adminId, 'admin');
await decideVacation(employeeRequestId, 'decided');

// An admin of another organization decides nothing of this one.
actAs(adminId, 'admin', ORGANIZATION_B);
await review(employeeEntries, 'not_a_member');
await decideVacation(employeeRequestId, 'request_not_found');
