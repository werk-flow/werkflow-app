// „Versenden“ of a sent offer's revisions: the real buttons and dialog over
// revision 2 and revision 1, which revision 2 replaced, and revision 4 on a
// stale page whose read learns that revision 5 replaced it. Each read
// answers at once with one failed email still inside its retry window; the
// email is held until the spec answers (held-write-boundary.ts), and a retry
// is no write this contract expects.
import { OfferRevisionDelivery } from '@/components/angebote/offer-revision-delivery';
import { BannerProvider } from '@/components/ui/banner';
import { holdWrite, unexpectedWrite } from './held-write-boundary';

const OFFER_ID = '98400000-0000-4000-8000-000000000001';
const HOUR = 3_600_000;

/** The revision that replaced each revision the fixture shows, as the server reads it. */
const REPLACED_BY: Readonly<Record<number, number | null>> = { 1: 2, 2: null, 4: 5 };

export function readOfferRevisionDeliveryContract(input: unknown): unknown {
  const revision = input && typeof input === 'object' && 'revision' in input ? Number(input.revision) : 0;
  return {
    success: true,
    delivery: {
      list: {
        total: 1,
        entries: [
          {
            id: '98400000-0000-4000-8000-000000000601',
            channel: 'email',
            state: 'failed',
            recipient: 'verwaltung@lindenhof.example',
            subject: 'Angebot ANG-2037-0007 – Haustechnik Sonnenberg GmbH',
            note: '',
            attempts: 1,
            failureCode: 'email_provider_503',
            outcomeUnknown: false,
            createdAt: new Date(Date.now() - HOUR).toISOString(),
            sentAt: null,
            createdBy: 'Erika Musterfrau',
            retryFrom: new Date(Date.now() - HOUR).toISOString(),
            retryUntil: new Date(Date.now() + HOUR).toISOString(),
          },
        ],
      },
      defaults: {
        recipient: 'einkauf@lindenhof.example',
        subject: 'Angebot ANG-2037-0007 – Haustechnik Sonnenberg GmbH',
        text: 'Guten Tag,\n\nanbei unser Angebot ANG-2037-0007.',
      },
      replacedBy: REPLACED_BY[revision] ?? null,
    },
  };
}

export const sendOfferRevisionEmail = async (input: unknown) => {
  const refusal = await holdWrite('sendOfferRevisionEmail', input);
  return refusal
    ? { success: false as const, error: refusal }
    : { success: true as const, state: 'sent' as const, failureCode: null };
};

export const retryOfferRevisionDelivery = unexpectedWrite;

export function OfferDeliveryContractFixture(): React.JSX.Element {
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <section aria-label="Aktuelle Seite">
          <OfferRevisionDelivery
            offerId={OFFER_ID}
            revision={2}
            recipientName="Hausverwaltung Lindenhof GmbH"
            replacedBy={undefined}
          />
          <OfferRevisionDelivery
            offerId={OFFER_ID}
            revision={1}
            recipientName="Hausverwaltung Lindenhof GmbH"
            replacedBy={2}
          />
        </section>
        <section aria-label="Veraltete Seite">
          <OfferRevisionDelivery
            offerId={OFFER_ID}
            revision={4}
            recipientName="Hausverwaltung Lindenhof GmbH"
            replacedBy={undefined}
          />
        </section>
      </main>
    </BannerProvider>
  );
}
