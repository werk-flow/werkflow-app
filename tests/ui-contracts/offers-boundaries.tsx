import { useEffect, useState } from 'react';

import { CreateOfferDialog } from '@/components/angebote/create-offer-dialog';
import { AcceptOfferButton } from '@/components/angebote/offer-acceptance-dialog';
import { ConvertOfferButton } from '@/components/angebote/offer-conversion-dialog';
import { OfferContentEditor } from '@/components/angebote/editor/offer-content-editor';
import { EditOfferHeaderButton } from '@/components/angebote/offer-header-dialog';
import { StartOfferRevisionButton } from '@/components/angebote/offer-revision-start';
import { OfferSendActions } from '@/components/angebote/offer-sending';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import type { RevisionContent } from '@/lib/offers/accepted-scope';
import type { OfferCostedSection, OfferWithCosts } from '@/lib/offers/types';

// „Angebot anlegen“: a press without title or customer marks both fields,
// focuses the first and sends nothing. „Angebotskopf bearbeiten“ of a draft
// offer saves against the version it opened with; the spec renders a newer
// version of the page as a refresh would. The content editor of the same
// draft starts without Titel; the spec renders its saved content as the
// save's revalidated page would. „Vorschau“ reads the PDF the spec routes.
// With `uiContractOfferSent` set before the bundle loads, the offer is sent
// as revision 1, „Bearbeiten“ starts revision 2 instead, and „Annahme
// erfassen“ records its Annahme with a Bedarfsposition to choose. With
// `uiContractOfferAccepted` set, the offer is accepted and „In Arbeit
// übernehmen“ converts it; the spec renders the page with its work.
declare global {
  interface Window {
    uiContractOfferSent?: boolean;
    uiContractOfferAccepted?: boolean;
    uiContractOfferConvertedRender: ((version: number) => void) | null;
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

// Revision 1 as sent: a boiler and a Neutralisationsbox if needed.
const SENT_CONTENT: RevisionContent = [
  {
    number: '1',
    title: 'Wärmeerzeuger',
    netCents: 489000,
    positions: [
      {
        number: '1.1',
        kind: 'free',
        name: 'Gas-Brennwerttherme',
        description: '',
        quantity: '1',
        unit: 'piece',
        unitLabel: 'Stk',
        unitPriceCents: 489000,
        priceQuantity: 1,
        taxRateBasisPoints: 1900,
        amountCents: 489000,
      },
      {
        number: '1.2',
        kind: 'free',
        name: 'Neutralisationsbox',
        description: '',
        quantity: '1',
        unit: 'piece',
        unitLabel: 'Stk',
        unitPriceCents: 18500,
        priceQuantity: 1,
        taxRateBasisPoints: 1900,
        amountCents: 18500,
        positionType: 'bedarf',
      },
    ],
  },
];

export function OffersContractFixture(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(1);
  const [content, setContent] = useState({ contentVersion: 1, sections: OFFER.sections });
  const [sent] = useState(() => window.uiContractOfferSent === true);
  const [accepted] = useState(() => window.uiContractOfferAccepted === true);
  const [converted, setConverted] = useState(false);
  useEffect(() => {
    window.uiContractOfferConvertedRender = (next) => {
      setVersion(next);
      setConverted(true);
    };
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
        {accepted && <ConvertOfferButton offer={{ ...OFFER, version }} converted={converted} />}
        {sent ? (
          <>
            <StartOfferRevisionButton offer={{ ...OFFER, version }} sentRevision={1} />
            <AcceptOfferButton
              offer={{ ...OFFER, status: 'gesendet', version }}
              revision={{ revision: 1, sentOn: '2026-01-02', validUntil: '2099-12-31' }}
              content={SENT_CONTENT}
            />
          </>
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
