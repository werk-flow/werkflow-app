// The owner's delegation actions over the in-memory database. Creating a
// delegation for a substitute who is away on every day of the window answers
// a warning and writes nothing until the owner accepts it; only the owner's
// organization's absences count. Ending a window that has not started removes
// it from its first day; a running one ends today; one that is over writes
// nothing; another organization's window is not found.
import assert from 'node:assert/strict';
import { addLocalDays, getBusinessTodayIso } from '@/lib/date-time/berlin';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const delegatorId = '88000000-0000-4000-8000-000000000001';
const substituteId = '88000000-0000-4000-8000-000000000002';
const plannedId = '88000000-0000-4000-8000-000000000003';
const activeId = '88000000-0000-4000-8000-000000000004';
const endedId = '88000000-0000-4000-8000-000000000005';
const foreignId = '88000000-0000-4000-8000-000000000006';

const today = getBusinessTodayIso();
const day = (offset: number) => addLocalDays(today, offset);
const absence = (organizationId: string, startDate: string, endDate: string | null) => ({
  id: crypto.randomUUID(),
  organization_id: organizationId,
  employee_record_id: substituteId,
  start_date: startDate,
  end_date: endDate,
  day_portion: 'full',
});
const delegation = (id: string, organizationId: string, validFrom: string, validUntil: string) => ({
  id,
  organization_id: organizationId,
  valid_from: validFrom,
  valid_until: validUntil,
  revoked_from: null,
});

const world = installActionWorld({
  organizations: [
    { id: ORGANIZATION_A, admin_id: CALLER_ID },
    { id: ORGANIZATION_B, admin_id: CALLER_ID },
  ],
  vacation_requests: [],
  sickness_reports: [],
  organization_responsibility_delegations: [
    delegation(plannedId, ORGANIZATION_A, day(7), day(11)),
    delegation(activeId, ORGANIZATION_A, day(-2), day(3)),
    { ...delegation(endedId, ORGANIZATION_A, day(-5), day(3)), revoked_from: day(-1) },
    delegation(foreignId, ORGANIZATION_B, day(7), day(11)),
  ],
});
const { createResponsibilityDelegation, endResponsibilityDelegation } = await import(
  '@/lib/responsibilities/actions'
);
signInAs(world, 'admin');

const create = (acceptAbsentSubstitute: boolean, validFrom = day(7), validUntil = day(11)) =>
  createResponsibilityDelegation({
    responsibility: 'leave_approval',
    delegatorEmployeeRecordId: delegatorId,
    substituteEmployeeRecordId: substituteId,
    validFrom,
    validUntil,
    note: '',
    acceptAbsentSubstitute,
  });
const setAbsences = (table: 'vacation_requests' | 'sickness_reports', rows: Record<string, unknown>[]) => {
  world.tables.vacation_requests = [];
  world.tables.sickness_reports = [];
  world.tables[table] = rows;
};
const createCall = (accept: boolean) => ['createResponsibilityDelegation', () => create(accept)] as const;

async function assertCreated(accept: boolean, message: string): Promise<void> {
  world.rpcCalls.length = 0;
  assert.deepEqual(await create(accept), { success: true }, message);
  assert.equal(world.rpcCalls.length, 1, message);
  assert.equal(world.rpcCalls[0]?.name, 'create_responsibility_delegation', message);
  assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A, message);
}

// Approved vacation over the whole window warns and writes nothing.
setAbsences('vacation_requests', [{ ...absence(ORGANIZATION_A, day(6), day(12)), status: 'approved' }]);
await assertRefused(
  world,
  [createCall(false)],
  { success: false, error: 'responsibility_substitute_absent' },
  'reads',
);
// The owner accepts the warning: the delegation is saved.
await assertCreated(true, 'an accepted absent substitute is saved');

// Two spans that together cover every day warn; an open sickness report lasts until further notice.
setAbsences('vacation_requests', [
  { ...absence(ORGANIZATION_A, day(7), day(8)), status: 'approved' },
  { ...absence(ORGANIZATION_A, day(9), day(11)), status: 'approved' },
]);
await assertRefused(
  world,
  [createCall(false)],
  { success: false, error: 'responsibility_substitute_absent' },
  'reads',
);
setAbsences('sickness_reports', [{ ...absence(ORGANIZATION_A, day(1), null), status: 'reported' }]);
await assertRefused(
  world,
  [createCall(false)],
  { success: false, error: 'responsibility_substitute_absent' },
  'reads',
);

// No warning when one day is free, for a half day, a pending request, a
// cancelled report, or another organization's absence under the same record id.
setAbsences('vacation_requests', [{ ...absence(ORGANIZATION_A, day(7), day(10)), status: 'approved' }]);
await assertCreated(false, 'a substitute with one free day is saved without a warning');
setAbsences('vacation_requests', [
  { ...absence(ORGANIZATION_A, day(7), day(11)), status: 'approved', day_portion: 'half_day' },
]);
await assertCreated(false, 'a half-day absence does not warn');
setAbsences('vacation_requests', [{ ...absence(ORGANIZATION_A, day(7), day(11)), status: 'pending' }]);
await assertCreated(false, 'a pending vacation request does not warn');
setAbsences('sickness_reports', [{ ...absence(ORGANIZATION_A, day(7), day(11)), status: 'cancelled' }]);
await assertCreated(false, 'a cancelled sickness report does not warn');
setAbsences('vacation_requests', [{ ...absence(ORGANIZATION_B, day(7), day(11)), status: 'approved' }]);
await assertCreated(false, 'another organization’s absence does not warn');

// A failed absence read refuses: it must never pass as "not away".
world.failingTables.add('vacation_requests');
await assertRefused(
  world,
  [createCall(false)],
  { success: false, error: 'responsibility_absence_check_failed' },
  'reads',
);
world.failingTables.delete('vacation_requests');

// „Entfernen“: a window that has not started is revoked from its first day.
world.rpcCalls.length = 0;
assert.deepEqual(await endResponsibilityDelegation(plannedId), { success: true });
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_delegation_id, call.args.p_revoked_from]),
  [['end_responsibility_delegation', plannedId, day(7)]],
  'a planned window is removed from its first day',
);

// „Heute beenden“: a running window is revoked from today.
world.rpcCalls.length = 0;
assert.deepEqual(await endResponsibilityDelegation(activeId), { success: true });
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_delegation_id, call.args.p_revoked_from]),
  [['end_responsibility_delegation', activeId, today]],
  'a running window ends today',
);

// A window that is already over is not revoked again: its history keeps its end.
world.rpcCalls.length = 0;
assert.deepEqual(await endResponsibilityDelegation(endedId), { success: true });
assert.equal(world.rpcCalls.length, 0, 'an ended window is not revoked again');

// Another organization's planned window is not found, even for its own owner.
await assertRefused(
  world,
  [['endResponsibilityDelegation', () => endResponsibilityDelegation(foreignId)]],
  { success: false, error: 'responsibility_delegation_not_found' },
  'reads',
);
