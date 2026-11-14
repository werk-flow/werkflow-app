import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  catalogRowSchema,
  SUPPLIER_CATALOG_SEARCH_LIMIT,
  SUPPLIER_CATALOG_SEARCH_MIN_LENGTH,
  supplierCatalogSearchInputSchema,
  type SupplierCatalogOption,
} from './wholesaler-import-schemas';

// The search of the imported wholesaler catalogs for the job-material picker
// (werk-flow/werkflow-planning#375), read in the background
// (lib/data/background-reads.ts). Admin and Büro only: a field worker is
// refused, and the table holds no client grant either. One database function
// searches the text literally and reads the trigram index;
// supabase/tests/inventory_supplier_catalog_search.sql proves both at 200 000 rows.

/** The catalog rows whose number, texts, EAN or matchcode contain the search, in name order. */
export async function searchSupplierCatalog(
  search: string,
): Promise<ActionResult<{ options: SupplierCatalogOption[]; hasMore: boolean }>> {
  const parsed = supplierCatalogSearchInputSchema.safeParse({ search });
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveActionContext();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const term = parsed.data.search.trim().toLowerCase();
  if (term.length < SUPPLIER_CATALOG_SEARCH_MIN_LENGTH) return { success: true, options: [], hasMore: false };

  const { data, error } = await createSupabaseAdminClient().rpc('search_supplier_catalog_articles', {
    p_organization_id: auth.context.orgId,
    p_search: term,
    // One row more than shown tells the picker that more rows match.
    p_limit: SUPPLIER_CATALOG_SEARCH_LIMIT + 1,
  });
  if (error) {
    logError('searchSupplierCatalog: read failed', error);
    return { success: false, error: 'load_failed' };
  }
  const rows = catalogRowSchema.array().safeParse(data);
  if (!rows.success) {
    logError('searchSupplierCatalog: unexpected row shape');
    return { success: false, error: 'load_failed' };
  }
  return {
    success: true,
    options: rows.data.slice(0, SUPPLIER_CATALOG_SEARCH_LIMIT),
    hasMore: rows.data.length > SUPPLIER_CATALOG_SEARCH_LIMIT,
  };
}
