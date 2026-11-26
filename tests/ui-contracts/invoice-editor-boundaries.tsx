import { useEffect, useState } from 'react';

import { InvoiceEditor } from '@/components/rechnungen/invoice-editor';
import { InvoiceSettingsForm } from '@/components/settings/invoice-settings-form';
import { BannerProvider } from '@/components/ui/banner';
import type { InvoiceSettings } from '@/lib/invoices/settings';
import type { InvoiceDetail } from '@/lib/invoices/types';
import { CalendarOrganizationContext } from './calendar-service-boundaries';

// The invoice editor and the invoice settings form. The spec renders a newer
// read of the page as a refresh would: the invoice issued, or the settings in
// a new Berlin year.
declare global {
  interface Window {
    /** Renders the page again as after another session issued the invoice as RE-2037-001. */
    uiContractInvoiceIssuedElsewhere: (() => void) | null;
    /** Renders the settings page again as read after New Year's midnight: the series restarts at 1. */
    uiContractInvoiceSettingsNewYear: (() => void) | null;
  }
}

const LINE = {
  name: 'Heizkörper tauschen',
  description: '',
  quantity: '1',
  unit: 'piece',
  unitPriceCents: 18_000,
  priceQuantity: 1,
  taxRateBasisPoints: 1900,
  netCents: 18_000,
  source: null,
} as const;

const DRAFT: InvoiceDetail = {
  id: '96000000-0000-4000-8000-000000000001',
  invoiceNumber: null,
  status: 'entwurf',
  version: 1,
  issueDate: null,
  original: null,
  cancels: null,
  cancellationReason: null,
  chain: [],
  serviceStart: '2037-11-02',
  serviceEnd: '2037-11-02',
  paymentDueDays: 14,
  discountDays: null,
  discountBasisPoints: null,
  orderReference: '',
  buyerReference: '',
  openingText: '',
  closingText: '',
  lineNetCents: 18_000,
  taxCents: 3420,
  grossCents: 21_420,
  client: { id: '94000000-0000-4000-8000-000000000001', name: 'Hausverwaltung Lindenhof GmbH' },
  recipient: {
    id: '94000000-0000-4000-8000-000000000001',
    name: 'Hausverwaltung Lindenhof GmbH',
    address: 'Hofweg 1, 10117 Berlin',
  },
  work: null,
  lines: [LINE],
};

const SETTINGS: InvoiceSettings = {
  version: 1,
  numberPrefix: 'RE-',
  numberWithYear: true,
  numberMinDigits: 3,
  nextNumber: 57,
  nextInvoiceNumber: 'RE-2037-057',
  numberYear: 2037,
  numbersFixed: false,
  paymentDueDays: 14,
  discountDays: null,
  discountBasisPoints: null,
};

export function InvoiceEditorContractFixture(): React.JSX.Element {
  const [invoice, setInvoice] = useState(DRAFT);
  useEffect(() => {
    window.uiContractInvoiceIssuedElsewhere = () =>
      setInvoice({
        ...DRAFT,
        status: 'ausgestellt',
        version: 2,
        invoiceNumber: 'RE-2037-001',
        issueDate: '2037-11-20',
      });
  }, []);
  return (
    <CalendarOrganizationContext.Provider value="00000000-0000-4000-8000-000000000001">
      <BannerProvider>
        <main>
          <h1>Komponentenverträge</h1>
          <InvoiceEditor invoice={invoice} />
        </main>
      </BannerProvider>
    </CalendarOrganizationContext.Provider>
  );
}

export function InvoiceSettingsContractFixture(): React.JSX.Element {
  const [settings, setSettings] = useState(SETTINGS);
  useEffect(() => {
    window.uiContractInvoiceSettingsNewYear = () =>
      setSettings({ ...SETTINGS, numberYear: 2038, nextNumber: 1, nextInvoiceNumber: 'RE-2038-001' });
  }, []);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <InvoiceSettingsForm
          organizationId="00000000-0000-4000-8000-000000000001"
          settings={settings}
          canEdit
        />
      </main>
    </BannerProvider>
  );
}
