import { randomUUID } from 'node:crypto';
import { worldName } from '../../../lib/testing/seed-world-plan';
import { berlinDateAtOffset } from '../../golden/support/date-ownership';
import { seedCustomer } from '../../golden/support/db/customers';
import { seedRequest } from '../../golden/support/db/requests';
import {
  seedInstalledEquipment,
  seedServiceCase,
  seedServiceCaseJobLink,
} from '../../golden/support/db/service';
import { seedJob, seedJobAssignment, seedProject } from '../../golden/support/db/work';
import { rpcArgs } from '../../../lib/supabase/rpc-args';
import { createAdminClient } from '../../golden/support/db/shared';
import type { TestWorld } from '../../golden/support/world';
import type { AcceptanceRecord } from './acceptance-sets';
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

type ManagedBuildings = { managerId: string; ownerId: string; sourcePrefix: string };

/**
 * A Hausverwaltung managing two buildings of other customers: a WEG's house
 * with two tenants and an Anlage, which it took over from a former
 * Hausverwaltung and receives the invoices for, and a private owner's house
 * with an access contact. Every write goes through the functions the
 * actions call, so the history shows them.
 */
async function managedBuildings(world: TestWorld): Promise<ManagedBuildings> {
  const sourcePrefix = `OBJ-${world.runId.slice(0, 6)}`;
  const json = await surfaceFixture(world, 'acceptance.managed-buildings', async () => {
    const orgId = world.orgId;
    const actor = world.users.buero.id;
    const admin = createAdminClient();
    const manager = await seedCustomer({
      orgId,
      actorId: actor,
      clientType: 'gewerblich',
      name: worldName('Hausverwaltung Lindenhof GmbH', world.runId),
      contacts: [
        { name: 'Erika Musterfrau', role: 'Objektbetreuung', phone: '030 1111111', isPrimary: true },
      ],
    });
    const former = await seedCustomer({
      orgId,
      actorId: actor,
      clientType: 'gewerblich',
      name: worldName('Hausverwaltung Birkenhain GmbH', world.runId),
    });
    const owner = await seedCustomer({
      orgId,
      actorId: actor,
      clientType: 'gewerblich',
      name: worldName('WEG Lindenstraße 5', world.runId),
      contacts: [
        { name: 'Max Mustermann', phone: '0171 2222222' },
        { name: 'Lena Beispiel', phone: '0171 3333333' },
      ],
      sites: [
        {
          name: 'Haus Lindenstraße 5',
          street: 'Lindenstraße 5',
          postalCode: '10115',
          city: 'Berlin',
          isPrimary: true,
        },
      ],
    });
    const privateOwner = await seedCustomer({
      orgId,
      actorId: actor,
      name: worldName('Jonas Beispielmann', world.runId),
      contacts: [{ name: 'Petra Zugang', phone: '0171 4444444' }],
      sites: [
        {
          name: 'Mehrfamilienhaus Birkenweg 2',
          street: 'Birkenweg 2',
          postalCode: '10117',
          city: 'Berlin',
          isPrimary: true,
        },
      ],
    });
    const ownerSite = owner.siteIds.get('Haus Lindenstraße 5');
    const privateSite = privateOwner.siteIds.get('Mehrfamilienhaus Birkenweg 2');
    if (!ownerSite || !privateSite) throw new Error('managedBuildings: a seeded site is missing.');

    const site = async (siteId: string, sourceNumber: string): Promise<void> => {
      await admin
        .rpc('update_client_site', {
          p_actor_id: actor,
          p_organization_id: orgId,
          p_site_id: siteId,
          p_changes: { source_number: sourceNumber },
        })
        .throwOnError();
    };
    await site(ownerSite, `${sourcePrefix}-1`);
    await site(privateSite, `${sourcePrefix}-2`);
    const link = async (
      contacts: ReadonlyMap<string, string>,
      name: string,
      siteId: string,
      siteRole: 'mieter' | 'zugangskontakt',
    ): Promise<void> => {
      const contactId = contacts.get(name);
      if (!contactId) throw new Error(`managedBuildings: contact ${name} is missing.`);
      await admin
        .rpc('update_client_contact', {
          p_actor_id: actor,
          p_organization_id: orgId,
          p_contact_id: contactId,
          p_changes: { site_id: siteId, site_role: siteRole },
        })
        .throwOnError();
    };
    await link(owner.contactIds, 'Max Mustermann', ownerSite, 'mieter');
    await link(owner.contactIds, 'Lena Beispiel', ownerSite, 'mieter');
    await link(privateOwner.contactIds, 'Petra Zugang', privateSite, 'zugangskontakt');

    const role = async (
      siteId: string,
      kind: 'eigentuemer' | 'hausverwaltung' | 'rechnungsempfaenger',
      holderId: string,
      startsOn: string | null,
      replace = false,
    ): Promise<void> => {
      await admin
        .rpc('assign_client_site_role', {
          p_actor_id: actor,
          p_organization_id: orgId,
          p_site_id: siteId,
          p_role: kind,
          p_holder_client_id: holderId,
          p_replace: replace,
          ...(startsOn ? { p_starts_on: startsOn } : {}),
        })
        .throwOnError();
    };
    await role(ownerSite, 'eigentuemer', owner.clientId, null);
    await role(ownerSite, 'hausverwaltung', former.clientId, '2019-01-01');
    await role(ownerSite, 'hausverwaltung', manager.clientId, '2025-01-01', true);
    await role(ownerSite, 'rechnungsempfaenger', manager.clientId, '2025-01-01');
    await role(privateSite, 'eigentuemer', privateOwner.clientId, null);
    await role(privateSite, 'hausverwaltung', manager.clientId, '2023-07-01');
    await seedInstalledEquipment({
      orgId,
      actorId: actor,
      clientId: owner.clientId,
      siteId: ownerSite,
      name: 'Gasbrennwerttherme Keller',
    });
    return JSON.stringify({ managerId: manager.clientId, ownerId: owner.clientId });
  });
  const ids: unknown = JSON.parse(json);
  if (
    typeof ids !== 'object' ||
    ids === null ||
    !('managerId' in ids) ||
    !('ownerId' in ids) ||
    typeof ids.managerId !== 'string' ||
    typeof ids.ownerId !== 'string'
  )
    throw new Error('managedBuildings: the fixture returned no customer ids.');
  return { managerId: ids.managerId, ownerId: ids.ownerId, sourcePrefix };
}

async function managingCustomer(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/kunden/${(await managedBuildings(world)).managerId}` };
}

async function managedBuilding(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/kunden/${(await managedBuildings(world)).ownerId}` };
}

async function managedBuildingSearch(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/kunden?q=${encodeURIComponent((await managedBuildings(world)).sourcePrefix)}` };
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

/**
 * A Hausverwaltung with two sites and an open request at Lindenhof 1. Unless
 * `none`, the customer has an open job at that site, and an open job and a
 * project at Lindenhof 7, so the attach dialog lists the request's site
 * first. `attached` seeds its own customer, work and request, so attaching
 * that request leaves the open request of `work` open in the same world.
 */
async function seedAttachableRequest(
  world: TestWorld,
  variant: 'work' | 'none' | 'attached',
): Promise<{ requestId: string; summary: string; jobNumber: string; jobTitle: string }> {
  const suffix = variant.toUpperCase();
  const withWork = variant !== 'none';
  const summary = worldName(
    withWork ? 'Heizkörper im Bad wird nicht warm' : 'Wasserhahn tropft',
    world.runId,
  );
  const jobNumber = `A-${world.runId}-${suffix}`;
  const jobTitle = worldName('Heizungswartung Lindenhof 1', world.runId);
  const requestId = await surfaceFixture(world, `acceptance.attachable-request-${suffix}`, async () => {
    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: worldName(withWork ? 'Hausverwaltung Lindenhof GmbH' : 'Erika Musterfrau', world.runId),
      sites: [
        { name: 'Lindenhof 1', street: 'Lindenstraße 1', postalCode: '10115', city: 'Berlin' },
        { name: 'Lindenhof 7', street: 'Lindenstraße 7', postalCode: '10115', city: 'Berlin' },
      ],
    });
    const siteId = customer.siteIds.get('Lindenhof 1');
    const otherSiteId = customer.siteIds.get('Lindenhof 7');
    if (!siteId || !otherSiteId) throw new Error('seedAttachableRequest: the sites were not seeded');
    if (withWork) {
      const owner = { orgId: world.orgId, actorId: world.users.admin.id, clientId: customer.clientId };
      await seedJob({ ...owner, jobNumber, title: jobTitle, siteId });
      await seedJob({
        ...owner,
        jobNumber: `A-${world.runId}-${suffix}-STRANG`,
        title: worldName('Strangsanierung Lindenhof 7', world.runId),
        siteId: otherSiteId,
      });
      await seedProject({
        ...owner,
        projectNumber: `P-${world.runId}-${suffix}-BAD`,
        name: worldName('Badsanierung Lindenhof 7', world.runId),
        siteId: otherSiteId,
      });
    }
    return seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary,
      details: 'Seit gestern Abend, Wohnung 3 links. Die Mieterin ist ab 16 Uhr zu Hause.',
      requestNumber: `ANF-${world.runId}-${suffix}`,
      clientId: customer.clientId,
      siteId,
    });
  });
  return { requestId, summary, jobNumber, jobTitle };
}

async function attachableRequest(world: TestWorld): Promise<SurfaceDestination> {
  const { requestId, summary } = await seedAttachableRequest(world, 'work');
  return { route: `/anfragen/${requestId}`, heading: summary };
}

async function requestWithoutOpenWork(world: TestWorld): Promise<SurfaceDestination> {
  const { requestId, summary } = await seedAttachableRequest(world, 'none');
  return { route: `/anfragen/${requestId}`, heading: summary };
}

/** A request of its own, added by the Büro to the open job at its site. */
async function seedAttachedRequest(
  world: TestWorld,
): Promise<{ requestId: string; summary: string; jobNumber: string; jobTitle: string }> {
  const seeded = await seedAttachableRequest(world, 'attached');
  await surfaceFixture(world, 'acceptance.attached-request', async () => {
    const admin = createAdminClient();
    const { data: job } = await admin
      .from('jobs')
      .select('id')
      .eq('organization_id', world.orgId)
      .eq('job_number', seeded.jobNumber)
      .single()
      .throwOnError();
    await admin
      .rpc(
        'attach_client_request_to_work',
        rpcArgs('attach_client_request_to_work', {
          p_organization_id: world.orgId,
          p_actor_id: world.users.buero.id,
          p_request_id: seeded.requestId,
          p_job_id: job.id,
          p_project_id: null,
          p_service_case_id: null,
          p_attempt_key: randomUUID(),
        }),
      )
      .throwOnError();
    return job.id;
  });
  return seeded;
}

async function attachedRequest(world: TestWorld): Promise<SurfaceDestination> {
  const { requestId, summary } = await seedAttachedRequest(world);
  return { route: `/anfragen/${requestId}`, heading: summary };
}

async function jobWithAttachedRequest(world: TestWorld): Promise<SurfaceDestination> {
  const { jobNumber, jobTitle } = await seedAttachedRequest(world);
  return { route: `/auftraege/${encodeURIComponent(jobNumber)}`, heading: jobTitle };
}

/**
 * A job and a Servicefall at the WEG's house, whose Rechnungsempfänger role
 * the Hausverwaltung holds, with an access contact at the house. The job is
 * the employee's and linked to the Servicefall, so its work pack shows what a
 * field worker sees of the same work.
 */
async function seedBilledWork(world: TestWorld): Promise<{ jobNumber: string; caseNumber: string }> {
  const { ownerId } = await managedBuildings(world);
  const jobNumber = `A-${world.runId}-RECHNUNG`;
  const caseNumber = await surfaceFixture(world, 'acceptance.billed-work', async () => {
    const orgId = world.orgId;
    const actorId = world.users.buero.id;
    const admin = createAdminClient();
    const { data: site } = await admin
      .from('client_sites')
      .select('id')
      .eq('organization_id', orgId)
      .eq('client_id', ownerId)
      .single()
      .throwOnError();
    await admin
      .from('client_contacts')
      .insert({
        organization_id: orgId,
        client_id: ownerId,
        name: 'Karl Hausmeister',
        phone: '0171 5555555',
        site_id: site.id,
        site_role: 'zugangskontakt',
      })
      .throwOnError();
    const jobId = await seedJob({
      orgId,
      actorId,
      jobNumber,
      title: worldName('Heizung entlüften Lindenstraße 5', world.runId),
      clientId: ownerId,
      siteId: site.id,
    });
    await seedJobAssignment({ orgId, actorId, jobId, userId: world.users.employee.id });
    const serviceCase = await seedServiceCase({
      orgId,
      actorId,
      clientId: ownerId,
      siteId: site.id,
      summary: worldName('Therme im Keller tropft', world.runId),
      statement: 'Unter der Therme steht Wasser.',
    });
    await seedServiceCaseJobLink({ orgId, actorId, serviceCaseId: serviceCase.id, jobId });
    return serviceCase.caseNumber;
  });
  return { jobNumber, caseNumber };
}

async function billedJob(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/auftraege/${encodeURIComponent((await seedBilledWork(world)).jobNumber)}` };
}

async function billedServiceCase(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/service/faelle/${encodeURIComponent((await seedBilledWork(world)).caseNumber)}` };
}

/** Each record an acceptance capture opens instead of its route's layout record, seeded once per world. */
export const ACCEPTANCE_RECORDS: Record<AcceptanceRecord, (world: TestWorld) => Promise<SurfaceDestination>> =
  {
    'caller-match-request': callerMatchRequest,
    'promoted-caller-request': promotedCallerRequest,
    'office-task-backlog': officeTaskBacklog,
    'archived-customer': archivedCustomer,
    'archived-customer-list': archivedCustomerList,
    'managing-customer': managingCustomer,
    'managed-building': managedBuilding,
    'managed-building-search': managedBuildingSearch,
    'callback-overdue-request': callbackOverdueRequest,
    'callback-overdue-tasks': callbackOverdueTasks,
    'attachable-request': attachableRequest,
    'request-without-open-work': requestWithoutOpenWork,
    'attached-request': attachedRequest,
    'job-with-attached-request': jobWithAttachedRequest,
    'billed-job': billedJob,
    'billed-service-case': billedServiceCase,
  };
