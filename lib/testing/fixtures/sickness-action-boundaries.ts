// Actual sickness actions over the in-memory database: a field worker is
// refused the office reads and writes before any database access and cannot
// change a colleague's report; a report or employee record of another
// organization is not found, and nothing is written on a refusal. The shared
// calendar shows a field worker only the own absence and a manager every
// absence of the organization, never its kind.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const ownRecordId = '86000000-0000-4000-8000-000000000001';
const colleagueRecordId = '86000000-0000-4000-8000-000000000002';
const foreignRecordId = '86000000-0000-4000-8000-000000000003';
const colleagueReportId = '86000000-0000-4000-8000-000000000004';
const foreignReportId = '86000000-0000-4000-8000-000000000005';
const ownReportId = '86000000-0000-4000-8000-000000000006';

const report = (id: string, organizationId: string, employeeRecordId: string) => ({
  id,
  organization_id: organizationId,
  employee_record_id: employeeRecordId,
  absence_type: 'krankheit',
  start_date: '2026-10-19',
  end_date: null,
  day_portion: 'full',
  status: 'reported',
  evidence_required: false,
  evidence_status: 'not_required',
  reported_by: null,
  cancelled_by: null,
  cancelled_at: null,
  cancellation_reason: null,
  created_at: '2026-10-19T07:00:00.000Z',
  updated_at: '2026-10-19T07:00:00.000Z',
});

const world = installActionWorld({
  employee_records: [
    { id: ownRecordId, organization_id: ORGANIZATION_A, user_id: CALLER_ID },
    { id: colleagueRecordId, organization_id: ORGANIZATION_A, user_id: null },
    { id: foreignRecordId, organization_id: ORGANIZATION_B, user_id: null },
  ],
  sickness_reports: [
    report(ownReportId, ORGANIZATION_A, ownRecordId),
    report(colleagueReportId, ORGANIZATION_A, colleagueRecordId),
    report(foreignReportId, ORGANIZATION_B, foreignRecordId),
  ],
});
const {
  getSicknessReportsForRecord,
  recordSicknessForMember,
  endSicknessReport,
  correctSicknessReport,
  cancelSicknessReport,
  setSicknessEvidence,
  getSicknessCalendarEntries,
} = await import('@/lib/sickness/actions');

const period = {
  absenceType: 'krankheit',
  startDate: '2026-10-19',
  endDate: '2026-10-21',
  dayPortion: 'full',
} as const;
const reason = 'Falsch erfasst';
const mutationsOf = (reportId: string) =>
  [
    ['endSicknessReport', () => endSicknessReport({ reportId, endDate: '2026-10-21' })],
    ['correctSicknessReport', () => correctSicknessReport({ ...period, reportId, reason })],
    ['cancelSicknessReport', () => cancelSicknessReport({ reportId, reason })],
  ] as const;
const evidenceOf = (reportId: string) =>
  [
    'setSicknessEvidence',
    () => setSicknessEvidence({ reportId, evidenceRequired: true, evidenceStatus: 'pending' }),
  ] as const;
const recordFor = (employeeRecordId: string) =>
  [
    'recordSicknessForMember',
    () => recordSicknessForMember({ ...period, employeeRecordId, evidenceRequired: false }),
  ] as const;

// Field workers are refused the office reads and writes before the
// service-role client exists, and a colleague's report after it is loaded.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['getSicknessReportsForRecord', () => getSicknessReportsForRecord(colleagueRecordId)],
    recordFor(colleagueRecordId),
    evidenceOf(colleagueReportId),
  ],
  { success: false, error: 'not_authorized' },
  'none',
);
await assertRefused(
  world,
  mutationsOf(colleagueReportId),
  { success: false, error: 'not_authorized' },
  'reads',
);

// A caller without an active organization reads no calendar.
signInAs(world, null);
await assertRefused(
  world,
  [['getSicknessCalendarEntries', () => getSicknessCalendarEntries()]],
  { success: false, error: 'no_active_org' },
  'none',
);

// Büro does not find another organization's employee record or report.
signInAs(world, 'buero');
await assertRefused(
  world,
  [recordFor(foreignRecordId)],
  { success: false, error: 'record_not_found' },
  'reads',
);
await assertRefused(
  world,
  [...mutationsOf(foreignReportId), evidenceOf(foreignReportId)],
  { success: false, error: 'not_found' },
  'reads',
);
// Another organization's employee record lists none of its reports.
assert.deepEqual(await getSicknessReportsForRecord(foreignRecordId), { success: true, reports: [] });
assert.equal(world.rpcCalls.length, 0);

// The calendar shows a field worker only the own absence, a manager every
// absence of the organization, and no one its kind.
const calendarIds = async (): Promise<string[]> => {
  const calendar = await getSicknessCalendarEntries({ from: '2026-10-01', to: '2026-10-31' });
  assert.ok(calendar.success, `the calendar failed: ${JSON.stringify(calendar)}`);
  assert.doesNotMatch(JSON.stringify(calendar.entries), /krankheit|absenceType|absence_type/);
  return calendar.entries.map((entry) => entry.id).sort();
};
signInAs(world, 'employee');
assert.deepEqual(await calendarIds(), [ownReportId]);
signInAs(world, 'buero');
assert.deepEqual(await calendarIds(), [colleagueReportId, ownReportId].sort());
