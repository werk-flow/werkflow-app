// The work one person's vacation requests cause stays bounded. The approver
// queue counts each pending request's days once, however many pending rows of
// the same person show a balance: twenty pending weeks of one employee resolve
// the daily target once per requested date. A new request lies between
// January 1 of last year and December 31 of next year.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';

const recordId = '8e000000-0000-4000-8000-000000000001';
const employeeId = '8e000000-0000-4000-8000-000000000002';
const weekCount = 20;
const isoDate = (time: number): string => new Date(time).toISOString().slice(0, 10);
// Twenty Monday-to-Friday weeks from Monday, January 5, 2026, each its own pending request.
const pendingWeeks = Array.from({ length: weekCount }, (_, index) => {
  const monday = Date.UTC(2026, 0, 5 + index * 7);
  return {
    id: `8e000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
    organization_id: ORGANIZATION_A,
    employee_record_id: recordId,
    start_date: isoDate(monday),
    end_date: isoDate(monday + 4 * 86_400_000),
    day_portion: 'full',
    status: 'pending',
  };
});

const world = installActionWorld({
  employee_records: [
    {
      id: recordId,
      organization_id: ORGANIZATION_A,
      user_id: employeeId,
      first_name: 'Kai',
      last_name: 'Kollege',
    },
  ],
  organization_members: [{ organization_id: ORGANIZATION_A, user_id: employeeId, role: 'employee' }],
  vacation_requests: pendingWeeks,
});
const cached = await import('@/lib/data/cached');
const targets = await import('@/lib/personnel/targets');
mock.module('@/lib/data/cached', () => ({
  ...cached,
  getCachedOrganizationCalendar: async () => targets.EMPTY_HOLIDAY_CALENDAR,
}));
const resolveDailyTarget = targets.resolveDailyTarget;
let resolvedDates = 0;
mock.module('@/lib/personnel/targets', () => ({
  ...targets,
  resolveDailyTarget: (input: Parameters<typeof resolveDailyTarget>[0]) => {
    resolvedDates += 1;
    return resolveDailyTarget(input);
  },
}));
// Approval authority has its own tests; here the Admin may decide every request.
const responsibilities = await import('@/lib/responsibilities/server');
mock.module('@/lib/responsibilities/server', () => ({
  ...responsibilities,
  authorizeResponsibilityForTarget: async () => ({ success: true }),
}));
const { getPendingVacationRequestsForApprover, previewVacationRequest, createVacationRequest } = await import(
  '@/lib/vacation/actions'
);
const { getBusinessTodayIso } = await import('@/lib/date-time/berlin');

signInAs(world, 'admin');
const queue = await getPendingVacationRequestsForApprover();
assert.ok(queue.success, JSON.stringify(queue));
assert.equal(queue.requests.length, weekCount);
for (const entry of queue.requests) {
  assert.equal(entry.totalDays, 5);
  assert.equal(entry.balance?.pendingDays, weekCount * 5);
}
// Five dates per request, each resolved once: the queue never recounts a request per row.
assert.equal(resolvedDates, weekCount * 5);

// A request outside the window is refused before anything is read or written.
const businessYear = Number(getBusinessTodayIso().slice(0, 4));
const outsideWindow = { success: false, error: 'outside_request_window' };
signInAs(world, 'employee');
for (const range of [
  { startDate: `${businessYear - 2}-12-31`, endDate: `${businessYear - 1}-01-02` },
  { startDate: `${businessYear + 1}-12-30`, endDate: `${businessYear + 2}-01-01` },
  { startDate: `${businessYear + 40}-06-01`, endDate: `${businessYear + 40}-06-05` },
]) {
  assert.deepEqual(await previewVacationRequest({ ...range, dayPortion: 'full' }), outsideWindow);
  assert.deepEqual(await createVacationRequest({ ...range, dayPortion: 'full' }), outsideWindow);
}
assert.equal(world.rpcCalls.length, 0);
// The window's first and last days are inside it.
const edges = {
  startDate: `${businessYear - 1}-01-01`,
  endDate: `${businessYear - 1}-01-01`,
  dayPortion: 'full' as const,
};
assert.notDeepEqual(await previewVacationRequest(edges), outsideWindow);
assert.notDeepEqual(
  await previewVacationRequest({
    ...edges,
    startDate: `${businessYear + 1}-12-31`,
    endDate: `${businessYear + 1}-12-31`,
  }),
  outsideWindow,
);
