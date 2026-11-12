// Stand-ins for `@/lib/site-access-proposals/actions`, and the hosts of the
// access proposal contracts: the field worker's form and the office review.
// Every write waits at the write gate; the answer `transport` makes the
// action promise reject, as a lost connection does.
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

import { SiteAccessProposalDialog } from '@/components/auftraege/work-pack/field-site-access-dialog';
import { SiteAccessReviewDialog } from '@/components/kunden/site-access-review-dialog';
import { BannerProvider } from '@/components/ui/banner';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import type { ActionResult } from '@/lib/action-result';
import type { SiteAccessReview } from '@/lib/site-access-proposals/types';
import { holdWrite } from './held-write-boundary';
import { ROUTE_REFRESH_EVENT } from './lifecycle-boundaries';

type SiteAccessContractState = {
  /** The open proposal as the customer page read it. */
  review: SiteAccessReview;
  /** What the field work pack rendered of the latest proposal. */
  stateKey: string;
};

declare global {
  interface Window {
    uiContractSiteAccess: SiteAccessContractState;
  }
}

const reviewOfRevision1: SiteAccessReview = {
  proposalId: '9b000000-0000-4000-8000-000000000001',
  revision: 1,
  jobNumber: 'A-2026-0420',
  jobTitle: 'Heizungswartung',
  siteName: 'Haus Lindenstraße',
  siteAddress: 'Lindenstraße 5, 10115 Berlin',
  currentAccessNotes: 'Schlüssel beim Hausmeister',
  proposerName: 'Max Monteur',
  proposedAt: '2026-11-12T08:00:00.000Z',
  values: {
    contactName: 'Erika Musterfrau',
    contactPhone: '0160 5550123',
    contactNote: '',
    accessNotes: 'Seiteneingang über den Hof',
  },
  accessContacts: [
    { id: '9b000000-0000-4000-8000-000000000051', name: 'Frau Birke', phone: '030 222' },
    { id: '9b000000-0000-4000-8000-000000000050', name: 'Herr Alt', phone: '030 111' },
  ],
};

window.uiContractSiteAccess = { review: reviewOfRevision1, stateKey: '' };

/** The worker replaced the proposal while the office reviewed it. */
function replaceProposal(): void {
  const { review } = window.uiContractSiteAccess;
  window.uiContractSiteAccess.review = {
    ...review,
    revision: review.revision + 1,
    values: { ...review.values, contactName: 'Erika Mustermann', accessNotes: 'Tor an der Rückseite' },
  };
}

async function answer(kind: string, input: unknown): Promise<string | null> {
  const refusal = await holdWrite(kind, input);
  if (refusal === 'transport') throw new TypeError('Failed to fetch');
  if (refusal === 'proposal_changed') replaceProposal();
  return refusal;
}

export async function proposeSiteAccess(input: unknown): Promise<ActionResult<{ proposalId: string }>> {
  const refusal = await answer('propose-site-access', input);
  if (refusal !== null) return { success: false, error: refusal };
  // The action revalidates: its render reaches the page with the answer,
  // before the caller's wait for it can start.
  window.uiContractSiteAccess.stateKey = 'proposal:open';
  flushSync(() => window.dispatchEvent(new Event(ROUTE_REFRESH_EVENT)));
  return { success: true, proposalId: '9b000000-0000-4000-8000-000000000001' };
}

export async function acceptSiteAccessProposal(input: unknown): Promise<ActionResult> {
  const refusal = await answer('accept-site-access', input);
  return refusal === null ? { success: true } : { success: false, error: refusal };
}

export async function rejectSiteAccessProposal(input: unknown): Promise<ActionResult> {
  const refusal = await answer('reject-site-access', input);
  return refusal === null ? { success: true } : { success: false, error: refusal };
}

/** The boundary state as route props; a route refresh reads it again. */
function useSiteAccessProps(): SiteAccessContractState {
  const [props, setProps] = useState(() => ({ ...window.uiContractSiteAccess }));
  useEffect(() => {
    const reread = (): void => setProps({ ...window.uiContractSiteAccess });
    window.addEventListener(ROUTE_REFRESH_EVENT, reread);
    return () => window.removeEventListener(ROUTE_REFRESH_EVENT, reread);
  }, []);
  return props;
}

/** The office review the customer page opens for `?zugang=`. */
export function SiteAccessReviewContractFixture(): React.JSX.Element {
  const { review } = useSiteAccessProps();
  const [open, setOpen] = useState(true);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <SiteAccessReviewDialog open={open} onOpenChange={setOpen} read={{ state: 'open', review }} />
      </main>
    </BannerProvider>
  );
}

/** The field worker's form, settling on the work pack's rendered proposal state. */
export function SiteAccessProposalContractFixture(): React.JSX.Element {
  const { stateKey } = useSiteAccessProps();
  const settle = useSettleOnChange(stateKey);
  const [open, setOpen] = useState(true);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <p>{stateKey === '' ? 'Kein Hinweis' : 'Hinweis beim Büro'}</p>
        {open && (
          <SiteAccessProposalDialog
            open={open}
            onOpenChange={setOpen}
            jobId="9b000000-0000-4000-8000-000000000030"
            siteId="9b000000-0000-4000-8000-000000000040"
            initialValues={{ contactName: '', contactPhone: '', contactNote: '', accessNotes: '' }}
            notice={null}
            settle={settle}
          />
        )}
      </main>
    </BannerProvider>
  );
}
