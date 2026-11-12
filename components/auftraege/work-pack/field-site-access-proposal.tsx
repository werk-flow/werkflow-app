'use client';

import { DoorOpen } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { FieldWorkPackLoadError } from '@/components/auftraege/work-pack/field-work-pack-load-error';
import { lazyDialog } from '@/components/shared/lazy-dialog';
import { Button } from '@/components/ui/button';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import type {
  JobSiteAccessProposal,
  JobSiteAccessProposalRead,
  SiteAccessProposalValues,
} from '@/lib/site-access-proposals/types';
import { formatGermanDate } from '@/lib/utils';

const lazyProposalDialog = lazyDialog<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  siteId: string;
  initialValues: SiteAccessProposalValues;
  settle: () => Promise<void>;
}>(() => import('./field-site-access-dialog').then((mod) => mod.SiteAccessProposalDialog));

const EMPTY_VALUES: SiteAccessProposalValues = {
  contactName: '',
  contactPhone: '',
  contactNote: '',
  accessNotes: '',
};

/**
 * The field worker's way to tell the office that the access to the job's
 * Einsatzort is wrong, and what became of it. The proposal changes nothing at
 * the Einsatzort until the office accepts it in Aufgaben.
 */
export function FieldSiteAccessProposal({
  jobId,
  siteId,
  read,
}: {
  jobId: string;
  siteId: string;
  read: JobSiteAccessProposalRead;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const proposal = read.ok ? read.proposal : null;
  const settle = useSettleOnChange(read);
  const waiting = lazyProposalDialog.useWaiting(open);
  const ownOpenValues = proposal?.status === 'open' ? proposal.values : null;

  return (
    <div className="mt-3 space-y-2" data-testid="field-site-access">
      {read.ok ? (
        <SiteAccessProposalState proposal={proposal} />
      ) : (
        <FieldWorkPackLoadError
          title="Zugangshinweis nicht geladen"
          description="Ob das Büro deinen Hinweis zum Zugang schon geprüft hat, ist gerade nicht bekannt."
        />
      )}
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full sm:w-auto"
        pending={waiting}
        onPointerEnter={lazyProposalDialog.preload}
        onFocus={lazyProposalDialog.preload}
        onClick={() => setOpen(true)}
      >
        <DoorOpen className="size-4" />
        {ownOpenValues ? 'Hinweis ändern' : 'Zugang stimmt nicht?'}
      </Button>
      {open && (
        <lazyProposalDialog.Dialog
          open={open}
          onOpenChange={setOpen}
          jobId={jobId}
          siteId={siteId}
          initialValues={ownOpenValues ?? EMPTY_VALUES}
          settle={() => settle()}
        />
      )}
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
