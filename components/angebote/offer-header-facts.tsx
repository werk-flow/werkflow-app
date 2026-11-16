'use client';

import { MetadataSection } from '@/components/shared/metadata-section';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import type { OfferDetail } from '@/lib/offers/types';
import { formatGermanDate } from '@/lib/utils';

function withAddress(name: string, address: string | null) {
  return (
    <>
      <span className="block">{name}</span>
      {address && <span className="block text-muted-foreground">{address}</span>}
    </>
  );
}

/** The header of one offer; another session's change to it or a record it names reads the page again. */
export function OfferHeaderFacts({ offer }: { offer: OfferDetail }) {
  // The header shows the current names and addresses of customer, Objekt, contact and responsible person.
  useRealtimeRouterRefresh({ tables: ['offers', 'clients', 'client_sites', 'client_contacts', 'profiles'] });
  return (
    <MetadataSection
      title="Angebotskopf"
      isEditable={false}
      fields={[
        { label: 'Kunde', value: offer.client.name },
        { label: 'Einsatzort', value: offer.site ? withAddress(offer.site.name, offer.site.address) : '—' },
        { label: 'Ansprechpartner', value: offer.contact?.name ?? '—' },
        {
          label: 'Rechnungsempfänger',
          value: withAddress(offer.recipient.name, offer.recipient.address),
        },
        { label: 'Gültig bis', value: formatGermanDate(offer.validUntil) },
        { label: 'Verantwortlich', value: offer.owner?.name ?? '—' },
        ...(offer.work ? [{ label: 'Geschrieben für', value: offer.work.label }] : []),
        { label: 'Einleitung', value: offer.openingText || '—' },
        { label: 'Schluss', value: offer.closingText || '—' },
      ]}
    />
  );
}
