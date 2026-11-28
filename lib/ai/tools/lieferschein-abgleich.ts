import 'server-only';

import { type ToolValue, recordText } from '@/lib/ai/context';
import type { Lieferschein } from '@/lib/ai/extract/lieferschein';
import { readDeliveryArticles, readDeliveryCatalogArticles } from '@/lib/inventory/delivery-articles';
import { lookupValues, matchDeliveryLine } from '@/lib/inventory/delivery-matching';
import { isInventoryUnitCode } from '@/lib/inventory/units';
import type { ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// The matching step of „Lieferschein lesen“ (werk-flow/werkflow-planning#535, KI-0 part 2):
// internal reads the model never calls. Own articles by the supplier's article number or EAN
// with their pack conversion, the unit list, and the wholesaler catalog for a line no own
// article carries. No price leaves this module.

/** Catalog lookups of one read, one per unmatched line in order. */
const MAX_CATALOG_LOOKUPS = 10;

/** The shortest number the catalog's trigram index narrows; a shorter one is not looked up. */
const MIN_CATALOG_NUMBER_LENGTH = 3;

/** What the catalog says about a line no own article carries. */
async function catalogMatch(ctx: ActionContext, number: string, signal: AbortSignal) {
  const found = await readDeliveryCatalogArticles(createSupabaseAdminClient(), ctx.orgId, number, signal);
  if (found === 'failed') return { katalog: null, hinweis: 'katalog_nicht_gelesen' } as const;
  const [article, ...more] = found;
  if (!article) return null;
  if (more.length > 0) return { katalog: null, hinweis: 'mehrmals_im_katalog' } as const;
  return {
    katalog: {
      lieferant: recordText(article.supplierName),
      name: recordText(article.name),
      einheit: isInventoryUnitCode(article.unit) ? article.unit : null,
    },
    hinweis: 'nur_im_katalog',
  } as const;
}

/**
 * Each line's match as the model and the card read it: the own article and its
 * base quantity, or the catalog article, and the problems by code, and whether
 * every catalog lookup could be read. Null when the articles could not be
 * read: the lines then stand unmatched.
 */
export async function matchedLines(
  ctx: ActionContext,
  lines: Lieferschein['positionen'],
  signal: AbortSignal,
): Promise<{ lines: ToolValue[]; catalogRead: boolean } | null> {
  const articles = await readDeliveryArticles(
    createSupabaseAdminClient(),
    ctx.orgId,
    {
      articleNumbers: lookupValues(lines.map((line) => line.artikelnummer)),
      eans: lookupValues(lines.map((line) => line.ean)),
    },
    signal,
  );
  if (articles === 'failed') return null;
  const matches = lines.map((line) => matchDeliveryLine(line, articles));
  // The catalog is the job-material picker's, which only admin and Büro search.
  const looked = ctx.isManagerOrAbove
    ? matches
        .flatMap((match, index) => {
          const number = lines[index]?.artikelnummer;
          return match.problems.includes('artikel_unbekannt') &&
            number &&
            number.length >= MIN_CATALOG_NUMBER_LENGTH
            ? [{ index, number }]
            : [];
        })
        .slice(0, MAX_CATALOG_LOOKUPS)
    : [];
  const catalog = new Map(
    await Promise.all(
      looked.map(async ({ index, number }) => [index, await catalogMatch(ctx, number, signal)] as const),
    ),
  );
  const catalogRead = [...catalog.values()].every((hit) => hit?.hinweis !== 'katalog_nicht_gelesen');
  const matchedLines = matches.map((match, index) => {
    const hit = catalog.get(index);
    return {
      artikel: match.article && {
        name: recordText(match.article.name),
        nummer: recordText(match.article.internalSku),
        einheit: match.article.unit,
      },
      gefundenUeber: match.via,
      mengeInBasiseinheit: match.baseQuantity,
      katalog: hit?.katalog ?? null,
      // A catalog article stands in for the missing own article; a failed or doubled lookup adds its doubt.
      hinweise: !hit
        ? match.problems
        : hit.hinweis === 'nur_im_katalog'
          ? match.problems.map((problem) => (problem === 'artikel_unbekannt' ? hit.hinweis : problem))
          : [...match.problems, hit.hinweis],
    };
  });
  return { lines: matchedLines, catalogRead };
}
