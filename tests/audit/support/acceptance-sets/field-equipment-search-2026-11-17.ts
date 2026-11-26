import { randomUUID } from 'node:crypto';
import { expect, type Locator } from '@playwright/test';
import { equipmentCreateSchema } from '../../../../lib/installed-equipment/validation';
import { toJson } from '../../../../lib/supabase/json';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { seedCustomer } from '../../../golden/support/db/customers';
import { createAdminClient } from '../../../golden/support/db/shared';
import { seedJob, seedJobAssignment } from '../../../golden/support/db/work';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';

/**
 * The made-up records the captures show. No other set seeds „Birkenhof“, so the
 * hits and the card stay the same whichever sets ran before in the shared world.
 */
const EQUIPMENT = 'Brennwertkessel Birkenhof';
const SOURCE_NUMBER = 'ALT-BH-4711';
const JOB_TITLE = 'Wartung Brennwertkessel Birkenhof';
const seeded = new Map<string, Promise<SurfaceDestination>>();

/** A customer with a site, a job assigned to the employee, and its Anlage with an old number, linked to the job. */
async function seedBirkenhof(world: TestWorld): Promise<SurfaceDestination> {
  const actorId = world.users.admin.id;
  const customer = await seedCustomer({
    orgId: world.orgId,
    actorId,
    name: 'Hausverwaltung Birkenhof GmbH',
    clientType: 'gewerblich',
    sites: [
      {
        name: 'Wohnanlage Birkenhof',
        street: 'Birkenhofweg 7',
        postalCode: '10115',
        city: 'Berlin',
        isPrimary: true,
      },
    ],
  });
  const siteId = customer.siteIds.get('Wohnanlage Birkenhof');
  if (!siteId) throw new Error('The Birkenhof customer has no site.');
  const jobNumber = `AUF-${world.runId}-BIRKENHOF`;
  const jobId = await seedJob({
    orgId: world.orgId,
    actorId,
    jobNumber,
    title: JOB_TITLE,
    clientId: customer.clientId,
    siteId,
  });
  await seedJobAssignment({ orgId: world.orgId, actorId, jobId, userId: world.users.employee.id });
  const payload = equipmentCreateSchema.parse({
    equipmentId: randomUUID(),
    idempotencyKey: randomUUID(),
    clientId: customer.clientId,
    siteId,
    name: EQUIPMENT,
    category: 'heat_generation',
    state: 'active',
    manufacturer: 'Musterwerk Heiztechnik',
    model: 'BK 24',
    sourceNumber: SOURCE_NUMBER,
    identifiers: [],
  });
  const admin = createAdminClient();
  const { data: equipment } = await admin
    .rpc('create_installed_equipment', {
      p_organization_id: world.orgId,
      p_equipment_id: payload.equipmentId,
      p_payload: toJson(payload),
      p_actor_id: actorId,
      p_idempotency_key: payload.idempotencyKey,
    })
    .throwOnError();
  if (!equipment) throw new Error('The Birkenhof Anlage seed returned no record.');
  await admin
    .rpc(
      'set_installed_equipment_work_link',
      rpcArgs('set_installed_equipment_work_link', {
        p_organization_id: world.orgId,
        p_equipment_id: equipment.id,
        p_expected_version: equipment.version,
        p_job_id: jobId,
        p_project_id: null,
        p_linked: true,
        p_reason: 'Anlage für den Wartungsbesuch',
        p_actor_id: actorId,
        p_idempotency_key: randomUUID(),
      }),
    )
    .throwOnError();
  return { route: `/auftraege/${jobNumber}`, heading: JOB_TITLE };
}

/** The Birkenhof job's work pack, seeded once per world. */
function birkenhofJob(world: TestWorld): Promise<SurfaceDestination> {
  const existing = seeded.get(world.runId);
  if (existing) return existing;
  const created = seedBirkenhof(world);
  seeded.set(world.runId, created);
  return created;
}

/** Searches the Anlage by its „Nummer im Altsystem“ and waits for its hit. */
async function searchBirkenhof(layer: Locator, world: TestWorld): Promise<void> {
  await birkenhofJob(world);
  await layer.getByRole('textbox', { name: 'Suchbegriff', exact: true }).fill(SOURCE_NUMBER);
  await expect(
    layer
      .getByRole('region', { name: 'Anlagen', exact: true })
      .getByRole('link', { name: new RegExp(EQUIPMENT) }),
  ).toBeVisible();
}

/**
 * werk-flow/werkflow-planning#493 of 2026-11-17: a field worker's header
 * search names the Anlagen of their jobs in its prompt and finds them, by the
 * old number too; a hit opens the job's work pack at that Anlage, whose card
 * shows the „Nummer im Altsystem“.
 */
function fieldEquipmentSearchCaptures(): OpenSet {
  const fieldSearch = { kind: 'dialog', opener: 'customers.search-field' } as const;
  return {
    id: 'field-equipment-search-2026-11-17',
    captures: [
      {
        id: 'employee-search',
        role: 'employee',
        route: '/dashboard',
        view: fieldSearch,
        widths: [375],
        schemes: ['light', 'dark'],
      },
      {
        id: 'employee-search-hits',
        role: 'employee',
        route: '/dashboard',
        view: fieldSearch,
        widths: [375, 1280],
        schemes: ['light', 'dark'],
        act: searchBirkenhof,
      },
      {
        id: 'employee-anlage-card',
        role: 'employee',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'page' },
        destination: birkenhofJob,
        reveal: `Nummer im Altsystem: ${SOURCE_NUMBER}`,
        widths: [375],
        schemes: ['light', 'dark'],
      },
    ],
    standalone: [],
  };
}

acceptanceSet(fieldEquipmentSearchCaptures());
