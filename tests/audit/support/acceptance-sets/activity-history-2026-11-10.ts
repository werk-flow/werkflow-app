import { resolveBerlinWallTime } from '../../../../lib/date-time/berlin';
import { berlinDateAtOffset } from '../../../golden/support/date-ownership';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { layoutNames, prepareLayoutDetails } from '../layout-fixtures';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/** The instant `seconds` after a Berlin wall-clock minute, `days` business days from today. */
function berlinInstant(days: number, time: string, seconds = 0): string {
  const resolved = resolveBerlinWallTime(`${berlinDateAtOffset(days)}T${time}`);
  if (!resolved) throw new Error(`berlinInstant: ${time} is not a Berlin wall time`);
  return new Date(resolved.instant.getTime() + seconds * 1000).toISOString();
}

/**
 * The employee's recorded time on the layout job as legacy entries wrote
 * it: yesterday's day with a break, where the job rides only on the clock-in
 * and the break end, and a tap shorter than a minute; the day before, a
 * clock-in without its clock-out.
 */
async function seedEmployeeActivities(world: TestWorld): Promise<void> {
  const { jobId } = await prepareLayoutDetails(world);
  await surfaceFixture(world, 'acceptance.employee-activities', async () => {
    const rows = [
      [-1, 'clock_in', '06:57', 0, jobId],
      [-1, 'break_start', '11:08', 0, null],
      [-1, 'break_end', '11:38', 0, jobId],
      [-1, 'clock_out', '15:49', 0, null],
      [-1, 'clock_in', '16:10', 10, jobId],
      [-1, 'clock_out', '16:10', 40, null],
      [-2, 'clock_in', '07:00', 0, jobId],
    ] as const;
    await createAdminClient()
      .from('time_entries')
      .insert(
        rows.map(([days, entryType, time, seconds, job]) => ({
          organization_id: world.orgId,
          user_id: world.users.employee.id,
          entry_type: entryType,
          timestamp: berlinInstant(days, time, seconds),
          job_id: job,
          status: 'approved' as const,
          // The database takes a past entry only as a manual one, as the legacy same-day entry was.
          is_manual: true,
        })),
      )
      .throwOnError();
    return 'seeded';
  });
}

async function employeeActivityHistory(world: TestWorld): Promise<SurfaceDestination> {
  await seedEmployeeActivities(world);
  return { route: '/zeiterfassung' };
}

async function employeeActivityJob(world: TestWorld): Promise<SurfaceDestination> {
  await seedEmployeeActivities(world);
  const { jobNumber } = await prepareLayoutDetails(world);
  return { route: `/auftraege/${jobNumber}`, heading: layoutNames(world).job };
}

/**
 * werk-flow/werkflow-planning#158 of 2026-11-10: recorded time as activities.
 * The employee's Verlauf as days with one row per activity, and the work
 * pack's „Meine Zeit“ with each time's span and duration, from a legacy day
 * whose clock-out names no job, a tap shorter than a minute and a clock-in
 * without its clock-out.
 */
function activityHistoryCaptures(): OpenSet {
  const phone = { role: 'employee', widths: [375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'activity-history-2026-11-10',
    captures: [
      {
        id: 'employee-zeiterfassung-tab-history',
        route: '/zeiterfassung',
        view: { kind: 'tab', value: 'history' },
        destination: employeeActivityHistory,
        reveal: 'Ende fehlt',
        role: 'employee',
        widths: [375, 1280],
        schemes: ['light', 'dark'],
      },
      {
        id: 'employee-auftraege-jobNumber',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'page' },
        destination: employeeActivityJob,
        reveal: 'Aktivität wählen',
        ...phone,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(activityHistoryCaptures());
