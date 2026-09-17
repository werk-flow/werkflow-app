import { z } from 'zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import type { Client } from '@/lib/jobs/types';

export const customerPageInputSchema = z.object({
  organizationId: uuidSchema,
  page: z.coerce.number().int().min(1).max(1_000_000),
  search: z.string().trim().max(250),
});
export type CustomerPageInput = z.infer<typeof customerPageInputSchema>;

const clientSchema: z.ZodType<Client> = z.object({
  id: uuidSchema, organizationId: uuidSchema, name: z.string(),
  clientType: z.enum(['privat', 'gewerblich']), customerNumber: z.string().nullable(),
  email: z.string().nullable(), phone: z.string().nullable(), address: z.string().nullable(),
  notes: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
});
export const customerPageSchema = z.object({
  clients: z.array(clientSchema).max(LIST_PAGE_SIZE),
  total: z.number().int().nonnegative(),
});
export type CustomerPage = z.infer<typeof customerPageSchema>;

export async function fetchCustomerPage(input: CustomerPageInput, signal: AbortSignal): Promise<CustomerPage> {
  const query = new URLSearchParams({ organizationId: input.organizationId, page: String(input.page), search: input.search });
  const response = await fetch(`/api/customer-page?${query}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('customer_page_read_failed');
  const data = customerPageSchema.parse(await response.json());
  if (data.clients.some(client => client.organizationId !== input.organizationId)) throw new Error('customer_page_scope_changed');
  return data;
}
