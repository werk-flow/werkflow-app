import 'server-only';

// The managers' „Zugang prüfen“ tasks behind the attention Server Actions in
// `./actions`: a field worker's open proposal for the access to their job's
// Einsatzort. Derived live from the open proposals; never stored. The steady
// state, no open proposal, costs one indexed read.

import { formatSiteRowAddress } from '@/lib/clients/types';
import { logError } from '@/lib/logging';
import { formatProfileName } from '@/lib/members/profile-name';
import type { ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type { AttentionTask } from './types';

type OpenProposal = {
  id: string;
  job_id: string;
  site_id: string;
  proposed_by: string | null;
  proposed_at: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_note: string | null;
  access_notes: string | null;
};

function readOpenProposals(admin: AdminClient, orgId: string) {
  return readCompleteRows(
    (from, to) =>
      admin
        .from('site_access_proposals')
        .select(
          'id, job_id, site_id, proposed_by, proposed_at, contact_name, contact_phone, contact_note, access_notes',
        )
        .eq('organization_id', orgId)
        .eq('status', 'open')
        .order('proposed_at')
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
}

/** The jobs, Einsatzorte, active Zugangskontakte and proposers the open proposals name. */
async function readProposalReferences(admin: AdminClient, orgId: string, proposals: readonly OpenProposal[]) {
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

function toTask(row: OpenProposal, references: ProposalReferences): AttentionTask[] {
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
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') return { tasks: [], failed: false };
  const admin = createSupabaseAdminClient();
  const proposals = await readOpenProposals(admin, context.orgId);
  if (proposals.error) {
    logError('Failed to load open site access proposals', proposals.error);
    return { tasks: [], failed: true };
  }
  if (proposals.data.length === 0) return { tasks: [], failed: false };
  const { error, references } = await readProposalReferences(admin, context.orgId, proposals.data);
  if (error || !references) {
    logError('Failed to resolve site access proposal references', error);
    return { tasks: [], failed: true };
  }
  return { tasks: proposals.data.flatMap((row) => toTask(row, references)), failed: false };
}
