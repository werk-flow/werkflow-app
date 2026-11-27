import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PriceQuantity } from '@/lib/inventory/line-amount';
import { getSupabaseSecretKey } from '@/lib/env/server';
import type { PriceSourceKind } from './customer-conditions';

// The server's proof of where an offer Position's price came from. The
// catalog read signs the price it resolved, and the offer read signs each
// stored source again, so a save keeps a source only for the offer, catalog
// entry, version, price and price quantity the server answered. Any other
// price, typed or sent by any caller, is stored as „manuell“
// (lib/offers/content-writes.ts).

type ProvenSource = {
  organizationId: string;
  offerId: string;
  entry: { kind: 'article' | 'leistung'; id: string };
  kind: Exclude<PriceSourceKind, 'manuell'>;
  conditionId: string | null;
  unitPriceCents: number;
  priceQuantity: PriceQuantity;
};

function secret(): Buffer {
  return createHmac('sha256', getSupabaseSecretKey()).update('werkflow:offer-price-source:v1').digest();
}

/** Every field in a fixed order, so equal sources sign alike. */
function signature(source: ProvenSource): Buffer {
  const fields = [
    source.organizationId,
    source.offerId,
    source.entry.kind,
    source.entry.id,
    source.kind,
    source.conditionId ?? '',
    String(source.unitPriceCents),
    String(source.priceQuantity),
  ];
  return createHmac('sha256', secret()).update(JSON.stringify(fields)).digest();
}

export function signPriceSource(source: ProvenSource): string {
  return signature(source).toString('base64url');
}

/** Whether `proof` is the server's signature of exactly this source. */
export function isProvenPriceSource(proof: string, source: ProvenSource): boolean {
  const supplied = Buffer.from(proof, 'base64url');
  const expected = signature(source);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
