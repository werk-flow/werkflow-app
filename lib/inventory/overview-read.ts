import 'server-only';

import { logReadErrors } from '@/lib/data/read-request-cache';
import type { AdminClient } from '@/lib/supabase/admin';
import { loadArticleTermsPage, loadInventoryOverviewLists } from './catalog-reads';
import { inventoryPageResultSchema, type InventoryPageQuery } from './list-page';
import type { InventoryOverview } from './types';

/**
 * One page of `/inventar` for `query` in the caller's organization, with the
 * listed articles' supplier references and prices. It only reads: the page's
 * action creates the default categories and Lager first, and WerkFlow KI's
 * `artikel_finden` writes nothing. The caller authorizes Admin or Büro.
 */
export async function readInventoryOverview(
  admin: AdminClient,
  orgId: string,
  query: InventoryPageQuery,
): Promise<InventoryOverview | 'inventory_failed'> {
  const pageResult = await admin.rpc('list_inventory_page', { p_organization_id: orgId, p_query: query });
  if (pageResult.error) {
    logReadErrors('readInventoryOverview: read failed', pageResult.error);
    return 'inventory_failed';
  }
  const parsedPage = inventoryPageResultSchema.safeParse(pageResult.data);
  if (!parsedPage.success) return 'inventory_failed';
  const page = parsedPage.data;
  const [lists, articleTerms] = await Promise.all([
    loadInventoryOverviewLists(admin, orgId, page),
    loadArticleTermsPage(admin, orgId, page.ids),
  ]);
  if (!lists.success) return 'inventory_failed';
  return {
    categories: lists.categories,
    locations: lists.locations,
    suppliers: lists.suppliers,
    items: lists.items,
    articleTerms,
    summary: page.summary,
    page: {
      query,
      ids: page.ids,
      total: page.total,
      locationIds: page.locationIds,
      locationCounts: page.locationCounts,
    },
  };
}
