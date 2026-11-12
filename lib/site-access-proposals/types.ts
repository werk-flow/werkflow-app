// A field worker's proposal for the access to their job's Einsatzort, and the
// rules its form and the office review share with the server
// (supabase/migrations/20261130090005_propose_site_access_corrections.sql).

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

/** A Zugangskontakt of the Einsatzort that an acceptance can correct. */
export type SiteAccessContactOption = { id: string; name: string; phone: string | null };
