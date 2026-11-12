import 'server-only';

// The managers' „Zugang prüfen“ tasks behind the attention Server Actions in
// `./actions`: a field worker's open proposal for the access to their job's
// Einsatzort. Derived live from the open proposals that `./manager-sets`
// reads with the open requests; never stored. Without an open proposal it
// sends no request of its own.

import { formatSiteRowAddress } from '@/lib/clients/types';
import { logError } from '@/lib/logging';
import { formatProfileName } from '@/lib/members/profile-name';
import type { ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import type { ManagerAttentionSetsRead, OpenProposalRow } from './manager-sets';
import type { AttentionTask } from './types';

/** The jobs, Einsatzorte, active Zugangskontakte and proposers the open proposals name. */
async function readProposalReferences(
  admin: AdminClient,
  orgId: string,
  proposals: readonly OpenProposalRow[],
) {
  const jobIds = [...new Set(proposals.map((row) => row.job_id))];
  const siteIds = [...new Set(proposals.map((row) => row.site_id))];
  const proposerIds = [...new Set(proposals.flatMap((row) => (row.proposed_by ? [row.proposed_by] : [])))];
  const [jobs, sites, contacts, profiles] = await Promise.all([
    readInBatches(jobIds, (batch) =>
      admin
        .from('jobs')
        .select('id, job_number, title')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    readInBatches(siteIds, (batch) =>
      admin
        .from('client_sites')
        .select('id, name, street, postal_code, city, access_notes')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    readInBatches(siteIds, (batch) =>
      admin
        .from('client_contacts')
        .select('id, site_id, name, phone')
        .eq('organization_id', orgId)
        .eq('site_role', 'zugangskontakt')
        .eq('is_active', true)
        .in('site_id', [...batch])
        .order('name')
        .order('id'),
    ),
    readInBatches(proposerIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name, email')
        .in('id', [...batch]),
    ),
  ]);
  const error = jobs.error ?? sites.error ?? contacts.error ?? profiles.error;
  if (error) return { error, references: null };
  return {
    error: null,
    references: {
      jobById: new Map(jobs.data.map((job) => [job.id, job])),
      siteById: new Map(sites.data.map((site) => [site.id, site])),
      profileById: new Map(profiles.data.map((profile) => [profile.id, profile])),
      contacts: contacts.data,
    },
  };
}

type ProposalReferences = NonNullable<Awaited<ReturnType<typeof readProposalReferences>>['references']>;

function toTask(row: OpenProposalRow, references: ProposalReferences): AttentionTask[] {
  const job = references.jobById.get(row.job_id);
  const site = references.siteById.get(row.site_id);
  if (!job || !site) return [];
  const proposer = row.proposed_by ? references.profileById.get(row.proposed_by) : undefined;
  return [
    {
      sourceType: 'site_access_proposal',
      sourceId: row.id,
      jobNumber: job.job_number,
      jobTitle: job.title,
      siteName: site.name,
      siteAddress: formatSiteRowAddress(site),
      currentAccessNotes: site.access_notes,
      proposerName: proposer ? formatProfileName(proposer) : 'Unbekannt',
      proposedAt: row.proposed_at,
      values: {
        contactName: row.contact_name ?? '',
        contactPhone: row.contact_phone ?? '',
        contactNote: row.contact_note ?? '',
        accessNotes: row.access_notes ?? '',
      },
      accessContacts: references.contacts
        .filter((contact) => contact.site_id === row.site_id)
        .map((contact) => ({ id: contact.id, name: contact.name, phone: contact.phone })),
    },
  ];
}

export async function deriveSiteAccessProposalTasks(
  context: ActionContext,
  managerSets: ManagerAttentionSetsRead,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') return { tasks: [], failed: false };
  const sets = await managerSets;
  if (sets.failed) return { tasks: [], failed: true };
  if (sets.accessProposals.length === 0) return { tasks: [], failed: false };
  const { error, references } = await readProposalReferences(
    createSupabaseAdminClient(),
    context.orgId,
    sets.accessProposals,
  );
  if (error || !references) {
    logError('Failed to resolve site access proposal references', error);
    return { tasks: [], failed: true };
  }
  return { tasks: sets.accessProposals.flatMap((row) => toTask(row, references)), failed: false };
}
