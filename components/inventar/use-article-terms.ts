'use client';

import { useBanner } from '@/components/ui/banner';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import type { ActionResult } from '@/lib/action-result';
import { addArticlePrice, removeArticleSupplier, saveArticleSupplier } from '@/lib/inventory/catalog-actions';
import type { AddArticlePriceInput, SaveArticleSupplierInput } from '@/lib/inventory/action-schemas';
import type { ArticleTermsPage } from '@/lib/inventory/article-price-terms';

export type ArticleTermWrites = {
  saveSupplier: (input: SaveArticleSupplierInput) => Promise<ActionResult<{ referenceId: string }> | null>;
  removeSupplier: (referenceId: string) => Promise<ActionResult | null>;
  addPrice: (input: AddArticlePriceInput) => Promise<ActionResult<{ priceId: string }> | null>;
};

/**
 * The writes of the article dialog's „Lieferanten“ and „Preise“. Each action
 * revalidates the inventory route, so its response carries the new terms: a
 * write resolves once they are on screen, then the banner confirms it. The
 * caller binds its pending state to the returned promise.
 */
export function useArticleTerms(terms: ArticleTermsPage): ArticleTermWrites {
  const { showBanner } = useBanner();
  const waitForTerms = useSettleOnChange(terms);

  async function settled<Result extends ActionResult<object>>(
    write: Promise<Result>,
    message: string,
  ): Promise<Result | null> {
    const since = waitForTerms.markChange();
    const result = await write.catch(() => null);
    if (!result?.success) return result;
    // A refresh that never lands keeps its warning banner instead of a success.
    if (await waitForTerms.confirmChange(since)) showBanner({ variant: 'success', message });
    return result;
  }

  return {
    saveSupplier: (input) => settled(saveArticleSupplier(input), 'Der Lieferant wurde gespeichert.'),
    removeSupplier: (referenceId: string) =>
      settled(removeArticleSupplier({ referenceId }), 'Der Lieferant wurde entfernt.'),
    addPrice: (input) => settled(addArticlePrice(input), 'Der Preis wurde gespeichert.'),
  };
}
