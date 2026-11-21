import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import {
  DELIVERY_CHANNELS,
  DELIVERY_STATES,
  type DeliveryList,
  type DeliverySubject,
} from './delivery-types';

// The deliveries of one subject for its page. The page authorizes the
// current manager and resolves the organization first. A failed or malformed
// read throws; it never becomes an empty list.

/** The newest deliveries a page lists; the total names the ones it leaves out. */
const DELIVERY_LIST_LIMIT = 50;

const listSchema = z.object({
  total: z.number().int().nonnegative(),
  rows: z
    .array(
      z.object({
        id: uuidSchema,
        channel: z.enum(DELIVERY_CHANNELS),
        state: z.enum(DELIVERY_STATES),
        recipient: z.string().nullable(),
        subject: z.string().nullable(),
        note: z.string(),
        attempts: z.number().int(),
        failureCode: z.string().nullable(),
        createdAt: z.string(),
        sentAt: z.string().nullable(),
        createdBy: z.string().nullable(),
        retryFrom: z.string().nullable(),
        retryUntil: z.string().nullable(),
      }),
    )
    .max(DELIVERY_LIST_LIMIT),
});

export async function readDocumentDeliveries(
  organizationId: string,
  subject: DeliverySubject,
): Promise<DeliveryList> {
  const selected = await createSupabaseAdminClient().rpc('list_document_deliveries', {
    p_organization_id: organizationId,
    p_subject_kind: subject.kind,
    p_subject_id: subject.id,
    p_limit: DELIVERY_LIST_LIMIT,
  });
  const parsed = listSchema.safeParse(selected.data);
  if (selected.error || !parsed.success) throw new Error('delivery_list_read_failed');
  return { total: parsed.data.total, entries: parsed.data.rows };
}
