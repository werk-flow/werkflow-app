import 'server-only';

import { logReadFailure } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { toSiteAccessProposalStatus, type JobSiteAccessProposalRead } from './types';

/**
 * The latest access proposal of a job for its current Einsatzort, as its field
 * worker sees it. The caller passes a job its own organization-scoped read
 * loaded and whose team it checked holds the viewer (the field work pack
 * page); this reader adds no permission of its own.
 */
export async function readJobSiteAccessProposal(
  job: { id: string; organizationId: string; siteId: string | null },
  viewerId: string,
): Promise<JobSiteAccessProposalRead> {
  if (!job.siteId) return { ok: true, proposal: null };
  const { data, error } = await createSupabaseAdminClient()
    .from('site_access_proposals')
    .select(
      'id, status, proposed_by, proposed_at, decided_at, rejection_reason, contact_name, contact_phone, contact_note, access_notes',
    )
    .eq('organization_id', job.organizationId)
    .eq('job_id', job.id)
    .eq('site_id', job.siteId)
    .order('proposed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logReadFailure('readJobSiteAccessProposal: read failed', error);
    return { ok: false };
  }
  if (!data) return { ok: true, proposal: null };
  const status = toSiteAccessProposalStatus(data.status);
  // A state a later release adds shows as no proposal rather than a wrong one.
  if (!status) return { ok: true, proposal: null };
  const proposedByMe = data.proposed_by === viewerId;
  return {
    ok: true,
    proposal: {
      id: data.id,
      status,
      proposedAt: data.proposed_at,
      proposedByMe,
      decidedAt: data.decided_at,
      rejectionReason: data.rejection_reason,
      // Only the proposer sees what they proposed: a coworker's proposal names
      // a contact the job does not show.
      values:
        status === 'open' && proposedByMe
          ? {
              contactName: data.contact_name ?? '',
              contactPhone: data.contact_phone ?? '',
              contactNote: data.contact_note ?? '',
              accessNotes: data.access_notes ?? '',
            }
          : null,
    },
  };
}
