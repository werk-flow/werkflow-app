import 'server-only';

import { type ToolValue, recordText } from '@/lib/ai/context';
import type { Lieferschein } from '@/lib/ai/extract/lieferschein';
import { readDeliveryArticles } from '@/lib/inventory/delivery-articles';
import { matchDeliveryLine } from '@/lib/inventory/delivery-matching';
import { searchSupplierCatalogAs } from '@/lib/inventory/supplier-catalog-search';
import type { ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// The matching step of „Lieferschein lesen“ (werk-flow/werkflow-planning#535, KI-0 part 2):
// three internal reads the model never calls. Own articles by the supplier's article number
// or EAN with their pack conversion, the unit list, and the wholesaler catalog for a line no
// own article carries. No price leaves this module.

/** Catalog searches of one read, one per unmatched line in order: each is a trigram search. */
const MAX_CATALOG_SEARCHES = 10;

/** The catalog article whose number is the line's, by the search of the job-material picker. */
async function catalogArticle(ctx: ActionContext, articleNumber: string) {
  const found = await searchSupplierCatalogAs(ctx, articleNumber);
  if (!found.success) return 'failed' as const;
  const wanted = articleNumber.trim().toLowerCase();
  return found.options.find((option) => option.articleNumber.trim().toLowerCase() === wanted) ?? null;
}

/**
 * Each line's match as the model and the card read it: the own article and its
 * base quantity, or the catalog article, and the problems by code. Null when
 * the articles could not be read: the lines then stand unmatched.
 */
export async function matchedLines(
  ctx: ActionContext,
  lines: Lieferschein['positionen'],
): Promise<ToolValue[] | null> {
  const named = (values: Array<string | null>) => [...new Set(values.filter((value) => value !== null))];
  const articles = await readDeliveryArticles(createSupabaseAdminClient(), ctx.orgId, {
    articleNumbers: named(lines.map((line) => line.artikelnummer)),
    eans: named(lines.map((line) => line.ean)),
  });
  if (articles === 'failed') return null;
  const matches = lines.map((line) => matchDeliveryLine(line, articles));
  const searched = matches
    .flatMap((match, index) => {
      const number = lines[index]?.artikelnummer;
      return match.problems.includes('artikel_unbekannt') && number && number.length >= 3
        ? [{ index, number }]
        : [];
    })
    .slice(0, MAX_CATALOG_SEARCHES);
  const catalog = new Map(
    await Promise.all(
      searched.map(async ({ index, number }) => [index, await catalogArticle(ctx, number)] as const),
    ),
  );
  return matches.map((match, index) => {
    const hit = catalog.get(index);
    return {
      artikel: match.article && {
        name: recordText(match.article.name),
        nummer: recordText(match.article.internalSku),
        einheit: match.article.unit,
      },
      gefundenUeber: match.via,
      mengeInBasiseinheit: match.baseQuantity,
      katalog:
        hit && hit !== 'failed'
          ? { lieferant: recordText(hit.supplierName), name: recordText(hit.name), einheit: hit.unit }
          : null,
      hinweise: match.problems.map((problem) =>
        problem === 'artikel_unbekannt' && hit && hit !== 'failed' ? 'nur_im_katalog' : problem,
      ),
    };
  });
}
