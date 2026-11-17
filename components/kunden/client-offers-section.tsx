'use client';

import { FileText } from 'lucide-react';

import { OffersCards } from '@/components/angebote/offers-list';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SectionTitle } from '@/components/shared/section-title';
import { EmptyState } from '@/components/ui/empty-state';
import { TextLink } from '@/components/ui/text-link';
import type { OfferPage } from '@/lib/offers/list-page';

/**
 * The customer's newest offers. When it has more, the link opens the offer
 * list filtered to this customer, so none is hidden.
 */
export function ClientOffersSection({ clientId, offers }: { clientId: string; offers: OfferPage | null }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="size-4 text-muted-foreground" />
        <SectionTitle>Angebote</SectionTitle>
      </div>
      {!offers ? (
        <RegionLoadError>Die Angebote dieses Kunden konnten nicht geladen werden.</RegionLoadError>
      ) : offers.entries.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Keine Angebote"
          description="Für diesen Kunden gibt es noch kein Angebot."
        />
      ) : (
        <>
          <OffersCards entries={offers.entries} />
          {offers.total > offers.entries.length && (
            <TextLink href={`/angebote?kunde=${clientId}`}>Alle {offers.total} Angebote anzeigen</TextLink>
          )}
        </>
      )}
    </div>
  );
}
