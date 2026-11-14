import { useState } from 'react';

import { CreateOfferDialog } from '@/components/angebote/create-offer-dialog';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';

// „Angebot anlegen“: a press without title or customer marks both fields,
// focuses the first and sends nothing.
export function OffersContractFixture(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <Button onClick={() => setOpen(true)}>Neues Angebot</Button>
        {open && <CreateOfferDialog onClose={() => setOpen(false)} />}
      </main>
    </BannerProvider>
  );
}
