'use server';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { loadInventoryPickerOptions } from './catalog-reads';
import type { InventoryPickerOption } from './types';
import {
  adoptAnswerSchema,
  adoptSupplierCatalogArticleInputSchema,
  type AdoptSupplierCatalogArticleInput,
} from './wholesaler-import-schemas';
import { invalidateInventory } from './write-support';

// A supplier catalog row becomes an own article on first use
// (werk-flow/werkflow-planning#375). Admin and Büro only; the search lives in
// ./supplier-catalog-search. The tables hold no client grant either.

const refusal = writeRefusalFor(new Set(['not_authorized', 'catalog_article_not_found', 'item_archived']));

/**
 * Turns a catalog row into an own article with its supplier reference and
 * price, once; a repeat answers the article the first one made. The answer
 * carries the article as the picker shows it.
 */
export async function adoptSupplierCatalogArticle(
  rawInput: AdoptSupplierCatalogArticleInput,
): Promise<ActionResult<{ created: boolean; item: InventoryPickerOption }>> {
  const parsed = adoptSupplierCatalogArticleInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveActionContext();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    'adopt_supplier_catalog_article',
    rpcArgs('adopt_supplier_catalog_article', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_catalog_article_id: parsed.data.catalogArticleId,
    }),
  );
  if (error) return refusal(error, 'save_failed', 'adoptSupplierCatalogArticle: adopt failed');
  const answer = adoptAnswerSchema.safeParse(data);
  if (!answer.success) {
    logError('adoptSupplierCatalogArticle: unexpected answer shape');
    return { success: false, error: 'save_failed' };
  }
  if (answer.data.created) invalidateInventory();

  const read = await loadInventoryPickerOptions(admin, auth.context.orgId, true, {
    itemLimit: 1,
    exactItemId: answer.data.itemId,
  });
  if (!read.success) return { success: false, error: 'load_failed' };
  const [item] = read.items;
  if (!item) return { success: false, error: 'load_failed' };
  return { success: true, created: answer.data.created, item };
}
