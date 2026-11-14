import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The input of the offer create. The forms check title and customer before
// they submit; the server parses every input again.

const optionalId = uuidSchema.nullable();

export const createOfferSchema = z.object({
  /** One key per opening of the create dialog: a retried press returns the first offer. */
  attemptKey: uuidSchema,
  title: z.string().trim().min(1).max(200),
  clientId: uuidSchema,
  siteId: optionalId,
  contactId: optionalId,
});

export type CreateOfferInput = z.input<typeof createOfferSchema>;
