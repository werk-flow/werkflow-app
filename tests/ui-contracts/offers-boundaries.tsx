import { useEffect, useState } from 'react';

import { CreateOfferDialog } from '@/components/angebote/create-offer-dialog';
import { OfferContentEditor } from '@/components/angebote/editor/offer-content-editor';
import { EditOfferHeaderButton } from '@/components/angebote/offer-header-dialog';
import { StartOfferRevisionButton } from '@/components/angebote/offer-revision-start';
import { OfferSendActions } from '@/components/angebote/offer-sending';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import type { OfferCostedSection, OfferWithCosts } from '@/lib/offers/types';

// „Angebot anlegen“: a press without title or customer marks both fields,
// focuses the first and sends nothing. „Angebotskopf bearbeiten“ of a draft
// offer saves against the version it opened with; the spec renders a newer
// version of the page as a refresh would. The content editor of the same
// draft starts without Titel; the spec renders its saved content as the
// save's revalidated page would. „Vorschau“ reads the PDF the spec routes.
// With `uiContractOfferSent` set before the bundle loads, the offer is sent
// as revision 1, and „Bearbeiten“ starts revision 2 instead.
declare global {
  interface Window {
    uiContractOfferSent?: boolean;
    uiContractOfferServerRender: ((version: number) => void) | null;
    uiContractOfferContentRender: ((contentVersion: number, sections: OfferCostedSection[]) => void) | null;
  }
}

const OFFER: OfferWithCosts = {
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
  const [content, setContent] = useState({ contentVersion: 1, sections: OFFER.sections });
  const [sent] = useState(() => window.uiContractOfferSent === true);
  useEffect(() => {
    window.uiContractOfferServerRender = setVersion;
    window.uiContractOfferContentRender = (contentVersion, sections) =>
      setContent({ contentVersion, sections });
  }, []);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <Button onClick={() => setOpen(true)}>Neues Angebot</Button>
        {open && <CreateOfferDialog onClose={() => setOpen(false)} />}
        {sent ? (
          <StartOfferRevisionButton offer={{ ...OFFER, version }} sentRevision={1} />
        ) : (
          <EditOfferHeaderButton
            offer={{ ...OFFER, version }}
            owners={[{ userId: '93000000-0000-4000-8000-000000000001', name: 'Erika Musterfrau' }]}
          />
        )}
        <OfferSendActions offer={{ ...OFFER, version, ...content }} />
        <OfferContentEditor offer={{ ...OFFER, version, ...content }} />
      </main>
    </BannerProvider>
  );
}
