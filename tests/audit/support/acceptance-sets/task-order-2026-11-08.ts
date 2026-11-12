import { randomUUID } from 'node:crypto';
import { worldName } from '../../../../lib/testing/seed-world-plan';
import { berlinDateAtOffset } from '../../../golden/support/date-ownership';
import { seedRequest } from '../../../golden/support/db/requests';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

const CALLER = 'Erika Sommer';

/** An instant `days` business days ago, in the Berlin morning. */
function daysAgo(days: number): string {
  return `${berlinDateAtOffset(-days)}T07:00:00.000Z`;
}

/**
 * The Büro's Aufgaben with time-bound decisions and a handover backlog: pending
 * time of six weeks ago, a vacation request of last week, an unowned Anfrage,
 * and more completed jobs than the handover section shows before „Alle anzeigen“.
 */
async function officeTaskBacklog(world: TestWorld): Promise<SurfaceDestination> {
  await surfaceFixture(world, 'acceptance.office-task-backlog', async () => {
    const admin = createAdminClient();
    const employee = world.users.employee.id;
    const workDay = berlinDateAtOffset(-42);
    await admin
      .from('time_entries')
      .insert(
        (['clock_in', 'clock_out'] as const).map((entryType) => ({
          organization_id: world.orgId,
          user_id: employee,
          entry_type: entryType,
          timestamp: `${workDay}T${entryType === 'clock_in' ? '06' : '14'}:00:00.000Z`,
          status: 'pending' as const,
          is_manual: true,
          created_at: daysAgo(41),
        })),
      )
      .throwOnError();
    const { data: record } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', world.orgId)
      .eq('user_id', employee)
      .single()
      .throwOnError();
    await admin
      .from('vacation_requests')
      .insert({
        organization_id: world.orgId,
        employee_record_id: record.id,
        start_date: berlinDateAtOffset(-5),
        end_date: berlinDateAtOffset(-5),
        day_portion: 'full',
        status: 'pending',
        requested_by: employee,
        created_at: daysAgo(9),
      })
      .throwOnError();
    const requestId = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary: worldName('Heizung im Altbau fällt aus', world.runId),
      requestNumber: `ANF-${world.runId}-OPEN`,
      callerName: CALLER,
    });
    await admin
      .from('client_requests')
      .update({ received_at: daysAgo(7) })
      .eq('id', requestId)
      .throwOnError();
    await admin
      .from('jobs')
      .insert(
        [1, 2, 3, 4, 5].map((index) => ({
          id: randomUUID(),
          organization_id: world.orgId,
          created_by: world.users.admin.id,
          job_number: `UEB-${world.runId}-${index}`,
          title: worldName(`Wartung Gastherme ${index}`, world.runId),
          execution_state: 'execution_complete' as const,
        })),
      )
      .throwOnError();
    return requestId;
  });
  return { route: '/aufgaben', heading: 'Zeitfreigaben' };
}

/**
 * werk-flow/werkflow-planning#144 of 2026-11-08: Aufgaben for Büro, with the
 * time-bound decisions first and the handover backlog counted at the end.
 */
function taskOrderCaptures(): OpenSet {
  return {
    id: 'task-order-2026-11-08',
    captures: [
      {
        id: 'buero-aufgaben',
        role: 'buero',
        route: '/aufgaben',
        view: { kind: 'page' },
        destination: officeTaskBacklog,
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
      {
        id: 'buero-aufgaben-uebergaben',
        role: 'buero',
        route: '/aufgaben',
        view: { kind: 'page' },
        destination: officeTaskBacklog,
        reveal: 'Alle anzeigen',
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
    ],
    standalone: [],
  };
}

acceptanceSet(taskOrderCaptures());
