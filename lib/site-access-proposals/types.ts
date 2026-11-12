// A field worker's proposal for the access to their job's Einsatzort, and the
// rules its form and the office review share with the server
// (supabase/migrations/20261130100003_propose_site_access_corrections.sql).

export const SITE_ACCESS_LIMITS = {
  contactName: 200,
  contactPhone: 50,
  contactNote: 500,
  accessNotes: 2000,
  reason: 500,
} as const;

export type SiteAccessProposalStatus = 'open' | 'accepted' | 'rejected';

export function toSiteAccessProposalStatus(value: string): SiteAccessProposalStatus | null {
  return value === 'open' || value === 'accepted' || value === 'rejected' ? value : null;
}

export type SiteAccessProposalValues = {
  contactName: string;
  contactPhone: string;
  contactNote: string;
  accessNotes: string;
};

/** The control ids of the proposal form, in their order on the screen. */
export const SITE_ACCESS_FIELD_IDS = {
  contactName: 'site-access-contact-name',
  contactPhone: 'site-access-contact-phone',
  contactNote: 'site-access-contact-note',
  accessNotes: 'site-access-notes',
} as const;

/**
 * The marked fields of a proposal the server would refuse: it names a
 * contact or access notes, and a phone or a note belongs to a named contact.
 */
export function siteAccessProposalErrors(
  values: SiteAccessProposalValues,
): Partial<Record<keyof SiteAccessProposalValues, string>> {
  const hasName = values.contactName.trim() !== '';
  if (!hasName && values.accessNotes.trim() === '') {
    return {
      contactName: 'Gib an, wer dich reinlässt, oder beschreibe den Zugang.',
      accessNotes: 'Gib an, wer dich reinlässt, oder beschreibe den Zugang.',
    };
  }
  if (!hasName && (values.contactPhone.trim() !== '' || values.contactNote.trim() !== '')) {
    return { contactName: 'Gib den Namen zu Telefon oder Hinweis an.' };
  }
  return {};
}

/** The worker's view of the latest proposal for their job's Einsatzort. */
export type JobSiteAccessProposal = {
  id: string;
  status: SiteAccessProposalStatus;
  proposedAt: string;
  proposedByMe: boolean;
  decidedAt: string | null;
  rejectionReason: string | null;
  /** The viewer's own proposed values while open; null for a coworker's and after a decision. */
  values: SiteAccessProposalValues | null;
};

/** The field work pack's read of that proposal; a failed read is not „no proposal“. */
export type JobSiteAccessProposalRead = { ok: true; proposal: JobSiteAccessProposal | null } | { ok: false };

/**
 * What the field work pack hands its client: the Einsatzort, and only the
 * keys that hold something, because the job page's payload is measured
 * (lab.field.job-open). No proposal sends the site id alone.
 */
export type FieldSiteAccess = { siteId: string; proposal?: JobSiteAccessProposal; failed?: true };

export function fieldSiteAccess(siteId: string, read: JobSiteAccessProposalRead): FieldSiteAccess {
  if (!read.ok) return { siteId, failed: true };
  return read.proposal ? { siteId, proposal: read.proposal } : { siteId };
}

/** A Zugangskontakt of the Einsatzort that an acceptance can correct. */
type SiteAccessContactOption = { id: string; name: string; phone: string | null };

/** An open proposal as the office reviews it on the customer's page. */
export type SiteAccessReview = {
  proposalId: string;
  /** The proposal's revision this review shows; a decision on an older one is refused. */
  revision: number;
  jobNumber: string | null;
  jobTitle: string;
  siteName: string;
  siteAddress: string;
  currentAccessNotes: string | null;
  proposerName: string;
  proposedAt: string;
  values: SiteAccessProposalValues;
  /** The Einsatzort's active Zugangskontakte, which an acceptance can correct. */
  accessContacts: SiteAccessContactOption[];
};

/** What the customer page opens for `?zugang=`: the review, or that the proposal is no longer open. */
export type SiteAccessReviewRead = { state: 'open'; review: SiteAccessReview } | { state: 'decided' };

/** The customer page's search parameter that opens a proposal's review. */
export const SITE_ACCESS_REVIEW_PARAM = 'zugang';
