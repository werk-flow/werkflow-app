'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { readJobAssignmentOfUser } from '@/lib/jobs/job-access-reads';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { SITE_ACCESS_LIMITS } from './types';

// The Server Actions of a field worker's access proposal and its office
// review. The database functions of
// supabase/migrations/20261201100004_propose_site_access_corrections.sql check
// the same again under lock and write in one call.

const proposalRefusal = writeRefusalFor(
  new Set([
    'invalid_input',
    'not_authorized',
    'job_not_found',
    'site_not_on_job',
    'client_not_found',
    'proposal_not_found',
    'proposal_already_decided',
    'proposal_changed',
    'site_changed',
    'contact_not_found',
  ]),
);

const proposeInputSchema = z.object({
  jobId: uuidSchema,
  siteId: uuidSchema,
  contactName: z.string().max(SITE_ACCESS_LIMITS.contactName),
  contactPhone: z.string().max(SITE_ACCESS_LIMITS.contactPhone),
  contactNote: z.string().max(SITE_ACCESS_LIMITS.contactNote),
  accessNotes: z.string().max(SITE_ACCESS_LIMITS.accessNotes),
});

// The revision the manager reviewed: a worker's replacement since then refuses the decision.
const revisionSchema = z.number().int().min(1);

// What the review showed of what an acceptance overwrites; '' for none. Another
// decision on the Einsatzort since then refuses it (site_changed). These are
// master data as they are, not proposal input: the bound only caps the request
// at the customer editor's largest text (10,000 characters, lib/clients/actions.ts).
const reviewedTextSchema = z.string().max(10_000);

const acceptInputSchema = z.object({
  proposalId: uuidSchema,
  revision: revisionSchema,
  reviewedAccessNotes: reviewedTextSchema,
  contact: z
    .object({
      id: uuidSchema,
      reviewedName: reviewedTextSchema,
      reviewedPhone: reviewedTextSchema,
      reviewedNote: reviewedTextSchema,
    })
    .nullable(),
});

const rejectInputSchema = z.object({
  proposalId: uuidSchema,
  revision: revisionSchema,
  reason: z.string().trim().min(3).max(SITE_ACCESS_LIMITS.reason),
});

/**
 * Proposes a corrected access contact and access notes for the Einsatzort of
 * a job the caller is assigned to, or replaces the job's open proposal. The
 * Einsatzort itself stays as it is until a manager accepts.
 */
export async function proposeSiteAccess(
  rawInput: z.input<typeof proposeInputSchema>,
): Promise<ActionResult<{ proposalId: string }>> {
  const parsed = proposeInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { orgId, userId } = auth.context;

    // The job of the caller's organization, at the named Einsatzort, with the
    // caller on its team; managers edit the Einsatzort directly instead.
    const admin = createSupabaseAdminClient();
    const job = await admin
      .from('jobs')
      .select('id, site_id')
      .eq('organization_id', orgId)
      .eq('id', input.jobId)
      .maybeSingle();
    if (job.error) {
      logError('proposeSiteAccess: job read failed', job.error);
      return { success: false, error: 'load_failed' };
    }
    if (!job.data) return { success: false, error: 'job_not_found' };
    const assignment = await readJobAssignmentOfUser(orgId, input.jobId, userId);
    if (assignment.error) return { success: false, error: 'load_failed' };
    if (!assignment.data) return { success: false, error: 'not_authorized' };
    if (job.data.site_id !== input.siteId) return { success: false, error: 'site_not_on_job' };

    const { data, error } = await admin.rpc('propose_site_access', {
      p_actor_id: userId,
      p_organization_id: orgId,
      p_job_id: input.jobId,
      p_site_id: input.siteId,
      p_contact_name: input.contactName,
      p_contact_phone: input.contactPhone,
      p_contact_note: input.contactNote,
      p_access_notes: input.accessNotes,
    });
    if (error || !data) return proposalRefusal(error, 'save_failed', 'proposeSiteAccess: save failed');
    // The field work pack renders the proposal's state into this response.
    revalidatePath('/auftraege', 'layout');
    return { success: true, proposalId: data.id };
  } catch (error) {
    logError('Unexpected error in proposeSiteAccess:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Applies an open proposal: its contact corrects `contact`, a Zugangskontakt
 * of the Einsatzort, or with null becomes a new one; its access notes replace
 * the Einsatzort's. Manager-only. The values the review showed must still
 * hold, or the database refuses with site_changed.
 */
export async function acceptSiteAccessProposal(
  rawInput: z.input<typeof acceptInputSchema>,
): Promise<ActionResult> {
  const parsed = acceptInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;
    if (!isManagerOrAbove) return { success: false, error: 'not_authorized' };

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('accept_site_access_proposal', {
      p_actor_id: userId,
      p_organization_id: orgId,
      p_proposal_id: parsed.data.proposalId,
      p_revision: parsed.data.revision,
      p_reviewed_access_notes: parsed.data.reviewedAccessNotes,
      // No contact to correct leaves p_contact_id null: a new Zugangskontakt.
      ...(parsed.data.contact === null
        ? {}
        : {
            p_contact_id: parsed.data.contact.id,
            p_reviewed_contact_name: parsed.data.contact.reviewedName,
            p_reviewed_contact_phone: parsed.data.contact.reviewedPhone,
            p_reviewed_contact_note: parsed.data.contact.reviewedNote,
          }),
    });
    if (error || !data) return proposalRefusal(error, 'save_failed', 'acceptSiteAccessProposal: save failed');
    return { success: true };
  } catch (error) {
    logError('Unexpected error in acceptSiteAccessProposal:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Rejects an open proposal with a reason; the proposed values are cleared in the same call. Manager-only. */
export async function rejectSiteAccessProposal(
  rawInput: z.input<typeof rejectInputSchema>,
): Promise<ActionResult> {
  const parsed = rejectInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;
    if (!isManagerOrAbove) return { success: false, error: 'not_authorized' };

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('reject_site_access_proposal', {
      p_actor_id: userId,
      p_organization_id: orgId,
      p_proposal_id: parsed.data.proposalId,
      p_revision: parsed.data.revision,
      p_reason: parsed.data.reason,
    });
    if (error || !data) return proposalRefusal(error, 'save_failed', 'rejectSiteAccessProposal: save failed');
    return { success: true };
  } catch (error) {
    logError('Unexpected error in rejectSiteAccessProposal:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
