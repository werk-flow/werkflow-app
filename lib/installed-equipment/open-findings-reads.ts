import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logReadErrors, loggedRead } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { MAINTENANCE_NEXT_ACTIONS, MAINTENANCE_SCOPE_OUTCOMES } from '@/lib/maintenance/types';
import { readProfileReferences } from '@/lib/profile-reference';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The Mängel of an Anlage that no later completed visit closed yet
// (werk-flow/werkflow-planning#484). `list_open_maintenance_visit_findings`
// owns what is open, across the Anlage's Vorgänger; the completion closes
// exactly what it lists. The office reads the next step and its owner here;
// the technician's field history reads only the Mängel.

type Enums = Database['public']['Enums'];

// The generated return type marks every column non-null; the rows are parsed.
const openFindingRowsSchema = z.array(
  z.object({
    finding_id: z.string(),
    maintenance_due_work_id: z.string(),
    completed_on: z.string(),
    scope_outcome: z.enum(MAINTENANCE_SCOPE_OUTCOMES),
    plan_number: z.string(),
    job_id: z.string().nullable(),
    defects: z.array(z.string()),
    next_action: z.enum(MAINTENANCE_NEXT_ACTIONS),
    owner_user_id: z.string().nullable(),
    target_date: z.string().nullable(),
    note: z.string().nullable(),
  }),
);
type OpenFindingRow = z.infer<typeof openFindingRowsSchema>[number];

/** One visit's open Mängel with the office's next step. */
export type EquipmentOpenFinding = {
  id: string;
  /** The Berlin day the visit was completed. */
  visitDate: string;
  outcome: Enums['maintenance_scope_outcome'];
  planNumber: string;
  job: { label: string; href: string } | null;
  defects: string[];
  nextAction: Enums['maintenance_next_action'];
  ownerName: string | null;
  targetDate: string | null;
  /** Why no next step follows (`none` only). */
  note: string | null;
};

export const equipmentOpenFindingsInputSchema = z.object({ equipmentId: uuidSchema });

/** The open findings of the Anlage and its Vorgänger, newest visit first; throws after logging when the read fails. */
export async function readOpenFindingRows(
  admin: AdminClient,
  organizationId: string,
  equipmentId: string,
): Promise<OpenFindingRow[]> {
  const { data, error } = await readCompleteRows(
    (from, to) =>
      admin
        .rpc('list_open_maintenance_visit_findings', {
          p_organization_id: organizationId,
          p_equipment_ids: [equipmentId],
        })
        .range(from, to),
    LIST_ROW_CAP,
  );
  const parsed = openFindingRowsSchema.safeParse(data);
  if (error || !parsed.success) {
    logReadErrors('readOpenFindingRows: read failed', error ?? { code: 'unexpected_row_shape' });
    throw new Error('installed_equipment_load_failed');
  }
  return parsed.data;
}

/** The labels of the visit jobs and the owners' names; throws after logging when a read fails. */
async function readFindingLabels(admin: AdminClient, organizationId: string, rows: OpenFindingRow[]) {
  const jobIds = [...new Set(rows.flatMap((row) => (row.job_id ? [row.job_id] : [])))];
  const ownerIds = [...new Set(rows.flatMap((row) => (row.owner_user_id ? [row.owner_user_id] : [])))];
  const [jobs, owners] = await Promise.all([
    readInBatches(jobIds, (batch) =>
      admin
        .from('jobs')
        .select('id, job_number, title')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readProfileReferences(admin, organizationId, ownerIds),
  ]);
  const labelError = jobs.error ?? owners.error;
  if (labelError) {
    logReadErrors('getEquipmentOpenFindings: label read failed', labelError);
    throw new Error('installed_equipment_load_failed');
  }
  return {
    jobs: new Map(jobs.data.map((job) => [job.id, job])),
    owners: owners.data,
  };
}

/**
 * The open Mängel of one Anlage of the caller's organization, with the next
 * step and its owner. Admin and Büro only.
 */
export async function getEquipmentOpenFindings(
  rawInput: z.input<typeof equipmentOpenFindingsInputSchema>,
): Promise<ActionResult<{ findings: EquipmentOpenFinding[] }>> {
  const parsed = equipmentOpenFindingsInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'not_authorized' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const organizationId = auth.context.orgId;
  const admin = createSupabaseAdminClient();
  const equipment = await loggedRead(
    'getEquipmentOpenFindings: installed_equipment read failed',
    admin
      .from('installed_equipment')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', parsed.data.equipmentId)
      .maybeSingle(),
  );
  if (equipment.error) return { success: false, error: 'installed_equipment_load_failed' };
  if (!equipment.data) return { success: false, error: 'not_authorized' };
  try {
    const rows = await readOpenFindingRows(admin, organizationId, equipment.data.id);
    const { jobs, owners } = await readFindingLabels(admin, organizationId, rows);
    return {
      success: true,
      findings: rows.map((row) => {
        const job = row.job_id ? jobs.get(row.job_id) : undefined;
        const owner = row.owner_user_id ? owners.get(row.owner_user_id) : undefined;
        return {
          id: row.finding_id,
          visitDate: row.completed_on,
          outcome: row.scope_outcome,
          planNumber: row.plan_number,
          job: job
            ? {
                label: `Auftrag ${job.job_number ?? job.title}`,
                href: `/auftraege/${encodeURIComponent(job.job_number ?? job.id)}`,
              }
            : null,
          defects: row.defects,
          nextAction: row.next_action,
          ownerName: owner
            ? [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.email || 'Unbekannt'
            : null,
          targetDate: row.target_date,
          note: row.note,
        };
      }),
    };
  } catch {
    return { success: false, error: 'installed_equipment_load_failed' };
  }
}
