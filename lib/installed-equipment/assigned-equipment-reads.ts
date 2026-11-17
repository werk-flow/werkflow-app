import 'server-only';

import { logReadErrors, logReadFailure } from '@/lib/data/read-request-cache';
import { compareRecordNumbers } from '@/lib/format/record-number';
import type { ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The field worker's reach to an Anlage (werk-flow/werkflow-planning#468):
// the Anlagen linked to a job they are assigned to, voided ones left out. The
// work pack's Anlagen card (getAssignedEquipmentForJob) and the header search
// (findAssignedEquipment) read through readLinkedEquipment.

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type EquipmentTableRow = Database['public']['Tables']['installed_equipment']['Row'];
type JobStatus = Database['public']['Enums']['job_status'];

const LINKED_EQUIPMENT_COLUMNS =
  'id, equipment_number, name, category, subtype, state, manufacturer, model, location_detail';

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

const matchedIdsSchema = z.array(uuidSchema);

/** Open before finished, then the latest planned day, then the number. */
function jobOrder(
  left: { status: JobStatus; planned_date: string | null; job_number: string | null },
  right: { status: JobStatus; planned_date: string | null; job_number: string | null },
): number {
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
  if (jobs.error) {
    logReadErrors('findAssignedEquipment: jobs read failed', jobs.error);
    throw new Error('installed_equipment_load_failed');
  }
  const projectIds = [...new Set(jobs.data.flatMap((job) => (job.project_id ? [job.project_id] : [])))];
  const projects = await readInBatches(projectIds, (batch) =>
    admin
      .from('projects')
      .select('id, project_number')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (projects.error) {
    logReadErrors('findAssignedEquipment: projects read failed', projects.error);
    throw new Error('installed_equipment_load_failed');
  }
  const projectNumbers = new Map(projects.data.map((project) => [project.id, project.project_number]));
  return jobs.data.toSorted(jobOrder).map(
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
  if (assignments.error) {
    logReadErrors('findAssignedEquipment: job_assignments read failed', assignments.error);
    throw new Error('installed_equipment_load_failed');
  }
  const linked = await readLinkedEquipment(admin, organizationId, [
    ...new Set(assignments.data.map((assignment) => assignment.job_id)),
  ]);
  if (!linked) throw new Error('installed_equipment_load_failed');
  if (linked.equipment.length === 0) return { hits: [], total: 0 };
  const matched = await admin.rpc('match_installed_equipment', {
    p_organization_id: organizationId,
    p_equipment_ids: linked.equipment.map((row) => row.id),
    p_search: query,
  });
  const matchedIds = matchedIdsSchema.safeParse(matched.data);
  if (matched.error || !matchedIds.success) {
    logReadFailure('findAssignedEquipment: match failed', { code: matched.error?.code ?? 'malformed_match' });
    throw new Error('installed_equipment_load_failed');
  }
  const matchedSet = new Set(matchedIds.data);
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
