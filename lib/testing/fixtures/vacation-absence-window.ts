// The actual vacation queue over the in-memory database: the conflict read
// takes only the reports that reach into the pending requests' span, and that
// bound never changes a conflict. Every case runs alone, so its own requests
// set the span's edges. A report inside the span that overlaps no request
// stays unflagged, a cancelled or foreign report never counts, a report wholly
// outside the span is not read at all, a failed read never says "no conflict",
// and without a pending request nothing is read.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';

const recordId = '8f000000-0000-4000-8000-000000000001';
const employeeId = '8f000000-0000-4000-8000-000000000002';

type Range = readonly [start: string, end: string];
type Report = {
  range: readonly [start: string, end: string | null];
  status?: 'reported' | 'cancelled';
  organizationId?: string;
};

const week: Range = ['2026-11-16', '2026-11-20'];
const oneDay: Range = ['2026-11-16', '2026-11-16'];
const spring: Range = ['2026-03-02', '2026-03-06'];

/** Each case: the pending requests, the reports, and whether each request shows a conflict. */
const cases: ReadonlyArray<{
  name: string;
  requests: readonly Range[];
  reports: readonly Report[];
  conflicts: readonly boolean[];
}> = [
  {
    name: 'a report inside the request',
    requests: [week],
    reports: [{ range: ['2026-11-17', '2026-11-18'] }],
    conflicts: [true],
  },
  {
    name: 'a report that starts before the request and ends inside it',
    requests: [week],
    reports: [{ range: ['2026-11-02', '2026-11-17'] }],
    conflicts: [true],
  },
  {
    name: 'a report that starts inside the request and ends after it',
    requests: [week],
    reports: [{ range: ['2026-11-19', '2026-12-04'] }],
    conflicts: [true],
  },
  {
    name: 'a report that encloses the request',
    requests: [week],
    reports: [{ range: ['2026-11-02', '2026-12-04'] }],
    conflicts: [true],
  },
  {
    name: 'a report that ends on the first requested day',
    requests: [week],
    reports: [{ range: ['2026-11-09', '2026-11-16'] }],
    conflicts: [true],
  },
  {
    name: 'a report that starts on the last requested day',
    requests: [week],
    reports: [{ range: ['2026-11-20', '2026-11-27'] }],
    conflicts: [true],
  },
  {
    name: 'a report that ends the day before the request',
    requests: [week],
    reports: [{ range: ['2026-11-09', '2026-11-15'] }],
    conflicts: [false],
  },
  {
    name: 'a report that starts the day after the request',
    requests: [week],
    reports: [{ range: ['2026-11-21', '2026-11-27'] }],
    conflicts: [false],
  },
  {
    name: 'a one-day request inside a longer report',
    requests: [oneDay],
    reports: [{ range: ['2026-11-13', '2026-11-18'] }],
    conflicts: [true],
  },
  {
    name: 'a one-day request and a one-day report on the same day',
    requests: [oneDay],
    reports: [{ range: oneDay }],
    conflicts: [true],
  },
  {
    name: 'an open report that started long before the request',
    requests: [week],
    reports: [{ range: ['2025-01-06', null] }],
    conflicts: [true],
  },
  {
    name: 'an open report that starts on the last requested day',
    requests: [week],
    reports: [{ range: ['2026-11-20', null] }],
    conflicts: [true],
  },
  {
    name: 'an open report that starts the day after the request',
    requests: [week],
    reports: [{ range: ['2026-11-21', null] }],
    conflicts: [false],
  },
  {
    name: 'far-apart requests with a report on the later one',
    requests: [spring, week],
    reports: [{ range: ['2026-11-18', '2026-11-18'] }],
    conflicts: [false, true],
  },
  {
    name: 'far-apart requests with a report on the earlier one',
    requests: [spring, week],
    reports: [{ range: ['2026-03-04', '2026-03-04'] }],
    conflicts: [true, false],
  },
  {
    name: 'far-apart requests with a report in the gap between them',
    requests: [spring, week],
    reports: [{ range: ['2026-07-06', '2026-07-10'] }],
    conflicts: [false, false],
  },
  {
    name: 'far-apart requests with an open report that reaches only the later one',
    requests: [spring, week],
    reports: [{ range: ['2026-07-06', null] }],
    conflicts: [false, true],
  },
  {
    name: 'a past report and a later one beside the one that overlaps',
    requests: [week],
    reports: [
      { range: ['2024-02-05', '2024-02-09'] },
      { range: ['2026-11-18', '2026-11-18'] },
      { range: ['2027-01-11', '2027-01-15'] },
    ],
    conflicts: [true],
  },
  {
    name: 'only a past report',
    requests: [week],
    reports: [{ range: ['2024-02-05', '2024-02-09'] }],
    conflicts: [false],
  },
  {
    name: 'a cancelled report',
    requests: [week],
    reports: [{ range: week, status: 'cancelled' }],
    conflicts: [false],
  },
  {
    name: 'a report of another organization on the same record id',
    requests: [week],
    reports: [{ range: week, organizationId: ORGANIZATION_B }],
    conflicts: [false],
  },
];

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
});
const cached = await import('@/lib/data/cached');
const { EMPTY_HOLIDAY_CALENDAR } = await import('@/lib/personnel/targets');
mock.module('@/lib/data/cached', () => ({
  ...cached,
  getCachedOrganizationCalendar: async () => EMPTY_HOLIDAY_CALENDAR,
}));
// Approval authority has its own tests; here the Admin may decide every request.
const responsibilities = await import('@/lib/responsibilities/server');
mock.module('@/lib/responsibilities/server', () => ({
  ...responsibilities,
  authorizeResponsibilityForTarget: async () => ({ success: true }),
}));
const { getPendingVacationRequestsForApprover } = await import('@/lib/vacation/actions');
const { loadActiveAbsences } = await import('@/lib/vacation/approver-targets');
const { createSupabaseAdminClient } = await import('@/lib/supabase/admin');

const pendingRequest = ([start, end]: Range, index: number) => ({
  id: `8f000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
  organization_id: ORGANIZATION_A,
  employee_record_id: recordId,
  start_date: start,
  end_date: end,
  day_portion: 'full',
  status: 'pending',
});
const sicknessReport = ({ range, status, organizationId }: Report, index: number) => ({
  id: `8f000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`,
  organization_id: organizationId ?? ORGANIZATION_A,
  employee_record_id: recordId,
  start_date: range[0],
  end_date: range[1],
  day_portion: 'full',
  status: status ?? 'reported',
});

signInAs(world, 'admin');
for (const { name, requests, reports, conflicts } of cases) {
  world.tables.vacation_requests = requests.map(pendingRequest);
  world.tables.sickness_reports = reports.map(sicknessReport);
  const queue = await getPendingVacationRequestsForApprover();
  assert.ok(queue.success, `${name}: ${JSON.stringify(queue)}`);
  assert.deepEqual(
    queue.requests.map((entry) => entry.hasAbsenceOverlap),
    conflicts,
    `the queue shows the wrong conflicts with ${name}`,
  );
}

// The read takes the reports that reach into the span and leaves the rest of the history behind.
world.tables.sickness_reports = (
  [
    { range: ['2024-02-05', '2024-02-09'] },
    { range: ['2026-11-09', '2026-11-15'] },
    { range: ['2026-11-16', '2026-11-16'] },
    { range: ['2026-11-20', '2026-11-20'] },
    { range: ['2026-11-21', '2026-11-27'] },
    { range: ['2027-01-11', null] },
  ] satisfies Report[]
).map(sicknessReport);
const absences = await loadActiveAbsences(createSupabaseAdminClient(), ORGANIZATION_A, [recordId], {
  from: week[0],
  to: week[1],
});
assert.deepEqual(absences?.map((absence) => absence.start_date).sort(), ['2026-11-16', '2026-11-20']);

// A failed conflict read never tells the approver that there is no conflict.
world.tables.vacation_requests = [pendingRequest(week, 0)];
world.failingTables.add('sickness_reports');
assert.deepEqual(await getPendingVacationRequestsForApprover(), { success: false, error: 'fetch_failed' });

// Without a pending request there is no span, so the failing conflict read is never sent.
world.tables.vacation_requests = [];
assert.deepEqual(await getPendingVacationRequestsForApprover(), { success: true, requests: [] });
