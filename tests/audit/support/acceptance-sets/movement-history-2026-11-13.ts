import { createAdminClient } from '../../../golden/support/db/shared';
import { seedJob, seedJobAssignment } from '../../../golden/support/db/work';
import type { TestWorld } from '../../../golden/support/world';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

const JOB_TITLE = 'Heizungstausch Lindenweg';
const seeded = new Map<string, Promise<void>>();

type Written = PromiseLike<{ error: { message: string } | null }>;

/** Throws an error naming the seed step when its write failed. */
async function must(label: string, result: Written): Promise<void> {
  const { error } = await result;
  if (error) throw new Error(`${label}: ${error.message}`);
}

/**
 * A job whose material was taken, used by the field worker, corrected by the
 * office and partly returned: every kind of the history beside the world's
 * opening stock.
 */
async function seedMovementHistory(world: TestWorld): Promise<void> {
  const admin = createAdminClient();
  const actor = world.users.admin.id;
  const jobNumber = `MH-${world.runId}`;
  const jobId = await seedJob({ orgId: world.orgId, actorId: actor, jobNumber, title: JOB_TITLE });
  await seedJobAssignment({ orgId: world.orgId, actorId: actor, jobId, userId: world.users.employee.id });
  const { data: line, error } = await admin
    .from('job_material_lines')
    .insert({
      organization_id: world.orgId,
      job_id: jobId,
      item_id: world.inventory.itemId,
      planned_quantity: 4,
      preferred_location_id: world.inventory.locationId,
      created_by: actor,
    })
    .select('id')
    .single();
  if (error || !line) throw new Error(`material line: ${error?.message ?? 'no row'}`);
  const move = (type: string, delta: number, reason: string | null) =>
    must(
      `${type} ${delta}`,
      admin.rpc('record_inventory_movement', {
        p_organization_id: world.orgId,
        p_actor_id: actor,
        p_item_id: world.inventory.itemId,
        p_location_id: world.inventory.locationId,
        p_movement_type: type,
        p_quantity_delta: delta,
        p_job_id: jobId,
        p_job_material_line_id: line.id,
        ...(reason ? { p_reason: reason } : {}),
      }),
    );
  await move('job_take', -4, null);
  await must(
    'use',
    admin.rpc('record_job_material_use', {
      p_organization_id: world.orgId,
      p_actor_id: world.users.employee.id,
      p_job_material_line_id: line.id,
      p_quantity: 3,
    }),
  );
  const { data: useEvent, error: eventError } = await admin
    .from('job_material_use_events')
    .select('id')
    .eq('job_material_line_id', line.id)
    .single();
  if (eventError || !useEvent) throw new Error(`use event: ${eventError?.message ?? 'no row'}`);
  await must(
    'correction',
    admin.rpc('record_job_material_use', {
      p_organization_id: world.orgId,
      p_actor_id: actor,
      p_job_material_line_id: line.id,
      p_quantity: -1,
      p_note: 'Ein Rohrstück lag noch im Auto',
      p_corrects_event_id: useEvent.id,
    }),
  );
  await move('job_return', 2, 'Rest zurück ins Lager');
}

function movementHistory(world: TestWorld, query: string): Promise<SurfaceDestination> {
  const existing = seeded.get(world.runId) ?? seedMovementHistory(world);
  seeded.set(world.runId, existing);
  return existing.then(() => ({ route: `/inventar?${query}`, heading: 'Inventar' }));
}

/**
 * werk-flow/werkflow-planning#374 of 2026-11-13: the paged movement history of
 * `/inventar` with every kind, filtered to the uses, and a search without a
 * match, for the office.
 */
function movementHistoryCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'movement-history-2026-11-13',
    captures: [
      {
        id: 'buero-bewegungen',
        role: 'buero',
        route: '/inventar',
        view: { kind: 'page' },
        destination: (world) => movementHistory(world, 'tab=movements'),
        ...both,
      },
      {
        id: 'admin-bewegungen-verbraucht',
        role: 'admin',
        route: '/inventar',
        view: { kind: 'page' },
        destination: (world) => movementHistory(world, 'tab=movements&kind=job_use'),
        ...both,
      },
      {
        id: 'admin-bewegungen-ohne-treffer',
        role: 'admin',
        route: '/inventar',
        view: { kind: 'page' },
        destination: (world) => movementHistory(world, 'tab=movements&search=Gasbrennwert'),
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(movementHistoryCaptures());
