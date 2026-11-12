'use client';

import { UserRound } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { lazyDialog } from '@/components/shared/lazy-dialog';
import { Button } from '@/components/ui/button';
import { useRouterRefresh } from '@/components/ui/refresh-button';
import { SectionError } from '@/components/ui/section-error';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import type { SiteAccessProposalValues } from '@/lib/site-access-proposals/types';

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

/** „Zugang stimmt nicht?“ or „Hinweis ändern“; the form loads on the worker's intent. */
export function FieldSiteAccessButton({
  jobId,
  siteId,
  stateKey,
  ownOpenValues,
  failed,
}: {
  jobId: string;
  siteId: string;
  /** Identifies the proposal state the server rendered beside the button. */
  stateKey: string;
  /** The worker's own open proposal, which the form edits. */
  ownOpenValues?: SiteAccessProposalValues;
  /** The proposal could not be read; the block says so and offers a retry. */
  failed?: true;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const settle = useSettleOnChange(stateKey);
  const waiting = lazyProposalDialog.useWaiting(open);
  const retry = useRouterRefresh();
  return (
    <>
      {failed && (
        <SectionError
          title="Zugangshinweis nicht geladen"
          onRetry={retry.refresh}
          retryPending={retry.isPending}
        >
          Ob das Büro deinen Hinweis zum Zugang schon geprüft hat, ist gerade nicht bekannt.
        </SectionError>
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
        <UserRound className="size-4" />
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
    </>
  );
}
