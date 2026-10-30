import 'server-only';

import type { AdminClient } from '@/lib/supabase/admin';
import type { WorkExecutionState } from '@/lib/work-lifecycle/types';

import { resolveChildState, resolveProjectHandoverExecutionState } from './project-state';
import { MAX_HANDOVER_SOURCE_ROWS } from './sources';
import type { WorkHandoverTarget, WorkHandoverTargetSnapshot } from './types';

// The customer facts a handover freezes for its target. The actions in
// actions.ts establish the handover holder before they load it.

type LoadedTarget = {
  snapshot: WorkHandoverTargetSnapshot;
  executionState: WorkExecutionState;
  executionVersion: number;
  projectJobIds: string[];
};
type PartyIds = { client_id: string | null; site_id: string | null; contact_id: string | null };
type Site = { name: string; street: string | null; postal_code: string | null; city: string | null };
type Parties = Awaited<ReturnType<typeof readTargetParties>>;

function readTargetParties(admin: AdminClient, organizationId: string, ids: PartyIds) {
  return Promise.all([
    ids.client_id
      ? admin
          .from('clients')
          .select('name')
          .eq('organization_id', organizationId)
          .eq('id', ids.client_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    ids.site_id
      ? admin
          .from('client_sites')
          .select('name, street, postal_code, city')
          .eq('organization_id', organizationId)
          .eq('id', ids.site_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    ids.contact_id
      ? admin
          .from('client_contacts')
          .select('name, role, email, phone')
          .eq('organization_id', organizationId)
          .eq('id', ids.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
}

function siteAddressOf(site: Site): string {
  return [site.street, [site.postal_code, site.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

function partySnapshot(
  [clientResult, siteResult, contactResult]: Parties,
  siteAddress: string | null,
): Omit<WorkHandoverTargetSnapshot, 'targetType' | 'targetId' | 'number' | 'title'> {
  return {
    customerName: clientResult.data?.name ?? null,
    contactName: contactResult.data?.name ?? null,
    contactRole: contactResult.data?.role ?? null,
    contactEmail: contactResult.data?.email ?? null,
    contactPhone: contactResult.data?.phone ?? null,
    siteName: siteResult.data?.name ?? null,
    siteAddress: siteAddress || null,
  };
}

async function loadJobTarget(
  admin: AdminClient,
  organizationId: string,
  jobId: string,
): Promise<LoadedTarget> {
  const { data: job, error } = await admin
    .from('jobs')
    .select(
      'id, job_number, title, location, client_id, site_id, contact_id, status, execution_state, execution_version',
    )
    .eq('organization_id', organizationId)
    .eq('id', jobId)
    .maybeSingle();
  if (error || !job) throw new Error('work_handover_target_not_found');
  const parties = await readTargetParties(admin, organizationId, job);
  if (parties.some((result) => result.error)) throw new Error('work_handover_target_load_failed');
  const site = parties[1].data;
  return {
    snapshot: {
      targetType: 'job',
      targetId: job.id,
      number: job.job_number,
      title: job.title,
      ...partySnapshot(parties, site ? siteAddressOf(site) : job.location),
    },
    executionState: resolveChildState({
      executionState: job.execution_state,
      status: job.status,
    }),
    executionVersion: job.execution_version,
    projectJobIds: [job.id],
  };
}

async function loadProjectTarget(
  admin: AdminClient,
  organizationId: string,
  projectId: string,
): Promise<LoadedTarget> {
  const { data: project, error } = await admin
    .from('projects')
    .select(
      'id, project_number, name, client_id, site_id, contact_id, status_override, execution_state_override, execution_version',
    )
    .eq('organization_id', organizationId)
    .eq('id', projectId)
    .maybeSingle();
  if (error || !project) throw new Error('work_handover_target_not_found');
  const [parties, jobsResult] = await Promise.all([
    readTargetParties(admin, organizationId, project),
    admin
      .from('jobs')
      .select('id, execution_state, status')
      .eq('organization_id', organizationId)
      .eq('project_id', project.id)
      .order('job_number')
      .limit(MAX_HANDOVER_SOURCE_ROWS + 1),
  ]);
  if (parties.some((result) => result.error) || jobsResult.error) {
    throw new Error('work_handover_target_load_failed');
  }
  if ((jobsResult.data?.length ?? 0) > MAX_HANDOVER_SOURCE_ROWS) {
    throw new Error('work_handover_sources_overflow');
  }
  const site = parties[1].data;
  return {
    snapshot: {
      targetType: 'project',
      targetId: project.id,
      number: project.project_number,
      title: project.name,
      ...partySnapshot(parties, site ? siteAddressOf(site) : null),
    },
    executionState: resolveProjectHandoverExecutionState(
      project.execution_state_override,
      project.status_override,
      (jobsResult.data ?? []).map((job) => ({
        executionState: job.execution_state,
        status: job.status,
      })),
    ),
    executionVersion: project.execution_version,
    projectJobIds: (jobsResult.data ?? []).map((job) => job.id),
  };
}

export function loadTargetSnapshot(
  admin: AdminClient,
  organizationId: string,
  target: WorkHandoverTarget,
): Promise<LoadedTarget> {
  return target.targetType === 'job'
    ? loadJobTarget(admin, organizationId, target.targetId)
    : loadProjectTarget(admin, organizationId, target.targetId);
}
