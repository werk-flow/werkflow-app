import { useEffect, useState } from 'react';

import { CreateOfferDialog } from '@/components/angebote/create-offer-dialog';
import { EditOfferHeaderButton } from '@/components/angebote/offer-header-dialog';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';

// „Angebot anlegen“: a press without title or customer marks both fields,
// focuses the first and sends nothing. „Angebotskopf bearbeiten“ of a draft
// offer saves against the version it opened with; the spec renders a newer
// version of the page as a refresh would.
declare global {
  interface Window {
    uiContractOfferServerRender: ((version: number) => void) | null;
  }
}

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
          offer={{
            id: '95000000-0000-4000-8000-000000000001',
            offerNumber: 'ANG-2026-001',
            title: 'Austausch Gastherme',
            status: 'entwurf',
            version,
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
          }}
          owners={[{ userId: '93000000-0000-4000-8000-000000000001', name: 'Erika Musterfrau' }]}
        />
      </main>
    </BannerProvider>
  );
}
