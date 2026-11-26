import { PRICE_QUANTITIES } from '@/lib/inventory/article-price-terms';
import { isInventoryUnitCode } from '@/lib/inventory/units';
import { INVOICE_TAX_RATES } from '@/lib/invoices/types';
import { MAX_PRICE_CENTS } from '@/lib/price-catalog/money';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { contentFitsOneSave, OFFER_CONTENT_LIMITS } from './content-form';

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

/** A position typed by hand, with the limits of an invoice line; a negative quantity credits. */
const freePositionSchema = z.object({
  kind: z.literal('free'),
  ...positionTextSchema,
  quantity: z.string().regex(/^-?\d{1,9}(?:\.\d{1,3})?$/),
  unit: z.string().refine(isInventoryUnitCode),
  unitPriceCents: z.number().int().min(0).max(MAX_PRICE_CENTS),
  priceQuantity: z.literal(PRICE_QUANTITIES),
  taxRateBasisPoints: z.literal(INVOICE_TAX_RATES),
});

const textPositionSchema = z.object({ kind: z.literal('text'), ...positionTextSchema });

/** A Titel with its positions, as the save takes it and the reader parses it. */
export const offerSectionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  positions: z
    .array(z.discriminatedUnion('kind', [freePositionSchema, textPositionSchema]))
    .max(OFFER_CONTENT_LIMITS.positionsPerSection),
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
