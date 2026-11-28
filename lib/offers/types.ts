import type { PriceQuantity } from '@/lib/inventory/line-amount';
import type { InvoiceLineSource, InvoiceLineSourceRef } from '@/lib/invoices/line-sources';
import type { InvoiceLineValues, InvoiceTaxRate } from '@/lib/invoices/types';
import type { CatalogPriceSource, PriceSourceClaim } from '@/lib/price-catalog/customer-conditions';
import { z } from '@/lib/zod';

// An Angebot: number, title, customer, recipient, validity, texts and the
// responsible member, and its content of Titel with Positionen
// (supabase/migrations/20261210130000_keep_offers_for_the_right_customer_and_recipient.sql,
// its header changes in 20261230110000_change_the_header_of_a_draft_offer.sql,
// its content in 20270201090000_write_titel_and_positionen_into_an_offer.sql,
// a Position's article in 20270301090000_take_offer_positions_from_articles.sql,
// its Leistung and its cost in 20270501090000_calculate_offers_with_leistungen_and_costs.sql,
// its price source in 20270601100000_price_new_offer_positions_by_customer_conditions.sql,
// its type in 20270701100000_keep_bedarfs_and_alternativpositionen_out_of_an_offer_total.sql,
// a Nachlass or Zuschlag in 20270701140000_add_discount_and_surcharge_positions_to_an_offer.sql).

/** Every status the database check allows; this release writes `entwurf` and `gesendet`. */
export const OFFER_STATUSES = ['entwurf', 'gesendet', 'angenommen', 'abgelehnt', 'zurueckgezogen'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
export const offerStatusSchema = z.enum(OFFER_STATUSES);

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  entwurf: 'Entwurf',
  gesendet: 'Gesendet',
  angenommen: 'Angenommen',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Zurückgezogen',
};

/** The work an offer can be written for. */
export const offerWorkKindSchema = z.enum(['job', 'project', 'request']);
export type OfferWorkKind = z.infer<typeof offerWorkKindSchema>;

export type OfferListEntry = {
  id: string;
  offerNumber: string;
  title: string;
  status: OfferStatus;
  clientId: string;
  clientName: string;
  /** The Rechnungsempfänger's name when it is not the customer. */
  recipientName: string | null;
  /** `YYYY-MM-DD`. */
  validUntil: string;
};

type OfferParty = { id: string; name: string };

/**
 * A Position's net cost per price quantity: an article's purchase price, a
 * Leistung's cost rate, or one the office typed. Office-only: no document of
 * the offer carries it.
 */
export type OfferPositionCost = { amountCents: number; priceQuantity: PriceQuantity };

/**
 * Where a priced Position's price came from, as the office's editor shows it:
 * the office's own („manuell“), or the list price or a customer's condition
 * with the server's proof that it priced this Position. Office-only.
 */
export type OfferPriceSource = { kind: 'manuell' } | (CatalogPriceSource & { proof: string });

/**
 * A priced Position's type. A normal one counts in the sums. A Bedarfsposition
 * is offered with its price, outside every sum. An Alternativposition is
 * offered instead of the normal priced Position at place `alternativeTo` of
 * its Titel (1 for the Titel's first line, text lines counted), with its
 * price and the difference, outside every sum.
 */
export type OfferPositionType =
  | { kind: 'normal' }
  | { kind: 'bedarf' }
  | { kind: 'alternative'; alternativeTo: number };

/**
 * A priced Position: Bezeichnung, Beschreibung, quantity in a unit of the
 * inventory list, a net price per price quantity and a VAT rate, the fields
 * of a priced invoice line. Typed by hand, or taken from an article or a
 * Leistung (`source`), whose values it keeps as its own, its cost and where
 * its price came from included.
 */
export type OfferFreePosition = { kind: 'free' } & InvoiceLineValues & {
    positionType: OfferPositionType;
    source: InvoiceLineSourceRef | null;
    cost: OfferPositionCost | null;
    priceSource: PriceSourceClaim;
  };
/** A text line: a note between the positions, without an amount. */
type OfferTextPosition = { kind: 'text'; name: string; description: string };

/**
 * A Nachlass (`rabatt`, it lowers the sum) or a Zuschlag (`zuschlag`, it
 * raises it): a percentage, in hundredths of a percent, of the normal priced
 * Positionen of its Titel (`titel`) or of the whole offer (`angebot`), or a
 * fixed net amount at a VAT rate of its own (`betrag`).
 */
export type OfferAdjustment = { direction: 'rabatt' | 'zuschlag' } & (
  | { scope: 'titel' | 'angebot'; percentHundredths: number }
  | { scope: 'betrag'; amountCents: number; taxRateBasisPoints: InvoiceTaxRate }
);
/** A Nachlass or Zuschlag Position: counted in its Titel's sum, without quantity, unit or cost. */
export type OfferAdjustmentPosition = {
  kind: 'adjustment';
  name: string;
  description: string;
  adjustment: OfferAdjustment;
};
export type OfferPosition = OfferFreePosition | OfferTextPosition | OfferAdjustmentPosition;
/** A Titel: a named section of the offer with its positions in order. */
export type OfferSection = { title: string; positions: OfferPosition[] };

/**
 * As stored and as a document may show it: a Position's article or Leistung
 * with its number, name and whether it is archived now, and no cost or price source.
 */
type OfferStoredPosition =
  | OfferTextPosition
  | OfferAdjustmentPosition
  | (Omit<OfferFreePosition, 'source' | 'cost' | 'priceSource'> & { source: InvoiceLineSource | null });
type OfferStoredSection = { title: string; positions: OfferStoredPosition[] };

/** As the office's editor reads it: each priced Position with its cost and price source. */
type OfferCostedPosition =
  | OfferTextPosition
  | OfferAdjustmentPosition
  | (Omit<OfferFreePosition, 'source' | 'priceSource'> & {
      source: InvoiceLineSource | null;
      priceSource: OfferPriceSource;
    });
export type OfferCostedSection = { title: string; positions: OfferCostedPosition[] };

export type OfferDetail = {
  id: string;
  offerNumber: string;
  title: string;
  status: OfferStatus;
  /** The version a header change names as the one its form was filled from. */
  version: number;
  /** The version of the Titel and Positionen, which a content save names; a header change keeps it. */
  contentVersion: number;
  validUntil: string;
  openingText: string;
  closingText: string;
  client: OfferParty;
  site: (OfferParty & { address: string }) | null;
  contact: OfferParty | null;
  /** `isDefault`: the recipient follows the Einsatzort's Rechnungsempfänger, else the customer. */
  recipient: OfferParty & { address: string | null; isDefault: boolean };
  owner: { userId: string; name: string } | null;
  work: { kind: OfferWorkKind; id: string; label: string } | null;
  sections: OfferStoredSection[];
};

/** An offer as the office's editor reads it (readOfferWithRevisions): each priced Position with its cost and price source. */
export type OfferWithCosts = Omit<OfferDetail, 'sections'> & { sections: OfferCostedSection[] };

/** How the office says it sent a revision; WerkFlow itself sends nothing. */
export const OFFER_CHANNELS = ['download', 'email', 'post', 'persoenlich'] as const;
export type OfferChannel = (typeof OFFER_CHANNELS)[number];

export const OFFER_CHANNEL_LABELS: Record<OfferChannel, string> = {
  download: 'Heruntergeladen',
  email: 'E-Mail aus eigenem Postfach',
  post: 'Post',
  persoenlich: 'Persönlich übergeben',
};

/** A sent revision as its list shows it; its PDF is a filed document of the library. */
export type OfferRevision = {
  revision: number;
  /** `YYYY-MM-DD`. */
  sentOn: string;
  channel: OfferChannel;
  validUntil: string;
  grossCents: number;
  recipientName: string;
  documentId: string;
  /** Null once the person's account is deleted. */
  sentBy: string | null;
};

/**
 * „Abgelaufen“: a sent offer whose validity ended before `todayIso`. Derived
 * from the date; nothing changes in the database.
 */
export function isOfferExpired(
  offer: { status: OfferStatus; validUntil: string },
  todayIso: string,
): boolean {
  return offer.status === 'gesendet' && offer.validUntil < todayIso;
}

/** Why a draft cannot be sent as it is: it has no Position, or its validity ended before `todayIso`. */
export function offerSendBlocker(
  offer: { sections: ReadonlyArray<{ positions: readonly unknown[] }>; validUntil: string },
  todayIso: string,
): 'offer_empty' | 'offer_expired' | null {
  if (!offer.sections.some((section) => section.positions.length > 0)) return 'offer_empty';
  if (offer.validUntil < todayIso) return 'offer_expired';
  return null;
}
