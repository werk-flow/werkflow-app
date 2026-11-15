import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
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
