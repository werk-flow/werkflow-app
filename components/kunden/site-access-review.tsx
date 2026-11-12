'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';

import { SiteAccessReviewDialog } from './site-access-review-dialog';
import type { SiteAccessReviewRead } from '@/lib/site-access-proposals/types';

/**
 * The review of a field worker's access proposal, open from the first frame
 * of a customer page reached with `?zugang=` (the „Zugang prüfen“ task). It
 * ships with the customer page itself: a lazy import of it made Turbopack cut
 * the shared (app) layout group into two more chunks for every page.
 * Closing it, or deciding, drops the parameter, so the page renders as usual
 * and the Einsatzorte card shows the result.
 */
function SiteAccessReview({
  clientId,
  read,
}: {
  clientId: string;
  read: SiteAccessReviewRead | 'failed';
}): ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  return (
    <SiteAccessReviewDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) router.replace(`/kunden/${clientId}#einsatzorte`, { scroll: false });
      }}
      read={read}
    />
  );
}

/** Renders the review for a `?zugang=` read; a new proposal opens anew. */
export function SiteAccessReviewOpener({
  clientId,
  read,
}: {
  clientId: string;
  read: SiteAccessReviewRead | 'failed';
}): ReactElement {
  const key = read === 'failed' || read.state === 'decided' ? 'closed' : read.review.proposalId;
  return <SiteAccessReview key={key} clientId={clientId} read={read} />;
}
