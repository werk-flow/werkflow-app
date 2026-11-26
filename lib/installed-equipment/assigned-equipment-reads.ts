import 'server-only';

import { logReadErrors, logReadFailure } from '@/lib/data/read-request-cache';
import { compareRecordNumbers } from '@/lib/format/record-number';
import type { ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { Constants, type Database } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The field worker's reach to an Anlage (werk-flow/werkflow-planning#468):
// the Anlagen linked to a job they are assigned to, voided ones left out. The
// work pack's Anlagen card (getAssignedEquipmentForJob) and the header search
// (findAssignedEquipment) read through readLinkedEquipment.

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type EquipmentTableRow = Database['public']['Tables']['installed_equipment']['Row'];

const LINKED_EQUIPMENT_COLUMNS =
  'id, equipment_number, name, category, subtype, state, manufacturer, model, location_detail, source_number';

type LinkedEquipmentRow = Pick<
  EquipmentTableRow,
  | 'id'
  | 'equipment_number'
  | 'name'
  | 'category'
  | 'subtype'
  | 'state'
  | 'manufacturer'
  | 'model'
  | 'location_detail'
  | 'source_number'
>;

type LinkedEquipment = {
  /** The links of live Anlagen only. */
  links: Array<{ job_id: string; equipment_id: string }>;
  equipment: LinkedEquipmentRow[];
};

/**
 * The live Anlagen linked to these jobs of the organization, with their links.
 * The caller has checked that it may read each job. Null when a read failed,
 * which the caller shows as a load failure, never as an empty card.
 */
export async function readLinkedEquipment(
  admin: AdminClient,
  organizationId: string,
  jobIds: readonly string[],
): Promise<LinkedEquipment | null> {
  const links = await readInBatches(jobIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        admin
          .from('installed_equipment_work_links')
          .select('id, job_id, equipment_id')
          .eq('organization_id', organizationId)
          .in('job_id', [...batch])
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  );
  if (links.error) {
    logReadErrors('readLinkedEquipment: installed_equipment_work_links read failed', links.error);
    return null;
  }
  const jobLinks = links.data.flatMap((link) =>
    link.job_id ? [{ job_id: link.job_id, equipment_id: link.equipment_id }] : [],
  );
  const equipment = await readInBatches([...new Set(jobLinks.map((link) => link.equipment_id))], (batch) =>
    admin
      .from('installed_equipment')
      .select(LINKED_EQUIPMENT_COLUMNS)
      .eq('organization_id', organizationId)
      .is('voided_at', null)
      .in('id', [...batch]),
  );
  if (equipment.error) {
    logReadErrors('readLinkedEquipment: installed_equipment read failed', equipment.error);
    return null;
  }
  const live = new Set(equipment.data.map((row) => row.id));
  return { links: jobLinks.filter((link) => live.has(link.equipment_id)), equipment: equipment.data };
}

type HitJob = {
  id: string;
  jobNumber: string | null;
  project: { id: string; projectNumber: string | null } | null;
};

export type AssignedEquipmentHit = {
  id: string;
  equipmentNumber: string;
  name: string;
  /** The assigned job whose work pack shows the Anlage: an open one before a finished one, then the latest planned. */
  job: HitJob;
};

// The rows this search reads, parsed at the boundary; a malformed one is a load failure.
const matchedIdsSchema = z.array(uuidSchema);
const assignmentRowsSchema = z.array(z.object({ job_id: uuidSchema }));
const hitJobRowsSchema = z.array(
  z.object({
    id: uuidSchema,
    job_number: z.string().nullable(),
    project_id: uuidSchema.nullable(),
    status: z.enum(Constants.public.Enums.job_status),
    planned_date: z.string().nullable(),
  }),
);
type HitJobRow = z.infer<typeof hitJobRowsSchema>[number];
const hitProjectRowsSchema = z.array(z.object({ id: uuidSchema, project_number: z.string().nullable() }));

/** Open before finished, then the latest planned day, then the number. */
function jobOrder(left: HitJobRow, right: HitJobRow): number {
  const finished = Number(left.status === 'fertig') - Number(right.status === 'fertig');
  if (finished !== 0) return finished;
  const planned = (right.planned_date ?? '').localeCompare(left.planned_date ?? '');
  if (planned !== 0) return planned;
  return compareRecordNumbers(left.job_number ?? '', right.job_number ?? '');
}

/** The assigned jobs of the caller and the projects that hold them; throws when a read fails. */
async function readHitJobs(admin: AdminClient, organizationId: string, jobIds: string[]) {
  const jobs = await readInBatches(jobIds, (batch) =>
    admin
      .from('jobs')
      .select('id, job_number, project_id, status, planned_date')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  const jobRows = hitJobRowsSchema.safeParse(jobs.data);
  if (jobs.error || !jobRows.success) {
    logReadFailure('findAssignedEquipment: jobs read failed', { code: jobs.error?.code ?? 'malformed_jobs' });
    throw new Error('installed_equipment_load_failed');
  }
  const projectIds = [...new Set(jobRows.data.flatMap((job) => (job.project_id ? [job.project_id] : [])))];
  const projects = await readInBatches(projectIds, (batch) =>
    admin
      .from('projects')
      .select('id, project_number')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  const projectRows = hitProjectRowsSchema.safeParse(projects.data);
  if (projects.error || !projectRows.success) {
    logReadFailure('findAssignedEquipment: projects read failed', {
      code: projects.error?.code ?? 'malformed_projects',
    });
    throw new Error('installed_equipment_load_failed');
  }
  const projectNumbers = new Map(projectRows.data.map((project) => [project.id, project.project_number]));
  return jobRows.data.toSorted(jobOrder).map(
    (job): HitJob => ({
      id: job.id,
      jobNumber: job.job_number,
      project: job.project_id
        ? { id: job.project_id, projectNumber: projectNumbers.get(job.project_id) ?? null }
        : null,
    }),
  );
}

/**
 * The ids among these Anlagen that match the search, by the Anlagen list's rule
 * (`public.match_installed_equipment`), one call per id batch. Throws when a
 * batch fails or answers malformed: a partial match would hide hits.
 */
async function matchEquipment(
  admin: AdminClient,
  organizationId: string,
  equipmentIds: readonly string[],
  query: string,
): Promise<Set<string>> {
  const matched = await readInBatches(equipmentIds, async (batch) => {
    const result = await admin.rpc('match_installed_equipment', {
      p_organization_id: organizationId,
      p_equipment_ids: [...batch],
      p_search: query,
    });
    const ids = matchedIdsSchema.safeParse(result.data);
    if (result.error || !ids.success)
      return {
        data: null,
        error: { message: 'match failed', code: result.error?.code ?? 'malformed_match' },
      };
    return { data: ids.data, error: null };
  });
  if (matched.error) {
    logReadFailure('findAssignedEquipment: match failed', { code: matched.error.code });
    throw new Error('installed_equipment_load_failed');
  }
  return new Set(matched.data);
}

/**
 * The header search of a field worker: the Anlagen of the jobs they are
 * assigned to that match the query, by the equipment list's own rule
 * (`public.match_installed_equipment`), sorted by number. Each hit names the
 * job that opens it. Throws when a read fails; the search shows that failure.
 */
export async function findAssignedEquipment(
  context: ActionContext,
  query: string,
  limit: number,
): Promise<{ hits: AssignedEquipmentHit[]; total: number }> {
  const admin = createSupabaseAdminClient();
  const organizationId = context.orgId;
  const assignments = await readCompleteRows(
    (from, to) =>
      admin
        .from('job_assignments')
        .select('id, job_id')
        .eq('organization_id', organizationId)
        .eq('user_id', context.userId)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  const assignmentRows = assignmentRowsSchema.safeParse(assignments.data);
  if (assignments.error || !assignmentRows.success) {
    logReadFailure('findAssignedEquipment: job_assignments read failed', {
      code: assignments.error?.code ?? 'malformed_assignments',
    });
    throw new Error('installed_equipment_load_failed');
  }
  const linked = await readLinkedEquipment(admin, organizationId, [
    ...new Set(assignmentRows.data.map((assignment) => assignment.job_id)),
  ]);
  if (!linked) throw new Error('installed_equipment_load_failed');
  if (linked.equipment.length === 0) return { hits: [], total: 0 };
  const matchedSet = await matchEquipment(
    admin,
    organizationId,
    linked.equipment.map((row) => row.id),
    query,
  );
  const matches = linked.equipment
    .filter((row) => matchedSet.has(row.id))
    .toSorted((left, right) => compareRecordNumbers(left.equipment_number, right.equipment_number));
  const shown = matches.slice(0, limit);
  const shownIds = new Set(shown.map((row) => row.id));
  const jobs = await readHitJobs(admin, organizationId, [
    ...new Set(linked.links.filter((link) => shownIds.has(link.equipment_id)).map((link) => link.job_id)),
  ]);
  const hits = shown.flatMap((row): AssignedEquipmentHit[] => {
    const jobIds = new Set(
      linked.links.filter((link) => link.equipment_id === row.id).map((link) => link.job_id),
    );
    const job = jobs.find((candidate) => jobIds.has(candidate.id));
    return job ? [{ id: row.id, equipmentNumber: row.equipment_number, name: row.name, job }] : [];
  });
  return { hits, total: matches.length };
}
