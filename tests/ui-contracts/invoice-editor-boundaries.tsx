import { useEffect, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { InvoiceDeliveries } from '@/components/rechnungen/invoice-delivery';
import { InvoiceEditor } from '@/components/rechnungen/invoice-editor';
import { InvoiceSettingsForm } from '@/components/settings/invoice-settings-form';
import { BannerProvider } from '@/components/ui/banner';
import type { DeliveryEntry, DeliveryList } from '@/lib/delivery/delivery-types';
import type { InvoiceSettings } from '@/lib/invoices/settings';
import type { InvoiceDetail } from '@/lib/invoices/types';
import { CalendarOrganizationContext } from './calendar-service-boundaries';

// The invoice editor, the invoice settings form and an issued or cancelled
// invoice's „Versand“. The spec renders a newer read of the page as a refresh
// would: the invoice issued, or the settings in a new Berlin year. „Versand“
// is also server-rendered and hydrated, as the invoice page does.
declare global {
  interface Window {
    /** Renders the page again as after another session issued the invoice as RE-2037-001. */
    uiContractInvoiceIssuedElsewhere: (() => void) | null;
    /** Renders the settings page again as read after New Year's midnight: the series restarts at 1. */
    uiContractInvoiceSettingsNewYear: (() => void) | null;
    /** Renders „Versand“ again as read after the retry: one more attempt. */
    uiContractDeliveryRefresh: (() => void) | null;
    /** What React reported while it hydrated the server-rendered „Versand“, such as a mismatch. */
    uiContractHydrationErrors: string[];
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

const HOUR = 60 * 60 * 1000;

/**
 * One sent email, one failed email whose retry window is open, and one whose
 * first attempt went unanswered before a retry failed and the window closed.
 */
const DELIVERIES: DeliveryList = {
  total: 3,
  entries: [
    {
      id: '98000000-0000-4000-8000-000000000003',
      channel: 'email',
      state: 'failed',
      recipient: 'verwaltung@lindenhof.example',
      subject: 'Rechnung RE-2037-001 – Haustechnik Sonnenberg GmbH',
      note: '',
      attempts: 2,
      failureCode: 'email_provider_503',
      outcomeUnknown: true,
      createdAt: '2037-11-21T10:00:00.000Z',
      sentAt: null,
      createdBy: 'Erika Musterfrau',
      retryFrom: null,
      retryUntil: null,
    },
    {
      id: '98000000-0000-4000-8000-000000000002',
      channel: 'email',
      state: 'failed',
      recipient: 'buchhaltung@lindenhof.example',
      subject: 'Rechnung RE-2037-001 – Haustechnik Sonnenberg GmbH',
      note: '',
      attempts: 1,
      failureCode: 'email_provider_503',
      outcomeUnknown: false,
      createdAt: '2037-11-21T09:30:00.000Z',
      sentAt: null,
      createdBy: 'Erika Musterfrau',
      retryFrom: new Date(Date.now() - HOUR).toISOString(),
      retryUntil: new Date(Date.now() + HOUR).toISOString(),
    },
    {
      id: '98000000-0000-4000-8000-000000000001',
      channel: 'email',
      state: 'sent',
      recipient: 'erika.musterfrau@lindenhof.example',
      subject: 'Rechnung RE-2037-001 – Haustechnik Sonnenberg GmbH',
      note: '',
      attempts: 1,
      failureCode: null,
      outcomeUnknown: false,
      createdAt: '2037-11-20T09:00:00.000Z',
      sentAt: '2037-11-20T09:00:05.000Z',
      createdBy: 'Erika Musterfrau',
      retryFrom: null,
      retryUntil: null,
    },
  ],
};

/** „Versand“ as the invoice page renders it: a cancelled invoice gets no mail defaults. */
export function InvoiceDeliveriesContractFixture({
  cancelled,
  list = DELIVERIES,
}: {
  cancelled: boolean;
  list?: DeliveryList;
}): React.JSX.Element {
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <InvoiceDeliveries
          invoiceId="96000000-0000-4000-8000-000000000001"
          invoiceNumber="RE-2037-001"
          list={list}
          defaults={
            cancelled
              ? null
              : {
                  recipient: 'erika.musterfrau@lindenhof.example',
                  subject: 'Rechnung RE-2037-001 – Haustechnik Sonnenberg GmbH',
                  text: 'Guten Tag,',
                }
          }
        />
      </main>
    </BannerProvider>
  );
}

/** One email whose first attempt went unanswered and whose retry failed; its retry window is still open. */
const UNCLEAR_FAILED: DeliveryEntry = {
  id: '98000000-0000-4000-8000-000000000005',
  channel: 'email',
  state: 'failed',
  recipient: 'verwaltung@lindenhof.example',
  subject: 'Rechnung RE-2037-001 – Haustechnik Sonnenberg GmbH',
  note: '',
  attempts: 2,
  failureCode: 'email_provider_503',
  outcomeUnknown: true,
  createdAt: '2037-11-21T10:00:00.000Z',
  sentAt: null,
  createdBy: 'Erika Musterfrau',
  retryFrom: new Date(Date.now() - HOUR).toISOString(),
  retryUntil: new Date(Date.now() + HOUR).toISOString(),
};

/** „Versand“ of an issued invoice with that email; a refresh brings one more attempt. */
export function InvoiceDeliveryRetryContractFixture(): React.JSX.Element {
  const [entry, setEntry] = useState(UNCLEAR_FAILED);
  useEffect(() => {
    window.uiContractDeliveryRefresh = () =>
      setEntry((current) => ({ ...current, attempts: current.attempts + 1 }));
  }, []);
  return <InvoiceDeliveriesContractFixture cancelled={false} list={{ total: 1, entries: [entry] }} />;
}

const MINUTE = 60 * 1000;

/**
 * Server-renders an issued invoice's „Versand“ five minutes before the browser
 * hydrates it, and hydrates it. Its one email went out a quarter hour ago and
 * has had no answer for the last minute: the server's clock and the browser's
 * see different rows when either reads its own.
 */
export function mountInvoiceDeliveriesHydration(root: HTMLElement): void {
  const hydratedAt = Date.now();
  const sending: DeliveryList = {
    total: 1,
    entries: [
      {
        id: '98000000-0000-4000-8000-000000000004',
        channel: 'email',
        state: 'sending',
        recipient: 'erika.musterfrau@lindenhof.example',
        subject: 'Rechnung RE-2037-001 – Haustechnik Sonnenberg GmbH',
        note: '',
        attempts: 1,
        failureCode: null,
        outcomeUnknown: false,
        createdAt: new Date(hydratedAt - 11 * MINUTE).toISOString(),
        sentAt: null,
        createdBy: 'Erika Musterfrau',
        retryFrom: new Date(hydratedAt - MINUTE).toISOString(),
        retryUntil: new Date(hydratedAt + 23 * 60 * MINUTE).toISOString(),
      },
    ],
  };
  const page = <InvoiceDeliveriesContractFixture cancelled={false} list={sending} />;
  const clock = Date.now;
  Date.now = () => hydratedAt - 5 * MINUTE;
  try {
    root.innerHTML = renderToString(page);
  } finally {
    Date.now = clock;
  }
  window.uiContractHydrationErrors = [];
  hydrateRoot(root, page, {
    onRecoverableError: (error) => window.uiContractHydrationErrors.push(String(error)),
  });
}
