import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { customerPageSchema, type CustomerPage, type CustomerPageInput } from './list-page';

/**
 * Internal reader. The page, the GET handler and the header search authorize
 * the current manager first; the search reads a shorter page.
 */
export async function readCustomerPage(
  { organizationId, page, search, view }: CustomerPageInput,
  pageSize: number = LIST_PAGE_SIZE,
): Promise<CustomerPage> {
  const admin = createSupabaseAdminClient();
  const result = await admin.rpc('list_customer_page', {
    p_organization_id: organizationId,
    p_search: search,
    p_page: page,
    p_page_size: pageSize,
    p_archived: view === 'archiviert',
  });
  const parsed = customerPageSchema.safeParse(result.data);
  if (result.error || !parsed.success) throw new Error('customer_page_read_failed');
  if (parsed.data.clients.some((client) => client.organizationId !== organizationId))
    throw new Error('customer_page_scope_changed');
  return parsed.data;
}

const searchMatchSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  name: z.string(),
  /** The customer the record is filed under. */
  clientId: uuidSchema,
  clientName: z.string(),
});
const customerSearchMatchesSchema = z.object({
  sites: z.array(
    searchMatchSchema.extend({
      street: z.string().nullable(),
      postalCode: z.string().nullable(),
      city: z.string().nullable(),
    }),
  ),
  contacts: z.array(searchMatchSchema.extend({ email: z.string().nullable(), phone: z.string().nullable() })),
});
export type CustomerSearchMatches = z.infer<typeof customerSearchMatchesSchema>;

/**
 * Internal reader. The active Objekte and contacts of active customers that
 * the customer list's search matches, each limited on its own. The header
 * search authorizes the current manager first.
 */
export async function readCustomerSearchMatches(
  organizationId: string,
  search: string,
  limit: number,
): Promise<CustomerSearchMatches> {
  const admin = createSupabaseAdminClient();
  const result = await admin.rpc('search_customer_sites_and_contacts', {
    p_organization_id: organizationId,
    p_search: search,
    p_limit: limit,
  });
  const parsed = customerSearchMatchesSchema.safeParse(result.data);
  if (result.error || !parsed.success) throw new Error('customer_search_read_failed');
  const { sites, contacts } = parsed.data;
  if (sites.length > limit || contacts.length > limit) throw new Error('customer_search_read_failed');
  if ([...sites, ...contacts].some((match) => match.organizationId !== organizationId))
    throw new Error('customer_search_scope_changed');
  return parsed.data;
}
