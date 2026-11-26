import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

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
