import type { ReactElement } from 'react';

import { FieldWorkPackLoadError } from '@/components/auftraege/work-pack/field-work-pack-load-error';
import type {
  FieldSiteAccess,
  JobSiteAccessProposal,
  SiteAccessProposalValues,
} from '@/lib/site-access-proposals/types';
import { formatGermanDate } from '@/lib/utils';
import { FieldSiteAccessButton } from './field-site-access-proposal';

/**
 * The field worker's access proposal under the job's Einsatzort: what became
 * of it, and „Zugang stimmt nicht?“. The state renders on the server, so the
 * job page's client code carries only the button (lab.field.cold-start). The
 * proposal changes nothing at the Einsatzort until the office accepts it in
 * Aufgaben.
 */
export function FieldSiteAccess({ jobId, access }: { jobId: string; access: FieldSiteAccess }): ReactElement {
  const proposal = access.proposal ?? null;
  const ownOpenValues = proposal?.status === 'open' ? proposal.values : null;
  return (
    <div className="mt-3 space-y-2" data-testid="field-site-access">
      {access.failed ? (
        <FieldWorkPackLoadError
          title="Zugangshinweis nicht geladen"
          description="Ob das Büro deinen Hinweis zum Zugang schon geprüft hat, ist gerade nicht bekannt."
        />
      ) : (
        <SiteAccessProposalState proposal={proposal} />
      )}
      <FieldSiteAccessButton
        jobId={jobId}
        siteId={access.siteId}
        // Changes with every sent or decided proposal, so the button's save can wait for it.
        stateKey={proposal ? `${proposal.id}:${proposal.status}:${proposal.proposedAt}` : ''}
        {...(ownOpenValues ? { ownOpenValues } : {})}
      />
    </div>
  );
}

function SiteAccessProposalState({
  proposal,
}: {
  proposal: JobSiteAccessProposal | null;
}): ReactElement | null {
  if (!proposal) return null;
  if (proposal.status === 'open') {
    return (
      <div className="rounded-md bg-warning-soft p-3 text-sm text-warning-soft-foreground" role="status">
        <p className="font-medium">
          {proposal.proposedByMe
            ? 'Dein Hinweis zum Zugang liegt beim Büro.'
            : 'Ein Hinweis aus deinem Team zum Zugang liegt beim Büro.'}
        </p>
        {proposal.values && <ProposedValues values={proposal.values} />}
      </div>
    );
  }
  const decidedOn = proposal.decidedAt ? ` am ${formatGermanDate(proposal.decidedAt)}` : '';
  if (proposal.status === 'accepted') {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Das Büro hat den Hinweis zum Zugang{decidedOn} übernommen.
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground" role="status">
      Das Büro hat den Hinweis zum Zugang{decidedOn} nicht übernommen
      {proposal.rejectionReason ? `: ${proposal.rejectionReason}` : '.'}
    </p>
  );
}

function ProposedValues({ values }: { values: SiteAccessProposalValues }): ReactElement {
  const contact = [values.contactName, values.contactPhone, values.contactNote].filter(Boolean).join(' · ');
  return (
    <div className="mt-1 space-y-0.5 wrap-anywhere">
      {contact && <p>Zugangskontakt: {contact}</p>}
      {values.accessNotes && <p className="whitespace-pre-wrap">Zugang: {values.accessNotes}</p>}
    </div>
  );
}
