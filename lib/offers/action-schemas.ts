import { PRICE_QUANTITIES } from '@/lib/inventory/article-price-terms';
import { isInventoryUnitCode } from '@/lib/inventory/units';
import { invoiceLineSourceRefSchema, invoiceLineSourceSchema } from '@/lib/invoices/line-sources';
import { INVOICE_TAX_RATES } from '@/lib/invoices/types';
import { MAX_PRICE_CENTS } from '@/lib/price-catalog/money';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { MAX_COST_CENTS } from './calculation';
import { contentFitsOneSave, OFFER_CONTENT_LIMITS } from './content-form';
import { OFFER_CHANNELS } from './types';

// The inputs of the offer actions. The forms check title, customer and the
// header's required fields before they submit; the server parses every input again.

const optionalId = uuidSchema.nullable();

export const createOfferSchema = z.object({
  /** One key per opening of the create dialog: a retried press returns the first offer. */
  attemptKey: uuidSchema,
  title: z.string().trim().min(1).max(200),
  clientId: uuidSchema,
  siteId: optionalId,
  contactId: optionalId,
});

/** The header of an offer in „Entwurf“; its customer and work stay as they are. */
export const updateOfferSchema = z.object({
  offerId: uuidSchema,
  /** The version the form was filled from: a save another session made meanwhile refuses this one. */
  expectedVersion: z.number().int().positive(),
  /** One key per save: a retried press answers with the first save's version. */
  attemptKey: uuidSchema,
  title: z.string().trim().min(1).max(200),
  siteId: optionalId,
  contactId: optionalId,
  /** `null` follows the default: the Einsatzort's Rechnungsempfänger, else the customer. */
  recipientClientId: optionalId,
  validUntil: z.iso.date(),
  openingText: z.string().max(4000),
  closingText: z.string().max(4000),
  ownerUserId: uuidSchema,
});

export type CreateOfferInput = z.input<typeof createOfferSchema>;
export type UpdateOfferInput = z.input<typeof updateOfferSchema>;

const positionTextSchema = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000),
};

/** A Position's net cost per price quantity (OfferPositionCost), as the cost store keeps any article price. */
export const positionCostSchema = z.object({
  amountCents: z.number().int().min(0).max(MAX_COST_CENTS),
  priceQuantity: z.literal(PRICE_QUANTITIES),
});

const priceCents = z.number().int().min(0).max(MAX_PRICE_CENTS);
/** A base64url HMAC-SHA256 (lib/price-catalog/price-source-proof.ts). */
const proofSchema = z.string().regex(/^[\w-]{43}$/);

/** A priced Position's type (OfferPositionType); an Alternativposition names a place in its Titel. */
const positionTypeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('normal') }),
  z.object({ kind: z.literal('bedarf') }),
  z.object({
    kind: z.literal('alternative'),
    alternativeTo: z.number().int().min(1).max(OFFER_CONTENT_LIMITS.positionsPerSection),
  }),
]);

/** A priced position, with the limits of an invoice line; a negative quantity credits. */
const freePositionSchema = z.object({
  kind: z.literal('free'),
  ...positionTextSchema,
  /**
   * Required like the cost: a payload without the key, from a tab older than
   * the types, would otherwise count a Bedarfs- or Alternativposition in the sums.
   */
  positionType: positionTypeSchema,
  quantity: z.string().regex(/^-?\d{1,9}(?:\.\d{1,3})?$/),
  unit: z.string().refine(isInventoryUnitCode),
  unitPriceCents: priceCents,
  priceQuantity: z.literal(PRICE_QUANTITIES),
  taxRateBasisPoints: z.literal(INVOICE_TAX_RATES),
  /** The article or Leistung it was taken from, inside the caller's organization (the save checks); null for one typed by hand. */
  source: invoiceLineSourceRefSchema.nullable().default(null),
  /**
   * Office-only; null while the office knows none. Required: a payload without
   * the key, from a tab older than stored costs, would otherwise clear them.
   */
  cost: positionCostSchema.nullable(),
  /**
   * Where the price came from, with the server's proof; the save stores
   * „manuell“ for a source it did not prove (content-writes.ts). Required like the cost.
   */
  priceSource: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('manuell') }),
    z.object({ kind: z.literal('listenpreis'), proof: proofSchema }),
    z.object({ kind: z.literal('kundenkondition'), conditionId: uuidSchema, proof: proofSchema }),
  ]),
});

const textPositionSchema = z.object({ kind: z.literal('text'), ...positionTextSchema });

const sectionFields = { title: z.string().trim().min(1).max(200) };

/** Whether an Alternativposition's place names a normal priced Position of the same Titel. */
function namesNormalPosition(
  positions: ReadonlyArray<{ kind: 'text' } | { kind: 'free'; positionType: { kind: string } }>,
  place: number,
): boolean {
  const base = positions[place - 1];
  return base?.kind === 'free' && base.positionType.kind === 'normal';
}

/** A Titel with its positions, as the save takes it; an Alternativposition names a normal Position of it. */
const offerSectionSchema = z.object({
  ...sectionFields,
  positions: z
    .array(z.discriminatedUnion('kind', [freePositionSchema, textPositionSchema]))
    .max(OFFER_CONTENT_LIMITS.positionsPerSection)
    .refine((positions) =>
      positions.every(
        (position) =>
          position.kind === 'text' ||
          position.positionType.kind !== 'alternative' ||
          namesNormalPosition(positions, position.positionType.alternativeTo),
      ),
    ),
});

/**
 * A Titel as `get_offer` answers it: each Position's article or Leistung with
 * its number, name and archive state, its type („normal“ when absent), and no
 * cost or price source.
 */
export const storedSectionSchema = z.object({
  ...sectionFields,
  positions: z.array(
    z.discriminatedUnion('kind', [
      freePositionSchema.omit({ cost: true, priceSource: true }).extend({
        source: invoiceLineSourceSchema.nullable(),
        positionType: positionTypeSchema.default({ kind: 'normal' }),
      }),
      textPositionSchema,
    ]),
  ),
});

/** The whole content of an offer in „Entwurf“: its Titel in order, each with its Positionen in order. */
export const saveOfferContentSchema = z.object({
  offerId: uuidSchema,
  /** The content version the editor was filled from: a content save another session made meanwhile refuses this one. */
  expectedContentVersion: z.number().int().positive(),
  /** One key per save: a retried press, or a retried tool call, answers with the first save. */
  attemptKey: uuidSchema,
  sections: z
    .array(offerSectionSchema)
    .max(OFFER_CONTENT_LIMITS.sections)
    .refine(
      (sections) =>
        sections.reduce((count, section) => count + section.positions.length, 0) <=
        OFFER_CONTENT_LIMITS.positions,
    )
    // The editor's byte limit holds for every caller, so no saved offer is one the editor cannot save again.
    .refine(contentFitsOneSave),
});

export type SaveOfferContentInput = z.input<typeof saveOfferContentSchema>;

/** „Als gesendet festhalten“ of a draft at the versions its page showed. */
export const sendOfferSchema = z.object({
  offerId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  expectedContentVersion: z.number().int().positive(),
  channel: z.enum(OFFER_CHANNELS),
  /** SHA-256 of the preview the office saw: a send whose rendering differs is refused, never filed. */
  previewHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** One key per opening of the dialog: a press repeated after a lost answer gets the first revision. */
  attemptKey: uuidSchema,
});

export type SendOfferInput = z.input<typeof sendOfferSchema>;
