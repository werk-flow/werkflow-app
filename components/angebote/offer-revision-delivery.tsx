'use client';

import { Send } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { DELIVERY_REFUSALS } from '@/components/delivery/delivery-messages';
import { DocumentDeliveryDialog } from '@/components/delivery/document-delivery-dialog';
import { Button } from '@/components/ui/button';
import { readInBackground } from '@/lib/data/background-read-client';
import { retryOfferRevisionDelivery, sendOfferRevisionEmail } from '@/lib/offers/delivery-actions';

// „Versenden“ of a sent offer revision through E2c's delivery (lib/delivery/):
// its sends with their state, „Erneut senden“ for a failed one and „Per
// E-Mail senden“ with the revision's filed PDF. The offer's own record of
// how it went out („Als gesendet festhalten“) stays E2a's. A revision a
// later one replaced lists its sends and takes no new one.

const OFFER_DELIVERY_FAILURES: Readonly<Record<string, string>> = {
  ...DELIVERY_REFUSALS,
  offer_revision_not_found: 'Diese Revision gibt es nicht mehr. Lade die Seite neu.',
  offer_revision_superseded:
    'Inzwischen gibt es eine neuere Revision dieses Angebots. Lade die Seite neu und versende die neueste.',
  document_not_found:
    'Das abgelegte PDF dieser Revision lässt sich nicht versenden. Prüfe es unter „PDF öffnen“.',
  delivery_retry_expired:
    'Der Versand ist älter als einen Tag und lässt sich nicht mehr wiederholen. Sende das Angebot bei Bedarf neu per E-Mail.',
};

export function OfferRevisionDelivery({
  offerId,
  revision,
  recipientName,
  replacedBy,
}: {
  offerId: string;
  revision: number;
  recipientName: string;
  /** The revision that replaced this one as the page knows it; it then takes no new send. */
  replacedBy: number | undefined;
}): ReactElement {
  const [open, setOpen] = useState(false);
  // A stale page learns of a later revision from the dialog's own read, and turns read-only too.
  const [readReplacedBy, setReadReplacedBy] = useState<number | null>(null);
  const closedBy = replacedBy ?? readReplacedBy;
  const replaced = closedBy !== null;
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {!replaced && <Send className="size-4" />}
        {replaced ? 'Versand ansehen' : 'Versenden'}
      </Button>
      {open && (
        <DocumentDeliveryDialog
          onClose={() => setOpen(false)}
          host={{
            title: 'Angebot versenden',
            label: `Revision ${revision} an ${recipientName}`,
            documentName: 'Das Angebot',
            descriptions: {
              overview: 'Das Angebot hängt als PDF an, genau wie diese Revision abgelegt ist.',
              email:
                'Das Angebot hängt als PDF an, genau wie diese Revision abgelegt ist. Prüfe Empfänger und Text.',
            },
            empty:
              closedBy !== null
                ? {
                    title: 'Kein Versand per E-Mail.',
                    description: 'Diese Revision ging nicht aus WerkFlow per E-Mail raus.',
                  }
                : {
                    title: 'Noch kein Versand per E-Mail.',
                    description: 'Mit „Per E-Mail senden“ geht diese Revision als PDF an den Kunden.',
                  },
            failures: OFFER_DELIVERY_FAILURES,
            loadFailure: 'Der Versand dieser Revision konnte nicht geladen werden.',
            read: async (signal) => {
              const result = await readInBackground('offer-revision-delivery', { offerId, revision }, signal);
              if (result.success) setReadReplacedBy(result.delivery.replacedBy);
              return result;
            },
            readKey: [offerId, revision],
            ...(closedBy !== null
              ? { closed: `Ersetzt durch Revision ${closedBy}, versendet wird nur die neueste Revision.` }
              : {}),
          }}
          send={(input) => sendOfferRevisionEmail({ offerId, revision, ...input })}
          retry={(input) => retryOfferRevisionDelivery(input)}
        />
      )}
    </>
  );
}
