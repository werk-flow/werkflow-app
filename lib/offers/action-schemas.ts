import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { offerWorkKindSchema } from './types';

// The inputs of the offer actions. The forms check title and customer before
// they submit; the server parses every input again.

const optionalId = uuidSchema.nullable();
const work = z.object({ kind: offerWorkKindSchema, id: uuidSchema }).nullable();

export const createOfferSchema = z.object({
  /** One key per opening of the create dialog: a retried press returns the first offer. */
  attemptKey: uuidSchema,
  title: z.string().trim().min(1).max(200),
  clientId: uuidSchema,
  siteId: optionalId,
  contactId: optionalId,
});

export const updateOfferSchema = z.object({
  offerId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  /** One key per save: a retried press returns the first save's version. */
  attemptKey: uuidSchema,
  title: z.string().trim().min(1).max(200),
  clientId: uuidSchema,
  siteId: optionalId,
  contactId: optionalId,
  /** `null` takes the default: the Einsatzort's Rechnungsempfänger, else the customer. */
  recipientClientId: optionalId,
  validUntil: z.iso.date(),
  openingText: z.string().max(4000),
  closingText: z.string().max(4000),
  ownerUserId: uuidSchema,
  work,
});

export type CreateOfferInput = z.input<typeof createOfferSchema>;
export type UpdateOfferInput = z.input<typeof updateOfferSchema>;
