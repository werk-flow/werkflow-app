import 'server-only';

import { logReadFailure } from '@/lib/data/read-request-cache';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type { AuthorizedDocumentContext } from './access';
import type { DocumentLinkRow, DocumentRow } from './types';

// The field worker's way to a document through an Anlage of their job
// (werk-flow/werkflow-planning#468). `app_private.can_access_document` holds
// the same rule for Realtime; change both together.

/** Financial papers: an Anlage never opens them to the field. */
const FIELD_CLOSED_CATEGORIES: ReadonlySet<string> = new Set(['invoice', 'offer', 'contract']);

/**
 * Whether an ordinary document may open to the technician of a job through an
 * Anlage of that job: no financial paper (by category or retention class) and
 * no office-only link to a request, a coverage or an employee. The caller has
 * already ruled out a protected personnel file. `app_private.can_access_document`
 * holds the same rule for Realtime.
 */
export function isFieldEquipmentDocument(
  document: Pick<DocumentRow, 'category' | 'retention_class'>,
  links: ReadonlyArray<Pick<DocumentLinkRow, 'request_id' | 'maintenance_coverage_id' | 'employee_id'>>,
): boolean {
  return (
    !FIELD_CLOSED_CATEGORIES.has(document.category) &&
    document.retention_class === null &&
    links.every(
      (link) =>
        link.request_id === null && link.maintenance_coverage_id === null && link.employee_id === null,
    )
  );
}

/**
 * Whether the caller is assigned now to a job that one of these Anlagen,
 * none voided, is linked to; `null` when a read failed.
 */
async function hasAssignedJobOfEquipment(
  context: AuthorizedDocumentContext,
  equipmentIds: string[],
): Promise<boolean | null> {
  const { data: workLinks, error: workLinksError } = await readInBatches(equipmentIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        context.admin
          .from('installed_equipment_work_links')
          .select('equipment_id, job_id')
          .eq('organization_id', context.orgId)
          .in('equipment_id', [...batch])
          .not('job_id', 'is', null)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  );
  if (workLinksError) {
    logReadFailure('getAuthorizedDocument: installed_equipment_work_links read failed', workLinksError);
    return null;
  }
  const jobIds = [...new Set(workLinks.flatMap((link) => (link.job_id ? [link.job_id] : [])))];
  if (jobIds.length === 0) return false;
  const [equipmentRead, assignmentRead] = await Promise.all([
    readInBatches(equipmentIds, (batch) =>
      context.admin
        .from('installed_equipment')
        .select('id')
        .eq('organization_id', context.orgId)
        .in('id', [...batch])
        .is('voided_at', null),
    ),
    readInBatches(jobIds, (batch) =>
      context.admin
        .from('job_assignments')
        .select('job_id')
        .eq('organization_id', context.orgId)
        .eq('user_id', context.userId)
        .in('job_id', [...batch]),
    ),
  ]);
  const readError = equipmentRead.error ?? assignmentRead.error;
  if (readError) {
    logReadFailure('getAuthorizedDocument: equipment access read failed', readError);
    return null;
  }
  const liveEquipment = new Set(equipmentRead.data.map((equipment) => equipment.id));
  const assignedJobs = new Set(assignmentRead.data.map((assignment) => assignment.job_id));
  return workLinks.some(
    (link) => link.job_id !== null && assignedJobs.has(link.job_id) && liveEquipment.has(link.equipment_id),
  );
}

/**
 * Whether a field worker opens an ordinary document through an Anlage it is
 * linked to: the document passes {@link isFieldEquipmentDocument} and the
 * caller is assigned now to a job of one of those Anlagen. `null` when a read
 * failed. The caller has already ruled out a protected personnel file.
 */
export async function opensThroughAssignedEquipment(
  context: AuthorizedDocumentContext,
  document: Pick<DocumentRow, 'category' | 'retention_class'>,
  links: ReadonlyArray<
    Pick<DocumentLinkRow, 'equipment_id' | 'request_id' | 'maintenance_coverage_id' | 'employee_id'>
  >,
): Promise<boolean | null> {
  const equipmentIds = links.flatMap((link) => (link.equipment_id ? [link.equipment_id] : []));
  if (equipmentIds.length === 0 || !isFieldEquipmentDocument(document, links)) return false;
  return hasAssignedJobOfEquipment(context, equipmentIds);
}
