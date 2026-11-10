import { randomUUID } from 'node:crypto';
import { resolveBerlinWallTime } from '../../../lib/date-time/berlin';
import { worldName } from '../../../lib/testing/seed-world-plan';
import { berlinDateAtOffset } from '../../golden/support/date-ownership';
import { seedCustomer } from '../../golden/support/db/customers';
import { seedRequest } from '../../golden/support/db/requests';
import { createAdminClient } from '../../golden/support/db/shared';
import type { TestWorld } from '../../golden/support/world';
import type { AcceptanceRecord } from './acceptance-sets';
import { layoutNames, prepareLayoutDetails } from './layout-fixtures';
import { surfaceFixture } from './surface-fixtures';
import type { SurfaceDestination } from './surface-routes';

const CALLER = 'Erika Sommer';

/** An open request whose caller is already a customer: same name, the phone in another notation. */
async function callerMatchRequest(world: TestWorld): Promise<SurfaceDestination> {
  const summary = worldName('Heizung bleibt kalt im Erdgeschoss', world.runId);
  const requestId = await surfaceFixture(world, 'acceptance.caller-match-request', async () => {
    await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: CALLER,
      contacts: [{ name: CALLER, phone: '+49 (0)30 4440123', isPrimary: true }],
    });
    return seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary,
      requestNumber: `ANF-${world.runId}-MATCH`,
      callerName: CALLER,
      callerPhone: '030 44 40 123',
      callerAddress: 'Lindenweg 7, 10115 Berlin',
    });
  });
  return { route: `/anfragen/${requestId}`, heading: summary };
}

/** A request whose new caller was promoted with the captured address, ready to convert. */
async function promotedCallerRequest(world: TestWorld): Promise<SurfaceDestination> {
  const summary = worldName('Neue Therme für die Dachwohnung', world.runId);
  const requestId = await surfaceFixture(world, 'acceptance.promoted-caller-request', async () => {
    const id = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary,
      requestNumber: `ANF-${world.runId}-NEW`,
      callerName: worldName('Jonas Neumann', world.runId),
      callerPhone: '0171 2345678',
      callerAddress: 'Lindenallee 12, 10115 Berlin',
    });
    await createAdminClient()
      .rpc('promote_client_request_caller', {
        p_actor_id: world.users.admin.id,
        p_organization_id: world.orgId,
        p_request_id: id,
        p_name: '',
        p_client_type: 'privat',
      })
      .throwOnError();
    return id;
  });
  return { route: `/anfragen/${requestId}`, heading: summary };
}

/**
 * An archived customer whose name, phone and contact email changed through
 * the write functions, so the chronology lists master-data entries.
 */
async function archivedCustomerId(world: TestWorld): Promise<string> {
  return surfaceFixture(world, 'acceptance.archived-customer', async () => {
    const actor = world.users.buero.id;
    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId: actor,
      name: worldName('Hausverwaltung Lindenhof GmbH', world.runId),
      contacts: [{ name: 'Erika Musterfrau', phone: '030 1111111', isPrimary: true }],
    });
    const admin = createAdminClient();
    await admin
      .rpc('update_client_master', {
        p_actor_id: actor,
        p_organization_id: world.orgId,
        p_client_id: customer.clientId,
        p_changes: { phone: '030 2222222', client_type: 'gewerblich' },
      })
      .throwOnError();
    await admin
      .rpc('set_client_archived', {
        p_actor_id: actor,
        p_organization_id: world.orgId,
        p_client_id: customer.clientId,
        p_archived: true,
      })
      .throwOnError();
    return customer.clientId;
  });
}

async function archivedCustomer(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/kunden/${await archivedCustomerId(world)}` };
}

async function archivedCustomerList(world: TestWorld): Promise<SurfaceDestination> {
  await archivedCustomerId(world);
  return { route: '/kunden?ansicht=archiviert' };
}

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
 * An open emergency request at a site without a recorded Anlage, owned by the
 * Büro, whose promised callback passed two hours ago. One seed serves the
 * request detail and the Büro's Aufgaben.
 */
async function seedCallbackOverdueRequest(world: TestWorld): Promise<{ requestId: string; summary: string }> {
  const summary = worldName('Kein Warmwasser im Haus 3', world.runId);
  const requestId = await surfaceFixture(world, 'acceptance.callback-overdue-request', async () => {
    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: worldName('Hausverwaltung Lindenhof GmbH', world.runId),
      sites: [{ name: 'Lindenhof 3', street: 'Lindenhof 3', postalCode: '10115', city: 'Berlin' }],
    });
    const siteId = customer.siteIds.get('Lindenhof 3');
    if (!siteId) throw new Error('seedCallbackOverdueRequest: the site was not seeded');
    const id = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary,
      requestNumber: `ANF-${world.runId}-CALL`,
      clientId: customer.clientId,
      siteId,
      urgency: 'notfall',
      assignedTo: world.users.buero.id,
    });
    await createAdminClient()
      .from('client_requests')
      .update({ callback_due_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() })
      .eq('id', id)
      .throwOnError();
    return id;
  });
  return { requestId, summary };
}

async function callbackOverdueRequest(world: TestWorld): Promise<SurfaceDestination> {
  const { requestId, summary } = await seedCallbackOverdueRequest(world);
  return { route: `/anfragen/${requestId}`, heading: summary };
}

async function callbackOverdueTasks(world: TestWorld): Promise<SurfaceDestination> {
  await seedCallbackOverdueRequest(world);
  return { route: '/aufgaben', heading: 'Rückruf überfällig' };
}

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

/** Each record an acceptance capture opens instead of its route's layout record, seeded once per world. */
export const ACCEPTANCE_RECORDS: Record<AcceptanceRecord, (world: TestWorld) => Promise<SurfaceDestination>> =
  {
    'caller-match-request': callerMatchRequest,
    'promoted-caller-request': promotedCallerRequest,
    'office-task-backlog': officeTaskBacklog,
    'archived-customer': archivedCustomer,
    'archived-customer-list': archivedCustomerList,
    'callback-overdue-request': callbackOverdueRequest,
    'callback-overdue-tasks': callbackOverdueTasks,
    'employee-activity-history': employeeActivityHistory,
    'employee-activity-job': employeeActivityJob,
  };
