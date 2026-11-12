import type { ReactElement, ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import type { FieldSiteAccess, JobSiteAccessProposal } from '@/lib/site-access-proposals/types';
import { formatGermanDate } from '@/lib/utils';
import { FieldSiteAccessButton, FieldSiteAccessReadError } from './field-site-access-proposal';

/**
 * Where the field work pack places the access proposal: `action` sits on the
 * Einsatzort's label line and takes no height of its own, because the
 * worker's primary next action must stay on the first screen
 * (tests/audit/wave-2/p1-16.spec.ts); `readError` follows the access notes.
 */
export type FieldSiteAccessSlots = { action: ReactNode; readError?: ReactNode };

/**
 * The field worker's access proposal on the job's Einsatzort: one button that
 * shows what became of the latest proposal and opens the form with its
 * details. The state renders on the server, so the job page's client code
 * carries only the button (lab.field.cold-start). The proposal changes
 * nothing at the Einsatzort until the office accepts it.
 */
export function fieldSiteAccessSlots(jobId: string, access: FieldSiteAccess): FieldSiteAccessSlots {
  const proposal = access.proposal ?? null;
  const ownOpenValues = proposal?.status === 'open' ? proposal.values : null;
  const state = proposal ? PROPOSAL_STATES[proposal.status] : null;
  const notice = proposal ? proposalNotice(proposal) : null;
  const action = (
    <FieldSiteAccessButton
      jobId={jobId}
      siteId={access.siteId}
      label={state ? `Zugang korrigieren (${state.badge})` : 'Zugang korrigieren'}
      // Changes with every sent or decided proposal, so the button's save can wait for it.
      stateKey={proposal ? `${proposal.id}:${proposal.status}:${proposal.proposedAt}` : ''}
      {...(notice ? { notice } : {})}
      {...(ownOpenValues ? { ownOpenValues } : {})}
    >
      {state && <ProposalBadge {...state} />}
    </FieldSiteAccessButton>
  );
  return access.failed ? { action, readError: <FieldSiteAccessReadError /> } : { action };
}

const PROPOSAL_STATES = {
  open: { badge: 'Hinweis beim Büro', variant: 'warning' },
  accepted: { badge: 'Hinweis übernommen', variant: 'success' },
  rejected: { badge: 'Hinweis abgelehnt', variant: 'outline' },
} as const;

function ProposalBadge({
  badge,
  variant,
}: {
  badge: string;
  variant: 'warning' | 'success' | 'outline';
}): ReactElement {
  return <Badge variant={variant}>{badge}</Badge>;
}

/** What the form says above its fields about the latest proposal. */
function proposalNotice(proposal: JobSiteAccessProposal): string {
  if (proposal.status === 'open') {
    return proposal.proposedByMe
      ? 'Dein Hinweis liegt beim Büro. Was du jetzt sendest, ersetzt ihn.'
      : 'Ein Hinweis aus deinem Team liegt beim Büro. Was du jetzt sendest, ersetzt ihn.';
  }
  const decidedOn = proposal.decidedAt ? ` am ${formatGermanDate(proposal.decidedAt)}` : '';
  if (proposal.status === 'accepted')
    return `Das Büro hat den letzten Hinweis zum Zugang${decidedOn} übernommen.`;
  return `Das Büro hat den letzten Hinweis zum Zugang${decidedOn} nicht übernommen${
    proposal.rejectionReason ? `: ${proposal.rejectionReason}` : '.'
  }`;
}
