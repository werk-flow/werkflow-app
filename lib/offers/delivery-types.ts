import type { DeliveryView } from '@/lib/delivery/delivery-types';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The input that names a sent revision and its „Versand“ read, shared by the client and the server.

/** A sent revision as the offer page names it: its offer and its number. */
export const offerRevisionRefSchema = z.object({ offerId: uuidSchema, revision: z.number().int().min(1) });

/** „Versand“ of one revision, with the revision that replaced it; null while it is the newest. */
export type OfferRevisionDelivery = DeliveryView & { replacedBy: number | null };
