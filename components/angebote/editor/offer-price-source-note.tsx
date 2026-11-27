import type { OfferPriceSource } from '@/lib/offers/types';
import { formatGermanDate } from '@/lib/utils';

/** „Listenpreis“, „Kundenkondition 2 ab 01.01.2027“ or „manuell“. */
function priceSourceLabel(priceSource: OfferPriceSource): string {
  if (priceSource.kind === 'listenpreis') return 'Listenpreis';
  if (priceSource.kind === 'manuell') return 'manuell';
  const { version, validFrom } = priceSource.condition;
  return `Kundenkondition ${String(version)} ab ${formatGermanDate(validFrom)}`;
}

/** Where a priced Position's price came from, for the office; no document shows it. */
export function PositionPriceSourceNote({ priceSource }: { priceSource: OfferPriceSource }) {
  return <p className="text-sm text-muted-foreground">Preis: {priceSourceLabel(priceSource)}</p>;
}
