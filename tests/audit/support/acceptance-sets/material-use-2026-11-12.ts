import { createAdminClient } from '../../../golden/support/db/shared';
import { seedJob, seedJobAssignment } from '../../../golden/support/db/work';
import type { TestWorld } from '../../../golden/support/world';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

const JOB_TITLE = 'Bad Musterstraße: Vorwand und Verrohrung';
const seeded = new Map<string, Promise<SurfaceDestination>>();

type Written = PromiseLike<{ error: { message: string } | null }>;

/** Throws an error naming the seed step when its write failed. */
async function must(label: string, result: Written): Promise<void> {
  const { error } = await result;
  if (error) throw new Error(`${label}: ${error.message}`);
}

/** The id of the inserted row, or a thrown error naming the seed step. */
async function insertedId(
  label: string,
  result: PromiseLike<{ data: { id: string } | null; error: { message: string } | null }>,
): Promise<string> {
  const { data, error } = await result;
  if (error || !data) throw new Error(`${label}: ${error?.message ?? 'no row'}`);
  return data.id;
}

/**
 * An assigned job with two material lines: one taken only, before a use, and
 * one taken, partly used and partly returned, after a use.
 */
async function seedMaterialUseJob(world: TestWorld): Promise<SurfaceDestination> {
  const admin = createAdminClient();
  const actor = world.users.admin.id;
  const jobNumber = `MU-${world.runId}`;
  const jobId = await seedJob({ orgId: world.orgId, actorId: actor, jobNumber, title: JOB_TITLE });
  await seedJobAssignment({ orgId: world.orgId, actorId: actor, jobId, userId: world.users.employee.id });
  const fitting = await insertedId(
    'fitting item',
    admin
      .from('inventory_items')
      .insert({
        organization_id: world.orgId,
        name: 'Pressfitting 15 mm (Abnahme)',
        item_type: 'material',
        unit: 'piece',
        created_by: actor,
      })
      .select('id')
      .single(),
  );
  const move = (itemId: string, type: string, delta: number, lineId: string | null) =>
    must(
      `${type} ${delta}`,
      admin.rpc('record_inventory_movement', {
        p_organization_id: world.orgId,
        p_actor_id: actor,
        p_item_id: itemId,
        p_location_id: world.inventory.locationId,
        p_movement_type: type,
        p_quantity_delta: delta,
        ...(lineId ? { p_job_id: jobId, p_job_material_line_id: lineId } : {}),
      }),
    );
  await move(fitting, 'initial_count', 10, null);
  const line = (itemId: string, planned: number) =>
    insertedId(
      'material line',
      admin
        .from('job_material_lines')
        .insert({
          organization_id: world.orgId,
          job_id: jobId,
          item_id: itemId,
          planned_quantity: planned,
          preferred_location_id: world.inventory.locationId,
          created_by: actor,
        })
        .select('id')
        .single(),
    );
  const used = await line(world.inventory.itemId, 5);
  const takenOnly = await line(fitting, 4);
  await move(world.inventory.itemId, 'job_take', -5, used);
  await must(
    'use',
    admin.rpc('record_job_material_use', {
      p_organization_id: world.orgId,
      p_actor_id: world.users.employee.id,
      p_job_material_line_id: used,
      p_quantity: 3,
    }),
  );
  await move(world.inventory.itemId, 'job_return', 1, used);
  await move(fitting, 'job_take', -4, takenOnly);
  return { route: `/auftraege/${jobNumber}`, heading: JOB_TITLE };
}

function materialUseJob(world: TestWorld): Promise<SurfaceDestination> {
  const existing = seeded.get(world.runId);
  if (existing) return existing;
  const created = seedMaterialUseJob(world);
  seeded.set(world.runId, created);
  return created;
}

/**
 * werk-flow/werkflow-planning#370 of 2026-11-12: the job's material with a
 * line before a use („Verbraucht“ offered) and one after it (taken, used,
 * returned and still open in one line), for the field worker and the office.
 */
function materialUseCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'material-use-2026-11-12',
    captures: [
      {
        id: 'employee-auftrag-material',
        role: 'employee',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'page' },
        destination: materialUseJob,
        reveal: 'Pressfitting 15 mm (Abnahme)',
        ...both,
      },
      {
        id: 'buero-auftrag-material',
        role: 'buero',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'page' },
        destination: materialUseJob,
        reveal: 'Pressfitting 15 mm (Abnahme)',
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(materialUseCaptures());
