import { z } from '@/lib/zod';

// An Angebot without positions: number, title, customer, recipient, validity,
// texts and the responsible member
// (supabase/migrations/20261204100000_keep_offers_for_the_right_customer_and_recipient.sql).

/** Every status the database check allows; this release writes only `entwurf`. */
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
export const OFFER_WORK_KINDS = ['job', 'project', 'request'] as const;
export type OfferWorkKind = (typeof OFFER_WORK_KINDS)[number];
export const offerWorkKindSchema = z.enum(OFFER_WORK_KINDS);

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

export type OfferParty = { id: string; name: string };

export type OfferDetail = {
  id: string;
  offerNumber: string;
  title: string;
  status: OfferStatus;
  version: number;
  validUntil: string;
  openingText: string;
  closingText: string;
  client: OfferParty;
  site: (OfferParty & { address: string }) | null;
  contact: OfferParty | null;
  recipient: OfferParty & { address: string | null; isDefault: boolean };
  owner: { userId: string; name: string } | null;
  work: { kind: OfferWorkKind; id: string; label: string } | null;
};
