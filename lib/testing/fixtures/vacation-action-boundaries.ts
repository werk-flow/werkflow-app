// Actual vacation actions over the in-memory database: a request of another
// organization is not found for a withdrawal, a decision or a cancellation,
// an employee withdraws no colleague's request and decides none, and the
// approver queues and the calendar read only the caller's organization (an
// employee's calendar only their own requests). A refused call writes nothing.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { databaseSnapshot } from './workforce-boundary-support';

const ownRecordId = '83000000-0000-4000-8000-000000000001';
const colleagueRecordId = '83000000-0000-4000-8000-000000000002';
const foreignRecordId = '83000000-0000-4000-8000-000000000003';
const colleagueId = '83000000-0000-4000-8000-000000000004';
const foreignUserId = '83000000-0000-4000-8000-000000000005';
const ownRequestId = '83000000-0000-4000-8000-000000000011';
const colleagueRequestId = '83000000-0000-4000-8000-000000000012';
const foreignPendingId = '83000000-0000-4000-8000-000000000013';
const foreignApprovedId = '83000000-0000-4000-8000-000000000014';

const vacationRequest = (
  id: string,
  organizationId: string,
  employeeRecordId: string,
  status: 'pending' | 'approved',
) => ({
  id,
  organization_id: organizationId,
  employee_record_id: employeeRecordId,
  start_date: '2026-11-16',
  end_date: '2026-11-20',
  day_portion: 'full',
  status,
});
const world = installActionWorld({
  employee_records: [
    {
      id: ownRecordId,
      organization_id: ORGANIZATION_A,
      user_id: CALLER_ID,
      first_name: 'Eva',
      last_name: 'Eigen',
    },
    {
      id: colleagueRecordId,
      organization_id: ORGANIZATION_A,
      user_id: colleagueId,
      first_name: 'Kai',
      last_name: 'Kollege',
    },
    {
      id: foreignRecordId,
      organization_id: ORGANIZATION_B,
      user_id: foreignUserId,
      first_name: 'Frida',
      last_name: 'Fremd',
    },
  ],
  organization_members: [
    { organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'employee' },
    { organization_id: ORGANIZATION_A, user_id: colleagueId, role: 'employee' },
    { organization_id: ORGANIZATION_B, user_id: foreignUserId, role: 'employee' },
  ],
  vacation_requests: [
    vacationRequest(ownRequestId, ORGANIZATION_A, ownRecordId, 'approved'),
    vacationRequest(colleagueRequestId, ORGANIZATION_A, colleagueRecordId, 'pending'),
    vacationRequest(foreignPendingId, ORGANIZATION_B, foreignRecordId, 'pending'),
    vacationRequest(foreignApprovedId, ORGANIZATION_B, foreignRecordId, 'approved'),
  ],
});
const {
  cancelApprovedVacationRequest,
  decideVacationRequest,
  getDecidableApprovedVacationRequests,
  getPendingVacationRequestsForApprover,
  withdrawVacationRequest,
} = await import('@/lib/vacation/actions');
const { getVacationCalendarEntries } = await import('@/lib/vacation/calendar-actions');

const initialDatabase = databaseSnapshot(world);
const requestNotFound = { success: false, error: 'request_not_found' };

// An employee withdraws no colleague's request, and decides none.
signInAs(world, 'employee');
assert.deepEqual(await withdrawVacationRequest({ requestId: colleagueRequestId }), {
  success: false,
  error: 'not_authorized',
});
assert.deepEqual(await decideVacationRequest({ requestId: colleagueRequestId, decision: 'approve' }), {
  success: false,
  error: 'not_responsible',
});

// An employee's calendar holds only their own requests.
const ownCalendar = await getVacationCalendarEntries();
assert.ok(ownCalendar.success);
assert.deepEqual(
  ownCalendar.entries.map((entry) => entry.id),
  [ownRequestId],
);

// A cookie naming another organization selects nothing there: the calendar stays the caller's own.
world.activeOrganizationCookie = ORGANIZATION_B;
const cookieCalendar = await getVacationCalendarEntries();
assert.ok(cookieCalendar.success);
assert.deepEqual(
  cookieCalendar.entries.map((entry) => entry.id),
  [ownRequestId],
);

// A caller without a membership reads no queue or calendar.
signInAs(world, null);
const noActiveOrganization = { success: false, error: 'no_active_org' };
assert.deepEqual(await getPendingVacationRequestsForApprover(), noActiveOrganization);
assert.deepEqual(await getDecidableApprovedVacationRequests(), noActiveOrganization);
assert.deepEqual(await getVacationCalendarEntries(), noActiveOrganization);

// An Admin of organization A reaches no request of organization B.
signInAs(world, 'admin');
assert.deepEqual(await withdrawVacationRequest({ requestId: foreignPendingId }), requestNotFound);
assert.deepEqual(
  await decideVacationRequest({ requestId: foreignPendingId, decision: 'approve' }),
  requestNotFound,
);
assert.deepEqual(
  await decideVacationRequest({ requestId: foreignPendingId, decision: 'reject', comment: 'Urlaubssperre' }),
  requestNotFound,
);
assert.deepEqual(
  await cancelApprovedVacationRequest({ requestId: foreignApprovedId, reason: 'Fremder Antrag' }),
  requestNotFound,
);
assert.equal(world.rpcCalls.length, 0);
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');

// The manager calendar and queues never list a request of organization B.
const managerCalendar = await getVacationCalendarEntries();
assert.ok(managerCalendar.success);
assert.deepEqual(
  managerCalendar.entries.map((entry) => entry.id).sort(),
  [colleagueRequestId, ownRequestId].sort(),
);
const pending = await getPendingVacationRequestsForApprover();
assert.ok(pending.success);
assert.ok(pending.requests.every((entry) => entry.request.id !== foreignPendingId));
const approved = await getDecidableApprovedVacationRequests();
assert.ok(approved.success);
assert.ok(approved.requests.every((entry) => entry.request.id !== foreignApprovedId));
assert.equal(world.rpcCalls.length, 0);
