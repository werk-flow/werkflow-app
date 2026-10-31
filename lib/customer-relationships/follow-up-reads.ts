import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import type { ClientManagerContext } from '@/lib/clients/manager-access';
import { logReadFailure } from '@/lib/data/read-request-cache';
import type { Database } from '@/lib/supabase/database.types';
import { readInBatches } from '@/lib/supabase/query-batches';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { customerJobHref, firstRelation, profileName } from './relationship-labels';
import {
  FOLLOW_UP_PAGE_SIZE,
  toFollowUpSourceType,
  toFollowUpStatus,
  type ClientFollowUp,
  type FollowUpOwner,
  type FollowUpSourceType,
} from './types';

type FollowUpRow = Database['public']['Tables']['client_follow_ups']['Row'];

type SourceReference = {
  label: string;
  href: string | null;
};

export function toClientFollowUp(
  row: FollowUpRow,
  ownerName: string,
  ownerIsActiveManager: boolean,
  source: SourceReference | null,
): ClientFollowUp {
  return {
    id: row.id,
    clientId: row.client_id,
    sourceType: row.source_type === null ? null : toFollowUpSourceType(row.source_type),
    sourceId: row.source_id,
    sourceLabel: source?.label ?? (row.source_id ? 'Quelle nicht mehr verfügbar' : null),
    sourceHref: source?.href ?? null,
    title: row.title,
    note: row.note,
    ownerUserId: row.owner_user_id,
    ownerName,
    ownerIsActiveManager,
    dueAt: row.due_at,
    status: toFollowUpStatus(row.status),
    resolutionNote: row.resolution_note,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    completedBy: row.completed_by,
    completedAt: row.completed_at,
    cancelledBy: row.cancelled_by,
    cancelledAt: row.cancelled_at,
  };
}

export async function loadFollowUpOwners(
  context: ClientManagerContext,
): Promise<ActionResult<{ owners: FollowUpOwner[]; managerUserIds: Set<string> }>> {
  const { data: memberships, error } = await context.admin
    .from('organization_members')
    .select('user_id,role')
    .eq('organization_id', context.orgId)
    .in('role', ['admin', 'buero']);
  if (error) {
    logReadFailure('loadFollowUpOwners: manager memberships read failed', error);
    return { success: false, error: 'owners_load_failed' };
  }
  const userIds = (memberships ?? []).map((member) => member.user_id);
  const profilesResult = await readInBatches(userIds, (batch) =>
    context.admin
      .from('profiles')
      .select('id,first_name,last_name,email')
      .in('id', [...batch]),
  );
  if (profilesResult.error) {
    logReadFailure('loadFollowUpOwners: profiles read failed', profilesResult.error);
    return { success: false, error: 'owners_load_failed' };
  }
  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const owners: FollowUpOwner[] = (memberships ?? [])
    .map((member) => ({
      userId: member.user_id,
      // The read filters on these two roles.
      role: constrainedValue(['admin', 'buero'], member.role, 'organization_members.role'),
      name: profileName(profileById.get(member.user_id) ?? null),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'de'));
  return { success: true, owners, managerUserIds: new Set(userIds) };
}

/** One follow-up's source through the batch reader, so both share one label and link rule. */
export async function loadSingleFollowUpSource(
  context: ClientManagerContext,
  clientId: string,
  sourceType: FollowUpSourceType | null,
  sourceId: string | null,
): Promise<ActionResult<{ source: SourceReference | null }>> {
  if (!sourceType || !sourceId) return { success: true, source: null };
  const references = new Map<string, SourceReference>();
  const loaded = await loadFollowUpSourceReferences(context, clientId, sourceType, [sourceId], references);
  if (!loaded) return { success: false, error: 'source_load_failed' };
  return { success: true, source: references.get(`${sourceType}:${sourceId}`) ?? null };
}

/** The ids of one source type, read into `references` keyed `<type>:<id>`. */
type SourceRead = {
  context: ClientManagerContext;
  clientId: string;
  ids: string[];
  references: Map<string, SourceReference>;
};

/** A source read's rows; null after logging its failure. */
function sourceRowsOrNull<Row>(
  sourceType: FollowUpSourceType,
  result: { data: Row[] | null; error: unknown },
): Row[] | null {
  if (result.error) {
    logReadFailure(`loadFollowUps: ${sourceType} sources read failed`, result.error);
    return null;
  }
  return result.data ?? [];
}

async function loadContactSources({ context, clientId, ids, references }: SourceRead): Promise<boolean> {
  const result = await readInBatches(ids, (batch) =>
    context.admin
      .from('client_contacts')
      .select('id,name')
      .in('id', [...batch])
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId),
  );
  const rows = sourceRowsOrNull('contact', result);
  if (!rows) return false;
  for (const row of rows)
    references.set(`contact:${row.id}`, { label: row.name, href: `/kunden/${clientId}#ansprechpartner` });
  return true;
}

async function loadSiteSources({ context, clientId, ids, references }: SourceRead): Promise<boolean> {
  const result = await readInBatches(ids, (batch) =>
    context.admin
      .from('client_sites')
      .select('id,name')
      .in('id', [...batch])
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId),
  );
  const rows = sourceRowsOrNull('site', result);
  if (!rows) return false;
  for (const row of rows)
    references.set(`site:${row.id}`, { label: row.name, href: `/kunden/${clientId}#einsatzorte` });
  return true;
}

async function loadRequestSources({ context, clientId, ids, references }: SourceRead): Promise<boolean> {
  const result = await readInBatches(ids, (batch) =>
    context.admin
      .from('client_requests')
      .select('id,request_number,summary')
      .in('id', [...batch])
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId),
  );
  const rows = sourceRowsOrNull('request', result);
  if (!rows) return false;
  for (const row of rows)
    references.set(`request:${row.id}`, {
      label: row.request_number ?? row.summary,
      href: `/anfragen/${row.id}`,
    });
  return true;
}

async function loadJobSources({ context, clientId, ids, references }: SourceRead): Promise<boolean> {
  const result = await readInBatches(ids, (batch) =>
    context.admin
      .from('jobs')
      .select('id,job_number,title,projects!jobs_project_id_fkey(project_number)')
      .in('id', [...batch])
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId),
  );
  const rows = sourceRowsOrNull('job', result);
  if (!rows) return false;
  for (const row of rows) {
    references.set(`job:${row.id}`, {
      label: row.job_number ?? row.title,
      href: customerJobHref(row.job_number, firstRelation(row.projects)?.project_number),
    });
  }
  return true;
}

async function loadServiceCaseSources({ context, clientId, ids, references }: SourceRead): Promise<boolean> {
  const result = await readInBatches(ids, (batch) =>
    context.admin
      .from('service_cases')
      .select('id,case_number,summary')
      .in('id', [...batch])
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId),
  );
  const rows = sourceRowsOrNull('service_case', result);
  if (!rows) return false;
  for (const row of rows) {
    references.set(`service_case:${row.id}`, {
      label: `${row.case_number} · ${row.summary}`,
      href: `/service/faelle/${encodeURIComponent(row.case_number)}`,
    });
  }
  return true;
}

async function loadMaintenanceCoverageSources({
  context,
  clientId,
  ids,
  references,
}: SourceRead): Promise<boolean> {
  const result = await readInBatches(ids, (batch) =>
    context.admin
      .from('maintenance_coverages')
      .select('id,coverage_number,reference')
      .in('id', [...batch])
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId),
  );
  const rows = sourceRowsOrNull('maintenance_coverage', result);
  if (!rows) return false;
  for (const row of rows) {
    references.set(`maintenance_coverage:${row.id}`, {
      label: row.reference ? `${row.coverage_number} · ${row.reference}` : row.coverage_number,
      href: '/service/wartung',
    });
  }
  return true;
}

async function loadProjectSources({ context, clientId, ids, references }: SourceRead): Promise<boolean> {
  const result = await readInBatches(ids, (batch) =>
    context.admin
      .from('projects')
      .select('id,project_number,name')
      .in('id', [...batch])
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId),
  );
  const rows = sourceRowsOrNull('project', result);
  if (!rows) return false;
  for (const row of rows)
    references.set(`project:${row.id}`, {
      label: row.project_number ?? row.name,
      href: row.project_number ? `/auftraege/projekt/${encodeURIComponent(row.project_number)}` : null,
    });
  return true;
}

/** Reads one source type's labels and links into `sourceReferences`; false after logging a failed read. */
async function loadFollowUpSourceReferences(
  context: ClientManagerContext,
  clientId: string,
  sourceType: FollowUpSourceType,
  ids: string[],
  sourceReferences: Map<string, SourceReference>,
): Promise<boolean> {
  if (ids.length === 0) return true;
  const read: SourceRead = { context, clientId, ids, references: sourceReferences };
  if (sourceType === 'contact') return loadContactSources(read);
  if (sourceType === 'site') return loadSiteSources(read);
  if (sourceType === 'request') return loadRequestSources(read);
  if (sourceType === 'job') return loadJobSources(read);
  if (sourceType === 'service_case') return loadServiceCaseSources(read);
  if (sourceType === 'maintenance_coverage') return loadMaintenanceCoverageSources(read);
  return loadProjectSources(read);
}

export async function loadFollowUps(
  context: ClientManagerContext,
  clientId: string,
  owners: FollowUpOwner[],
  managerUserIds: Set<string>,
): Promise<ActionResult<{ followUps: ClientFollowUp[] }>> {
  const [openResult, historyResult] = await Promise.all([
    context.admin
      .from('client_follow_ups')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId)
      .eq('status', 'open')
      .order('due_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(FOLLOW_UP_PAGE_SIZE + 1),
    context.admin
      .from('client_follow_ups')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId)
      .in('status', ['completed', 'cancelled'])
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(20),
  ]);
  if (openResult.error || historyResult.error) {
    logReadFailure('loadFollowUps: follow-ups read failed', openResult.error ?? historyResult.error);
    return { success: false, error: 'follow_ups_load_failed' };
  }
  if ((openResult.data ?? []).length > FOLLOW_UP_PAGE_SIZE) {
    logReadFailure('loadFollowUps: open follow-ups of one customer exceeded the page', {
      code: 'follow_ups_capacity_exceeded',
      clientId,
    });
    return { success: false, error: 'follow_ups_capacity_exceeded' };
  }
  const rows = [...(openResult.data ?? []), ...(historyResult.data ?? [])];

  const ownerNameById = new Map(owners.map((owner) => [owner.userId, owner.name]));
  const sourceIdsByType = new Map<FollowUpSourceType, string[]>();
  for (const row of rows ?? []) {
    if (!row.source_type || !row.source_id) continue;
    const sourceType = toFollowUpSourceType(row.source_type);
    sourceIdsByType.set(sourceType, [...(sourceIdsByType.get(sourceType) ?? []), row.source_id]);
  }

  const sourceReferences = new Map<string, SourceReference>();
  const sourceLoadResults = await Promise.all(
    [...sourceIdsByType.entries()].map(([sourceType, ids]) =>
      loadFollowUpSourceReferences(context, clientId, sourceType, [...new Set(ids)], sourceReferences),
    ),
  );
  if (sourceLoadResults.some((success) => !success)) {
    return { success: false, error: 'follow_up_sources_load_failed' };
  }

  return {
    success: true,
    followUps: (rows ?? []).map((row: FollowUpRow) => {
      const source =
        row.source_type && row.source_id
          ? (sourceReferences.get(`${row.source_type}:${row.source_id}`) ?? null)
          : null;
      return toClientFollowUp(
        row,
        ownerNameById.get(row.owner_user_id) ?? 'Ehemalige Zuständigkeit',
        managerUserIds.has(row.owner_user_id),
        source,
      );
    }),
  };
}
