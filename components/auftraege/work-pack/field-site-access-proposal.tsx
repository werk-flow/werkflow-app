'use client';

import { PencilLine } from 'lucide-react';
import { useState, type ReactElement, type ReactNode } from 'react';

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
  notice: string | null;
  settle: () => Promise<void>;
}>(() => import('./field-site-access-dialog').then((mod) => mod.SiteAccessProposalDialog));

const EMPTY_VALUES: SiteAccessProposalValues = {
  contactName: '',
  contactPhone: '',
  contactNote: '',
  accessNotes: '',
};

/**
 * The access proposal's button on the Einsatzort's label line: the latest
 * proposal's state badge and a pencil. Its 44 px target overhangs the line
 * instead of growing it, so the block keeps its height. The form loads on the
 * worker's intent.
 */
export function FieldSiteAccessButton({
  jobId,
  siteId,
  label,
  stateKey,
  notice,
  ownOpenValues,
  children,
}: {
  jobId: string;
  siteId: string;
  /** The accessible name; it contains the badge's text. */
  label: string;
  /** Identifies the proposal state the server rendered into the button. */
  stateKey: string;
  /** What the form says about the latest proposal: still open, taken, or declined with the reason. */
  notice?: string;
  /** The worker's own open proposal, which the form edits. */
  ownOpenValues?: SiteAccessProposalValues;
  /** The state badge, rendered on the server. */
  children?: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const settle = useSettleOnChange(stateKey);
  const waiting = lazyProposalDialog.useWaiting(open);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-my-3.5 h-11 min-w-11 px-2"
        aria-label={label}
        pending={waiting}
        onPointerEnter={lazyProposalDialog.preload}
        onFocus={lazyProposalDialog.preload}
        onClick={() => setOpen(true)}
      >
        <PencilLine className="text-muted-foreground" />
        {children}
      </Button>
      {open && (
        <lazyProposalDialog.Dialog
          open={open}
          onOpenChange={setOpen}
          jobId={jobId}
          siteId={siteId}
          initialValues={ownOpenValues ?? EMPTY_VALUES}
          notice={notice ?? null}
          settle={() => settle()}
        />
      )}
    </>
  );
}

/** The proposal's state could not be read; the Einsatzort says so and offers a retry. */
export function FieldSiteAccessReadError(): ReactElement {
  const retry = useRouterRefresh();
  return (
    <SectionError
      className="mt-2"
      title="Zugangshinweis nicht geladen"
      onRetry={retry.refresh}
      retryPending={retry.isPending}
    >
      Ob das Büro deinen Hinweis zum Zugang schon geprüft hat, ist gerade nicht bekannt.
    </SectionError>
  );
}
