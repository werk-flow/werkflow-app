import { resolveBerlinWallTime } from '../../../lib/planning/date-time';
import { createAdminClient } from './db/shared';
import { getEmployeeRecordStateByUser, giveEmployeesWorkSchedules } from './db/personnel';
import type { TestWorld } from './world';

function addDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Prepare owned prerequisites only; the test must exercise the mutation through the app.
 * A visit is timed for one hour from `hour`, or all-day over `allDayDays` days. It is assigned
 * to the employee unless `assignee` names the Büro member or `assigned` is false.
 */
export async function seedPlanningVisit(
  world: TestWorld,
  input: {
    date: string;
    hour?: number;
    allDayDays?: number;
    assigned?: boolean;
    assignee?: 'employee' | 'buero';
  },
): Promise<{ jobNumber: string; title: string }> {
  const admin = createAdminClient();
  const jobId = crypto.randomUUID();
  const occurrenceId = crypto.randomUUID();
  const jobNumber = `AUF-${world.runId}-${jobId.slice(0, 8)}`;
  const title = `Plantafel ${jobId.slice(0, 8)}`;
  let schedule:
    | { time_kind: 'timed'; start_at: string; end_at: string }
    | { time_kind: 'all_day'; start_date: string; end_date_exclusive: string };
  if (input.allDayDays !== undefined) {
    schedule = {
      time_kind: 'all_day',
      start_date: input.date,
      end_date_exclusive: addDays(input.date, input.allDayDays),
    };
  } else {
    if (input.hour === undefined) throw new Error('A timed planning fixture needs its hour.');
    const start = resolveBerlinWallTime(`${input.date}T${String(input.hour).padStart(2, '0')}:00`);
    const end = resolveBerlinWallTime(`${input.date}T${String(input.hour + 1).padStart(2, '0')}:00`);
    if (!start || !end) throw new Error('Invalid planning fixture interval.');
    schedule = {
      time_kind: 'timed',
      start_at: start.instant.toISOString(),
      end_at: end.instant.toISOString(),
    };
  }
  await giveEmployeesWorkSchedules({
    organizationId: world.orgId,
    actorUserId: world.users.admin.id,
    validFrom: '2026-01-01',
    weekdayMinutes: 480,
    weekendMinutes: 0,
    note: 'Independent planning scenario',
  });
  const { error: jobError } = await admin.from('jobs').insert({
    id: jobId,
    organization_id: world.orgId,
    created_by: world.users.admin.id,
    job_number: jobNumber,
    title,
    status: 'nicht_bearbeitet',
    priority: 'mittel',
  });
  if (jobError) throw new Error(`Planning fixture job failed: ${jobError.message}`);
  const { error: occurrenceError } = await admin.from('planning_occurrences').insert({
    id: occurrenceId,
    organization_id: world.orgId,
    job_id: jobId,
    created_by: world.users.admin.id,
    entry_kind: 'job_visit',
    ...schedule,
  });
  if (occurrenceError) throw new Error(`Planning fixture occurrence failed: ${occurrenceError.message}`);
  if (input.assigned !== false) {
    const assignee = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users[input.assignee ?? 'employee'].id,
    );
    const { error } = await admin.from('planning_occurrence_assignments').insert({
      organization_id: world.orgId,
      occurrence_id: occurrenceId,
      employee_record_id: assignee.id,
      assigned_by: world.users.admin.id,
    });
    if (error) throw new Error(`Planning fixture assignment failed: ${error.message}`);
  }
  return { jobNumber, title };
}
