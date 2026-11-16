// Actual Berufsschule-day actions over the in-memory database: a field
// worker is refused every office read and write before any database access;
// Büro does not find another organization's employee record or school day,
// and nothing is written on a refusal. Büro records, ends and cancels a
// school day of its own organization, with itself as the actor.
import { setSystemTime } from 'bun:test';
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

// The rules below are dated from November 2026; a new rule may start at most
// on January 1 of the previous business year, which reads today.
setSystemTime(new Date('2026-11-12T10:00:00.000Z'));

const apprenticeRecordId = '87000000-0000-4000-8000-000000000001';
const foreignRecordId = '87000000-0000-4000-8000-000000000002';
const ownSchoolDayId = '87000000-0000-4000-8000-000000000003';
const foreignSchoolDayId = '87000000-0000-4000-8000-000000000004';
const journeymanRecordId = '87000000-0000-4000-8000-000000000005';
const formerApprenticeRecordId = '87000000-0000-4000-8000-000000000008';

const weeklyRule = (id: string, organizationId: string, employeeRecordId: string) => ({
  id,
  organization_id: organizationId,
  employee_record_id: employeeRecordId,
  kind: 'weekday',
  weekday: 0,
  start_date: '2026-11-16',
  end_date: null,
  created_by: CALLER_ID,
  created_at: '2026-11-12T07:00:00.000Z',
  ended_by: null,
  ended_at: null,
  cancelled_by: null,
  cancelled_at: null,
});

const world = installActionWorld({
  employee_records: [
    { id: apprenticeRecordId, organization_id: ORGANIZATION_A, user_id: null },
    { id: foreignRecordId, organization_id: ORGANIZATION_B, user_id: null },
    { id: journeymanRecordId, organization_id: ORGANIZATION_A, user_id: null },
    { id: formerApprenticeRecordId, organization_id: ORGANIZATION_A, user_id: null },
  ],
  employment_conditions: [
    {
      id: '87000000-0000-4000-8000-000000000006',
      organization_id: ORGANIZATION_A,
      employee_record_id: apprenticeRecordId,
      valid_from: '2025-09-01',
      employment_type: 'ausbildung',
    },
    {
      id: '87000000-0000-4000-8000-000000000007',
      organization_id: ORGANIZATION_A,
      employee_record_id: journeymanRecordId,
      valid_from: '2024-01-01',
      employment_type: 'vollzeit',
    },
    // An apprentice until the end of November 2026, a journeyman from December.
    {
      id: '87000000-0000-4000-8000-000000000009',
      organization_id: ORGANIZATION_A,
      employee_record_id: formerApprenticeRecordId,
      valid_from: '2023-09-01',
      employment_type: 'ausbildung',
    },
    {
      id: '87000000-0000-4000-8000-000000000010',
      organization_id: ORGANIZATION_A,
      employee_record_id: formerApprenticeRecordId,
      valid_from: '2026-12-01',
      employment_type: 'vollzeit',
    },
  ],
  school_days: [
    weeklyRule(ownSchoolDayId, ORGANIZATION_A, apprenticeRecordId),
    weeklyRule(foreignSchoolDayId, ORGANIZATION_B, foreignRecordId),
  ],
});
const { getSchoolDaysForRecord, addSchoolDay, endSchoolDay, cancelSchoolDay } = await import(
  '@/lib/personnel/school-day-actions'
);

const block = (employeeRecordId: string) =>
  ({
    employeeRecordId,
    kind: 'block',
    weekday: null,
    startDate: '2026-12-07',
    endDate: '2026-12-18',
  }) as const;
const writesOn = (schoolDayId: string, employeeRecordId: string) =>
  [
    ['addSchoolDay', () => addSchoolDay(block(employeeRecordId))],
    ['endSchoolDay', () => endSchoolDay({ schoolDayId, endDate: '2027-01-31' })],
    ['cancelSchoolDay', () => cancelSchoolDay(schoolDayId)],
  ] as const;

// A field worker, the apprentice included, is refused before the
// service-role client exists.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['getSchoolDaysForRecord', () => getSchoolDaysForRecord(apprenticeRecordId)],
    ...writesOn(ownSchoolDayId, apprenticeRecordId),
  ],
  { success: false, error: 'not_authorized' },
  'none',
);

// Büro does not find another organization's record or school day, and
// records none for a person outside an apprenticeship.
signInAs(world, 'buero');
await assertRefused(
  world,
  [writesOn(foreignSchoolDayId, foreignRecordId)[0]],
  { success: false, error: 'record_not_found' },
  'reads',
);
await assertRefused(
  world,
  writesOn(foreignSchoolDayId, foreignRecordId).slice(1),
  { success: false, error: 'school_day_not_found' },
  'reads',
);
assert.deepEqual(await getSchoolDaysForRecord(foreignRecordId), { success: true, schoolDays: [] });

// A person who never was an apprentice gets no school day, and an apprentice
// who becomes a journeyman before the block ends gets none for it.
await assertRefused(
  world,
  [writesOn(ownSchoolDayId, journeymanRecordId)[0], writesOn(ownSchoolDayId, formerApprenticeRecordId)[0]],
  { success: false, error: 'not_an_apprentice' },
  'reads',
);

// Büro records, ends and cancels a school day of its own organization.
const added = await addSchoolDay(block(apprenticeRecordId));
assert.ok(added.success, `the block was refused: ${JSON.stringify(added)}`);
const stored = world.tables.school_days?.find((row) => row.id === added.schoolDay.id);
assert.equal(stored?.organization_id, ORGANIZATION_A);
assert.equal(stored?.created_by, CALLER_ID);

const ended = await endSchoolDay({ schoolDayId: ownSchoolDayId, endDate: '2027-01-31' });
assert.ok(ended.success, `the end was refused: ${JSON.stringify(ended)}`);
assert.equal(ended.schoolDay.endDate, '2027-01-31');
assert.deepEqual(await endSchoolDay({ schoolDayId: ownSchoolDayId, endDate: '2027-02-28' }), {
  success: false,
  error: 'school_day_end_not_earlier',
});

const cancelled = await cancelSchoolDay(added.schoolDay.id);
assert.ok(cancelled.success, `the cancel was refused: ${JSON.stringify(cancelled)}`);
assert.notEqual(cancelled.schoolDay.cancelledAt, null);
assert.deepEqual(await cancelSchoolDay(added.schoolDay.id), {
  success: false,
  error: 'school_day_not_found',
});

const listed = await getSchoolDaysForRecord(apprenticeRecordId);
assert.ok(listed.success);
assert.deepEqual(
  listed.schoolDays.map((schoolDay) => schoolDay.id).sort(),
  [added.schoolDay.id, ownSchoolDayId].sort(),
);
assert.equal(world.rpcCalls.length, 0);
