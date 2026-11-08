// The planner's „Einsatz umplanen“ tasks through the real derivation and the
// real affected-visits reader over the in-memory database. An approved
// vacation over a scheduled visit gives the office exactly one task per visit
// and person; a past or started visit, a parked job and a pending request give none;
// a second vacation over the same visit adds none; replanning the visit or
// withdrawing the vacation resolves it. Another organization's vacation,
// visit or forged assignment never reaches the caller, and a field worker
// gets no task and reaches no service-role client.
import assert from 'node:assert/strict';
import { setSystemTime } from 'bun:test';
import {
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

// Sun 08.11.2026, 11:00 Berlin.
setSystemTime(new Date('2026-11-08T10:00:00.000Z'));

const jonasRecordId = '86000000-0000-4000-8000-000000000001';
const lenaRecordId = '86000000-0000-4000-8000-000000000002';
const foreignRecordId = '86000000-0000-4000-8000-000000000003';
const jonasUserId = '86000000-0000-4000-8000-000000000004';
const vacationId = '86000000-0000-4000-8000-000000000011';
const secondVacationId = '86000000-0000-4000-8000-000000000012';
const lenaPendingId = '86000000-0000-4000-8000-000000000013';
const foreignVacationId = '86000000-0000-4000-8000-000000000014';
const visitId = '86000000-0000-4000-8000-000000000021';
const pastVisitId = '86000000-0000-4000-8000-000000000022';
const longVisitId = '86000000-0000-4000-8000-000000000023';
const parkedVisitId = '86000000-0000-4000-8000-000000000024';
const foreignVisitId = '86000000-0000-4000-8000-000000000025';
const forgedVisitId = '86000000-0000-4000-8000-000000000026';
const jonasOnVisit = '86000000-0000-4000-8000-000000000031';
const lenaOnVisit = '86000000-0000-4000-8000-000000000032';
const jonasOnLongVisit = '86000000-0000-4000-8000-000000000033';
const foreignOnVisit = '86000000-0000-4000-8000-000000000034';

const assignment = (id: string, employeeRecordId: string) => ({ id, employee_record_id: employeeRecordId });
const job = (title: string, jobNumber: string, status = 'nicht_bearbeitet') => ({
  title,
  description: null,
  job_number: jobNumber,
  status,
});
const visit = (input: {
  id: string;
  organizationId?: string;
  startAt: string;
  endAt: string;
  absent: ReturnType<typeof assignment>[];
  job: ReturnType<typeof job>;
}) => ({
  id: input.id,
  organization_id: input.organizationId ?? ORGANIZATION_A,
  status: 'scheduled',
  entry_kind: 'job_visit',
  internal_type: null,
  time_kind: 'timed',
  title: null,
  start_at: input.startAt,
  end_at: input.endAt,
  start_date: null,
  end_date_exclusive: null,
  absent: input.absent,
  job: input.job,
});
const vacation = (input: {
  id: string;
  organizationId?: string;
  recordId: string;
  startDate: string;
  endDate: string;
  status?: string;
}) => ({
  id: input.id,
  organization_id: input.organizationId ?? ORGANIZATION_A,
  employee_record_id: input.recordId,
  start_date: input.startDate,
  end_date: input.endDate,
  day_portion: 'full',
  status: input.status ?? 'approved',
});

const world = installActionWorld({
  employee_records: [
    {
      id: jonasRecordId,
      organization_id: ORGANIZATION_A,
      user_id: jonasUserId,
      first_name: 'M',
      last_name: 'A',
    },
    {
      id: lenaRecordId,
      organization_id: ORGANIZATION_A,
      user_id: null,
      first_name: 'Lena',
      last_name: 'Hartmann',
    },
    {
      id: foreignRecordId,
      organization_id: ORGANIZATION_B,
      user_id: null,
      first_name: 'Frida',
      last_name: 'Fremd',
    },
  ],
  profiles: [{ id: jonasUserId, first_name: 'Jonas', last_name: 'Becker', email: 'jonas@example.test' }],
  vacation_requests: [
    // Approved, already running: 05.–13.11.2026.
    vacation({ id: vacationId, recordId: jonasRecordId, startDate: '2026-11-05', endDate: '2026-11-13' }),
    // Requested only: no task until it is approved.
    vacation({
      id: lenaPendingId,
      recordId: lenaRecordId,
      startDate: '2026-11-11',
      endDate: '2026-11-11',
      status: 'pending',
    }),
    vacation({
      id: foreignVacationId,
      organizationId: ORGANIZATION_B,
      recordId: foreignRecordId,
      startDate: '2026-11-09',
      endDate: '2026-11-13',
    }),
  ],
  planning_occurrences: [
    // Wed 11.11.2026 07:30 Berlin: Jonas and Lena.
    visit({
      id: visitId,
      startAt: '2026-11-11T06:30:00.000Z',
      endAt: '2026-11-11T10:30:00.000Z',
      absent: [assignment(jonasOnVisit, jonasRecordId), assignment(lenaOnVisit, lenaRecordId)],
      job: job('Heizungswartung', 'AUF-2026-201'),
    }),
    // Fri 06.11.2026: inside the vacation, but past.
    visit({
      id: pastVisitId,
      startAt: '2026-11-06T07:00:00.000Z',
      endAt: '2026-11-06T09:00:00.000Z',
      absent: [assignment('86000000-0000-4000-8000-000000000035', jonasRecordId)],
      job: job('Wartung', 'AUF-2026-110'),
    }),
    // Today 07:00 Berlin, finished before 11:00: started visits are history.
    visit({
      id: '86000000-0000-4000-8000-000000000027',
      startAt: '2026-11-08T06:00:00.000Z',
      endAt: '2026-11-08T08:00:00.000Z',
      absent: [assignment('86000000-0000-4000-8000-000000000038', jonasRecordId)],
      job: job('Notdienst', 'AUF-2026-111'),
    }),
    // Fri 13.11. 07:00 to Mon 16.11. 16:00 Berlin: one visit across two vacations.
    visit({
      id: longVisitId,
      startAt: '2026-11-13T06:00:00.000Z',
      endAt: '2026-11-16T15:00:00.000Z',
      absent: [assignment(jonasOnLongVisit, jonasRecordId)],
      job: job('Badsanierung', 'AUF-2026-130'),
    }),
    visit({
      id: parkedVisitId,
      startAt: '2026-11-12T07:00:00.000Z',
      endAt: '2026-11-12T09:00:00.000Z',
      absent: [assignment('86000000-0000-4000-8000-000000000036', jonasRecordId)],
      job: job('Geparkt', 'AUF-2026-131', 'geparkt'),
    }),
    visit({
      id: foreignVisitId,
      organizationId: ORGANIZATION_B,
      startAt: '2026-11-10T07:00:00.000Z',
      endAt: '2026-11-10T09:00:00.000Z',
      absent: [assignment(foreignOnVisit, foreignRecordId)],
      job: job('Andere Firma', 'AUF-2026-999'),
    }),
    // Another organization's visit that names organization A's person.
    visit({
      id: forgedVisitId,
      organizationId: ORGANIZATION_B,
      startAt: '2026-11-12T07:00:00.000Z',
      endAt: '2026-11-12T09:00:00.000Z',
      absent: [assignment('86000000-0000-4000-8000-000000000037', jonasRecordId)],
      job: job('Fremder Einsatz', 'AUF-2026-998'),
    }),
  ],
  planning_dispatches: [],
});

const { resolveActionContext } = await import('@/lib/org/action-context');
const { deriveVisitReplanTasks } = await import('@/lib/attention/replan-tasks');

async function tasksOfCaller() {
  const auth = await resolveActionContext();
  assert.ok(auth.success, JSON.stringify(auth));
  const derived = await deriveVisitReplanTasks(auth.context);
  assert.equal(derived.failed, false);
  return derived.tasks;
}

// The office of organization A: one task per visit and person still ahead.
signInAs(world, 'buero');
assert.deepEqual(await tasksOfCaller(), [
  {
    sourceType: 'planning_visit_replan',
    sourceId: jonasOnVisit,
    personName: 'Jonas Becker',
    date: '2026-11-11',
    time: '07:30',
    visitTitle: 'Heizungswartung',
    jobNumber: 'AUF-2026-201',
    dispatchState: 'nicht_gesendet',
  },
  {
    sourceType: 'planning_visit_replan',
    sourceId: jonasOnLongVisit,
    personName: 'Jonas Becker',
    date: '2026-11-13',
    time: '07:00',
    visitTitle: 'Badsanierung',
    jobNumber: 'AUF-2026-130',
    dispatchState: 'nicht_gesendet',
  },
]);

// A second approved vacation over the long visit adds no second task for it.
tableRows(world, 'vacation_requests').push(
  vacation({
    id: secondVacationId,
    recordId: jonasRecordId,
    startDate: '2026-11-16',
    endDate: '2026-11-17',
  }),
);
assert.deepEqual(
  (await tasksOfCaller()).map((task) => task.sourceId),
  [jonasOnVisit, jonasOnLongVisit],
);

// Lena's approval adds her own task on the shared visit.
const lenaRequest = tableRows(world, 'vacation_requests').find((row) => row.id === lenaPendingId);
assert.ok(lenaRequest);
lenaRequest.status = 'approved';
assert.deepEqual(
  (await tasksOfCaller()).map((task) => task.sourceId),
  [jonasOnVisit, lenaOnVisit, jonasOnLongVisit],
);

// Replanning the visit without Jonas resolves his task there; Lena's stays.
const sharedVisit = tableRows(world, 'planning_occurrences').find((row) => row.id === visitId);
assert.ok(sharedVisit);
sharedVisit.absent = [assignment(lenaOnVisit, lenaRecordId)];
assert.deepEqual(
  (await tasksOfCaller()).map((task) => task.sourceId),
  [lenaOnVisit, jonasOnLongVisit],
);

// Withdrawing a vacation resolves its tasks: the long visit still meets the second one.
const firstVacation = tableRows(world, 'vacation_requests').find((row) => row.id === vacationId);
assert.ok(firstVacation);
firstVacation.status = 'cancelled';
lenaRequest.status = 'withdrawn';
assert.deepEqual(
  (await tasksOfCaller()).map((task) => task.sourceId),
  [jonasOnLongVisit],
);

// Admin sees the same; a foreign cookie selects nothing in organization B.
signInAs(world, 'admin');
world.activeOrganizationCookie = ORGANIZATION_B;
assert.deepEqual(
  (await tasksOfCaller()).map((task) => task.sourceId),
  [jonasOnLongVisit],
);

// The office of organization B sees its own visit only, never A's person on its forged assignment.
signInAs(world, 'buero', ORGANIZATION_B);
assert.deepEqual(
  (await tasksOfCaller()).map((task) => [task.sourceId, 'personName' in task ? task.personName : null]),
  [[foreignOnVisit, 'Frida Fremd']],
);

// A field worker plans nothing: no task, and no service-role client.
signInAs(world, 'employee');
const requestsBefore = world.adminClientRequests;
assert.deepEqual(await tasksOfCaller(), []);
assert.equal(world.adminClientRequests, requestsBefore, 'a field worker reaches no service-role client');

// A failed read fails the derivation instead of reporting no task.
signInAs(world, 'buero');
world.failingTables.add('planning_occurrences');
const auth = await resolveActionContext();
assert.ok(auth.success);
assert.deepEqual(await deriveVisitReplanTasks(auth.context), { tasks: [], failed: true });
