import 'server-only';

import { formatSiteRowAddress } from '@/lib/clients/types';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { formatProfileName } from '@/lib/members/profile-name';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import type { SiteAccessReviewRead } from './types';

/** The job, Einsatzort, active Zugangskontakte and proposer an open proposal names. */
function readReviewReferences(
  admin: AdminClient,
  orgId: string,
  row: { job_id: string; site_id: string; proposed_by: string | null },
) {
  return Promise.all([
    admin
      .from('jobs')
      .select('job_number, title')
      .eq('organization_id', orgId)
      .eq('id', row.job_id)
      .maybeSingle(),
    admin
      .from('client_sites')
      .select('name, street, postal_code, city, access_notes')
      .eq('organization_id', orgId)
      .eq('id', row.site_id)
      .maybeSingle(),
    // Every active Zugangskontakt of the Einsatzort, so the review can correct any of them.
    readCompleteRows(
      (from, to) =>
        admin
          .from('client_contacts')
          .select('id, name, phone, notes')
          .eq('organization_id', orgId)
          .eq('site_id', row.site_id)
          .eq('site_role', 'zugangskontakt')
          .eq('is_active', true)
          .order('name')
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    row.proposed_by
      ? admin.from('profiles').select('first_name, last_name, email').eq('id', row.proposed_by).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
}

/**
 * The review of one access proposal for the customer page's `?zugang=`: the
 * open proposal of an Einsatzort of this customer, or `decided` for a proposal
 * of this customer that is no longer open. A proposal of another customer or
 * organization reads as `decided` too, so the page reveals nothing about it.
 * The caller established the organization and the manager role.
 */
export async function readSiteAccessReview(
  orgId: string,
  clientId: string,
  proposalId: string,
): Promise<{ ok: true; read: SiteAccessReviewRead } | { ok: false }> {
  const admin = createSupabaseAdminClient();
  const proposal = await admin
    .from('site_access_proposals')
    .select(
      'id, job_id, site_id, client_id, status, revision, proposed_by, proposed_at, contact_name, contact_phone, contact_note, access_notes',
    )
    .eq('organization_id', orgId)
    .eq('id', proposalId)
    .maybeSingle();
  if (proposal.error) {
    logReadFailure('readSiteAccessReview: proposal read failed', proposal.error);
    return { ok: false };
  }
  const row = proposal.data;
  if (!row || row.client_id !== clientId || row.status !== 'open')
    return { ok: true, read: { state: 'decided' } };

  const [job, site, contacts, proposer] = await readReviewReferences(admin, orgId, row);
  const failure = job.error ?? site.error ?? contacts.error ?? proposer.error;
  if (failure || !job.data || !site.data) {
    logReadFailure('readSiteAccessReview: reference read failed', failure);
    return { ok: false };
  }
  return {
    ok: true,
    read: {
      state: 'open',
      review: {
        proposalId: row.id,
        revision: row.revision,
        jobNumber: job.data.job_number,
        jobTitle: job.data.title,
        siteName: site.data.name,
        siteAddress: formatSiteRowAddress(site.data),
        currentAccessNotes: site.data.access_notes,
        proposerName: proposer.data ? formatProfileName(proposer.data) : 'Unbekannt',
        proposedAt: row.proposed_at,
        values: {
          contactName: row.contact_name ?? '',
          contactPhone: row.contact_phone ?? '',
          contactNote: row.contact_note ?? '',
          accessNotes: row.access_notes ?? '',
        },
        accessContacts: contacts.data,
      },
    },
  };
}
