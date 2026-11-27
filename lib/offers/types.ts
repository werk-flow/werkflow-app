import type { PriceQuantity } from '@/lib/inventory/line-amount';
import type { InvoiceLineSource, InvoiceLineSourceRef } from '@/lib/invoices/line-sources';
import type { InvoiceLineValues } from '@/lib/invoices/types';
import { z } from '@/lib/zod';

// An Angebot: number, title, customer, recipient, validity, texts and the
// responsible member, and its content of Titel with Positionen
// (supabase/migrations/20261210130000_keep_offers_for_the_right_customer_and_recipient.sql,
// its header changes in 20261230110000_change_the_header_of_a_draft_offer.sql,
// its content in 20270201090000_write_titel_and_positionen_into_an_offer.sql,
// a Position's article in 20270301090000_take_offer_positions_from_articles.sql,
// its Leistung and its cost in 20270501090000_calculate_offers_with_leistungen_and_costs.sql).

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
 * A priced Position: Bezeichnung, Beschreibung, quantity in a unit of the
 * inventory list, a net price per price quantity and a VAT rate, the fields
 * of a priced invoice line. Typed by hand, or taken from an article or a
 * Leistung (`source`), whose values it keeps as its own, its cost included.
 */
export type OfferFreePosition = { kind: 'free' } & InvoiceLineValues & {
    source: InvoiceLineSourceRef | null;
    cost: OfferPositionCost | null;
  };
/** A text line: a note between the positions, without an amount. */
type OfferTextPosition = { kind: 'text'; name: string; description: string };
export type OfferPosition = OfferFreePosition | OfferTextPosition;
/** A Titel: a named section of the offer with its positions in order. */
export type OfferSection = { title: string; positions: OfferPosition[] };

/**
 * As stored and as a document may show it: a Position's article or Leistung
 * with its number, name and whether it is archived now, and no cost.
 */
type OfferStoredPosition =
  | OfferTextPosition
  | (Omit<OfferFreePosition, 'source' | 'cost'> & { source: InvoiceLineSource | null });
type OfferStoredSection = { title: string; positions: OfferStoredPosition[] };

/** As the office's editor reads it: each priced Position with its cost. */
type OfferCostedPosition =
  | OfferTextPosition
  | (Omit<OfferFreePosition, 'source'> & { source: InvoiceLineSource | null });
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

/** An offer as the office's editor reads it (readOfferWithRevisions): the same, each priced Position with its cost. */
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
