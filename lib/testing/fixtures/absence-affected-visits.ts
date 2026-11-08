// The office records a sickness over a dispatched visit, then reads the
// visits the absence affects through the real actions over the in-memory
// database: the dispatched visit comes back with its „gesendet“ state, a
// later undispatched visit with „nicht gesendet“; a coworker's visit, a
// parked job, a note and another organization's visit stay out; a field
// worker and a foreign record are refused.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';

const absentRecordId = '83000000-0000-4000-8000-000000000001';
const coworkerRecordId = '83000000-0000-4000-8000-000000000002';
const foreignRecordId = '83000000-0000-4000-8000-000000000003';
const absentUserId = '83000000-0000-4000-8000-000000000004';
const dispatchedVisitId = '83000000-0000-4000-8000-000000000011';
const laterVisitId = '83000000-0000-4000-8000-000000000012';
const coworkerVisitId = '83000000-0000-4000-8000-000000000013';
const parkedVisitId = '83000000-0000-4000-8000-000000000014';
const noteId = '83000000-0000-4000-8000-000000000015';
const foreignVisitId = '83000000-0000-4000-8000-000000000016';
const dispatchId = '83000000-0000-4000-8000-000000000021';
const revisionId = '83000000-0000-4000-8000-000000000022';
const sicknessReportId = '83000000-0000-4000-8000-000000000031';

const job = (title: string, jobNumber: string, status = 'nicht_bearbeitet') => ({
  title,
  description: null,
  job_number: jobNumber,
  status,
});
const timedVisit = (input: {
  id: string;
  organizationId?: string;
  recordId?: string;
  startAt: string;
  endAt: string;
  job: ReturnType<typeof job> | null;
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
  // The assignment shares the visit's id under another prefix.
  absent: [{ id: input.id.replace(/^83/, '84'), employee_record_id: input.recordId ?? absentRecordId }],
  job: input.job,
});

const world = installActionWorld({
  employee_records: [
    {
      id: absentRecordId,
      organization_id: ORGANIZATION_A,
      user_id: absentUserId,
      first_name: 'Daniel',
      last_name: 'Krüger',
    },
    {
      id: coworkerRecordId,
      organization_id: ORGANIZATION_A,
      user_id: null,
      first_name: 'Lena',
      last_name: 'B',
    },
    { id: foreignRecordId, organization_id: ORGANIZATION_B, user_id: null, first_name: 'X', last_name: 'Y' },
  ],
  profiles: [{ id: absentUserId, first_name: 'Daniel', last_name: 'Krüger' }],
  organization_members: [{ user_id: absentUserId, organization_id: ORGANIZATION_A }],
  vacation_requests: [],
  planning_occurrences: [
    // Fri 30.10.2026 08:00 Berlin, dispatched to the absent person.
    timedVisit({
      id: dispatchedVisitId,
      startAt: '2026-10-30T07:00:00.000Z',
      endAt: '2026-10-30T09:00:00.000Z',
      job: job('Heizungswartung', 'AUF-2026-145'),
    }),
    // Mon 02.11.2026 07:30 Berlin, planned but not sent.
    timedVisit({
      id: laterVisitId,
      startAt: '2026-11-02T06:30:00.000Z',
      endAt: '2026-11-02T10:30:00.000Z',
      job: job('Bad-Sanierung', 'AUF-2026-150'),
    }),
    timedVisit({
      id: coworkerVisitId,
      recordId: coworkerRecordId,
      startAt: '2026-10-30T07:00:00.000Z',
      endAt: '2026-10-30T09:00:00.000Z',
      job: job('Fremder Termin', 'AUF-2026-151'),
    }),
    timedVisit({
      id: parkedVisitId,
      startAt: '2026-10-31T07:00:00.000Z',
      endAt: '2026-10-31T09:00:00.000Z',
      job: job('Geparkt', 'AUF-2026-152', 'geparkt'),
    }),
    {
      ...timedVisit({ id: noteId, startAt: '', endAt: '', job: null }),
      entry_kind: 'internal',
      internal_type: 'other',
      time_kind: 'all_day',
      title: 'Notiz',
      start_at: null,
      end_at: null,
      start_date: '2026-10-30',
      end_date_exclusive: '2026-10-31',
    },
    timedVisit({
      id: foreignVisitId,
      organizationId: ORGANIZATION_B,
      startAt: '2026-10-30T07:00:00.000Z',
      endAt: '2026-10-30T09:00:00.000Z',
      job: job('Andere Firma', 'AUF-2026-999'),
    }),
  ],
  planning_dispatches: [
    {
      id: dispatchId,
      organization_id: ORGANIZATION_A,
      occurrence_id: dispatchedVisitId,
      job_id: null,
      status: 'active',
      current_revision_id: revisionId,
    },
  ],
  planning_dispatch_revisions: [
    {
      id: revisionId,
      organization_id: ORGANIZATION_A,
      dispatch_id: dispatchId,
      revision_number: 1,
      change_kind: 'issued',
      occurrence_id: dispatchedVisitId,
      job_id: null,
      dispatch_note: null,
      created_at: '2026-10-29T15:00:00.000Z',
    },
  ],
  planning_dispatch_recipients: [
    {
      id: '83000000-0000-4000-8000-000000000023',
      organization_id: ORGANIZATION_A,
      revision_id: revisionId,
      employee_record_id: absentRecordId,
    },
  ],
  planning_dispatch_acknowledgements: [],
});
world.rpc = ({ name, args }) => {
  assert.equal(name, 'create_sickness_report');
  return {
    data: {
      id: sicknessReportId,
      organization_id: args.p_organization_id,
      employee_record_id: args.p_employee_record_id,
      absence_type: args.p_absence_type,
      start_date: args.p_start_date,
      end_date: args.p_end_date,
      day_portion: args.p_day_portion,
      status: 'reported',
      evidence_required: args.p_evidence_required,
      evidence_status: 'not_required',
      reported_by: args.p_actor_id,
      cancelled_by: null,
      cancelled_at: null,
      cancellation_reason: null,
      created_at: '2026-10-30T05:45:00.000Z',
      updated_at: '2026-10-30T05:45:00.000Z',
    },
    error: null,
  };
};

const { recordSicknessForMember } = await import('@/lib/sickness/actions');
const { getAbsenceAffectedVisits } = await import('@/lib/calendar/actions');

// The office records Daniel sick from 30.10.2026, open-ended.
signInAs(world, 'buero');
const recorded = await recordSicknessForMember({
  employeeRecordId: absentRecordId,
  absenceType: 'krankheit',
  startDate: '2026-10-30',
  endDate: null,
  dayPortion: 'full',
  evidenceRequired: false,
});
assert.ok(recorded.success, JSON.stringify(recorded));
const absence = {
  employeeRecordId: recorded.report.employeeRecordId,
  startDate: recorded.report.startDate,
  endDate: recorded.report.endDate,
};

// The affected list names the dispatched visit as sent and the later one as not sent, nothing else.
const affected = await getAbsenceAffectedVisits(absence);
assert.ok(affected.success, JSON.stringify(affected));
assert.deepEqual(affected.visits, [
  {
    occurrenceId: dispatchedVisitId,
    date: '2026-10-30',
    time: '08:00',
    title: 'Heizungswartung',
    jobNumber: 'AUF-2026-145',
    dispatchState: 'ausstehend',
  },
  {
    occurrenceId: laterVisitId,
    date: '2026-11-02',
    time: '07:30',
    title: 'Bad-Sanierung',
    jobNumber: 'AUF-2026-150',
    dispatchState: 'nicht_gesendet',
  },
]);

// A known end bounds the list: a sickness on 30.10. alone leaves the visit of 02.11. out.
const oneDay = await getAbsenceAffectedVisits({ ...absence, endDate: '2026-10-30' });
assert.ok(oneDay.success, JSON.stringify(oneDay));
assert.deepEqual(
  oneDay.visits.map((visit) => visit.occurrenceId),
  [dispatchedVisitId],
);
assert.equal(oneDay.through, '2026-10-30');

// Another organization's record is not found, and an end before the start is refused.
assert.deepEqual(await getAbsenceAffectedVisits({ ...absence, employeeRecordId: foreignRecordId }), {
  success: false,
  error: 'employee_not_found',
});
assert.deepEqual(await getAbsenceAffectedVisits({ ...absence, endDate: '2026-10-29' }), {
  success: false,
  error: 'invalid_input',
});

// A field worker plans nothing and reads nobody's affected visits.
signInAs(world, 'employee');
const requestsBefore = world.adminClientRequests;
assert.deepEqual(await getAbsenceAffectedVisits(absence), { success: false, error: 'not_authorized' });
assert.equal(world.adminClientRequests, requestsBefore, 'a refused caller reaches no service-role client');

// More absences than one read carries: each still gets its own visits, in the order asked,
// also when the two people of one visit land in different reads.
const { loadAbsencesAffectedVisits } = await import('@/lib/calendar/absence-visits');
const { createSupabaseAdminClient } = await import('@/lib/supabase/admin');
const sharedVisitId = '83000000-0000-4000-8000-000000000017';
world.tables.planning_occurrences?.push({
  ...timedVisit({
    id: sharedVisitId,
    startAt: '2026-12-20T07:00:00.000Z',
    endAt: '2026-12-20T09:00:00.000Z',
    job: job('Gemeinsamer Termin', 'AUF-2026-160'),
  }),
  absent: [
    { id: '85000000-0000-4000-8000-000000000001', employee_record_id: absentRecordId },
    { id: '85000000-0000-4000-8000-000000000002', employee_record_id: coworkerRecordId },
  ],
});
// The absent person sorts first, so the coworker's 20.12. lands in the second read of fifteen.
const coworkerDays = [
  ...Array.from({ length: 15 }, (_, index) => `2026-12-${String(index + 1).padStart(2, '0')}`),
  '2026-12-20',
].map((day) => ({
  employeeRecordId: coworkerRecordId,
  from: day,
  to: day,
}));
const batched = await loadAbsencesAffectedVisits({
  admin: createSupabaseAdminClient(),
  orgId: ORGANIZATION_A,
  absences: [
    ...coworkerDays,
    { employeeRecordId: absentRecordId, from: '2026-10-30', to: '2026-10-30' },
    { employeeRecordId: absentRecordId, from: '2026-12-20', to: '2026-12-20' },
  ],
});
assert.ok(batched);
const assignmentsOf = (index: number) => batched[index]?.map((entry) => entry.assignmentId);
assert.equal(batched.length, 18);
assert.ok(batched.slice(0, 15).every((visits) => visits.length === 0));
assert.deepEqual(assignmentsOf(15), ['85000000-0000-4000-8000-000000000002']);
assert.deepEqual(assignmentsOf(16), [dispatchedVisitId.replace(/^83/, '84')]);
assert.deepEqual(assignmentsOf(17), ['85000000-0000-4000-8000-000000000001']);
