import { useEffect, useState } from 'react';

import { CreateOfferDialog } from '@/components/angebote/create-offer-dialog';
import { OfferContentEditor } from '@/components/angebote/editor/offer-content-editor';
import { EditOfferHeaderButton } from '@/components/angebote/offer-header-dialog';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import type { OfferDetail } from '@/lib/offers/types';

// „Angebot anlegen“: a press without title or customer marks both fields,
// focuses the first and sends nothing. „Angebotskopf bearbeiten“ of a draft
// offer saves against the version it opened with; the spec renders a newer
// version of the page as a refresh would. The content editor of the same
// draft starts without Titel.
declare global {
  interface Window {
    uiContractOfferServerRender: ((version: number) => void) | null;
  }
}

const OFFER: OfferDetail = {
  id: '95000000-0000-4000-8000-000000000001',
  offerNumber: 'ANG-2026-001',
  title: 'Austausch Gastherme',
  status: 'entwurf',
  version: 1,
  contentVersion: 1,
  validUntil: '2026-12-31',
  openingText: '',
  closingText: '',
  client: { id: '94000000-0000-4000-8000-000000000001', name: 'WEG Lindenstraße 5' },
  site: null,
  contact: null,
  recipient: {
    id: '94000000-0000-4000-8000-000000000001',
    name: 'WEG Lindenstraße 5',
    address: null,
    isDefault: true,
  },
  owner: { userId: '93000000-0000-4000-8000-000000000001', name: 'Erika Musterfrau' },
  work: null,
  sections: [],
};

export function OffersContractFixture(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(1);
  useEffect(() => {
    window.uiContractOfferServerRender = setVersion;
  }, []);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <Button onClick={() => setOpen(true)}>Neues Angebot</Button>
        {open && <CreateOfferDialog onClose={() => setOpen(false)} />}
        <EditOfferHeaderButton
          offer={{ ...OFFER, version }}
          owners={[{ userId: '93000000-0000-4000-8000-000000000001', name: 'Erika Musterfrau' }]}
        />
        <OfferContentEditor offer={{ ...OFFER, version }} />
      </main>
    </BannerProvider>
  );
}
