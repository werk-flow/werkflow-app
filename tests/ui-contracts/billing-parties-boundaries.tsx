import { useEffect, useState } from 'react';

import { WorkBillingPartiesDialog } from '@/components/auftraege/shared/work-billing-parties-dialog';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import type { ResolvedBillingVersion } from '@/lib/billing-parties/resolve';

const weg = {
  id: 'contract-client-weg',
  name: 'WEG Lindenstraße 5',
  address: 'Lindenstraße 5, 10115 Berlin',
};
const lindenhof = { id: 'contract-client-lindenhof', name: 'Hausverwaltung Lindenhof GmbH', address: null };
const birkenhain = {
  id: 'contract-client-birkenhain',
  name: 'Hausverwaltung Birkenhain GmbH',
  address: null,
};

const seen: ResolvedBillingVersion = {
  version: 1,
  source: 'objekt',
  setAt: '2026-11-12T08:00:00Z',
  auftraggeber: weg,
  recipient: lindenhof,
};
/** What another office user saved meanwhile: another Auftraggeber. */
const saved: ResolvedBillingVersion = {
  version: 2,
  source: 'buero',
  setAt: '2026-11-12T09:00:00Z',
  auftraggeber: birkenhain,
  recipient: lindenhof,
};

/** How many of the next rereads fail, as a lost connection does. */
let failingRereads = 0;
/** A held reread waits here until the contract releases it, as a slow connection does. */
let heldReread: Promise<void> | null = null;
let releaseReread: (() => void) | null = null;

export function BillingPartiesContractFixture(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(seen);
  // As the live view does, a failed read marks the parties stale until one lands.
  const [stale, setStale] = useState(false);
  // The other user's save reaches this page while the dialog is open.
  useEffect(() => {
    const deliver = (): void => setCurrent(saved);
    const failNextReread = (): void => {
      failingRereads = 1;
    };
    const holdNextReread = (): void => {
      heldReread = new Promise((resolve) => {
        releaseReread = resolve;
      });
    };
    const release = (): void => releaseReread?.();
    window.addEventListener('contract-billing-newer', deliver);
    window.addEventListener('contract-billing-reread-fails', failNextReread);
    window.addEventListener('contract-billing-reread-hold', holdNextReread);
    window.addEventListener('contract-billing-reread-release', release);
    return () => {
      window.removeEventListener('contract-billing-newer', deliver);
      window.removeEventListener('contract-billing-reread-fails', failNextReread);
      window.removeEventListener('contract-billing-reread-hold', holdNextReread);
      window.removeEventListener('contract-billing-reread-release', release);
    };
  }, []);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <Button onClick={() => setOpen(true)}>Rechnung ändern</Button>
        <WorkBillingPartiesDialog
          open={open}
          onOpenChange={setOpen}
          kind="job"
          workId="contract-job"
          current={current}
          // The reread finds the version the other save wrote.
          onSaved={async () => setCurrent(saved)}
          stale={stale}
          onReread={async () => {
            if (failingRereads > 0) {
              failingRereads -= 1;
              setStale(true);
              return;
            }
            if (heldReread) {
              await heldReread;
              heldReread = null;
            }
            setCurrent(saved);
            setStale(false);
          }}
        />
      </main>
    </BannerProvider>
  );
}
