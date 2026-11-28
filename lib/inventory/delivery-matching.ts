import type { DeliveryArticle } from './delivery-articles';
import { normalizeInventoryUnitInput } from './units';

// Matches one delivered line to an own article (werk-flow/werkflow-planning#535): by the
// supplier's article number, else by EAN, then converts the delivered quantity into the
// article's base unit through the supplier reference's pack. Every doubt is a problem
// code; nothing here books or changes stock.

/** A delivered line as the Lieferschein states it. */
export type DeliveryLine = {
  artikelnummer: string | null;
  ean: string | null;
  menge: number | null;
  einheit: string | null;
  packungsinhalt: number | null;
};

type DeliveryProblem =
  /** No own article carries the number or EAN. */
  | 'artikel_unbekannt'
  /** Several own articles carry it. */
  | 'mehrdeutig'
  | 'menge_fehlt'
  /** The unit is not one of the unit list. */
  | 'einheit_unbekannt'
  /** The unit is neither the supplier's purchase unit nor the article's base unit. */
  | 'einheit_abweichend'
  /** Converted by the pack content the Lieferschein prints, not by a stored conversion. */
  | 'packung_umgerechnet';

export type DeliveryLineMatch = {
  article: Pick<DeliveryArticle, 'itemId' | 'name' | 'internalSku' | 'unit'> | null;
  via: 'artikelnummer' | 'ean' | null;
  /** The delivered quantity in the article's base unit, when the units allow it. */
  baseQuantity: number | null;
  problems: DeliveryProblem[];
};

const rounded = (value: number): number => Math.round(value * 1000) / 1000;

/** The own article a line names, how it was found, and the reference its pack converts through. */
function findArticle(line: DeliveryLine, articles: readonly DeliveryArticle[]) {
  const byNumber = line.artikelnummer
    ? articles.filter((article) =>
        article.references.some((reference) => reference.supplierArticleNumber === line.artikelnummer),
      )
    : [];
  const ean = line.ean;
  const candidates =
    byNumber.length > 0 || !ean ? byNumber : articles.filter((article) => article.barcodes.includes(ean));
  const via = byNumber.length > 0 ? ('artikelnummer' as const) : ('ean' as const);
  const [article, ...more] = candidates;
  if (!article) return { status: 'unknown' as const };
  if (more.length > 0) return { status: 'ambiguous' as const };
  const reference =
    via === 'artikelnummer'
      ? article.references.find((entry) => entry.supplierArticleNumber === line.artikelnummer)
      : (article.references.find((entry) => entry.isPreferred) ?? article.references[0]);
  return { status: 'found' as const, article, via, reference: reference ?? null };
}

/** One line matched against the articles its number or EAN found (lib/inventory/delivery-articles.ts). */
export function matchDeliveryLine(
  line: DeliveryLine,
  articles: readonly DeliveryArticle[],
): DeliveryLineMatch {
  const found = findArticle(line, articles);
  if (found.status !== 'found') {
    const problem = found.status === 'ambiguous' ? 'mehrdeutig' : 'artikel_unbekannt';
    return { article: null, via: null, baseQuantity: null, problems: [problem] };
  }
  const { article, via, reference } = found;
  const matched = {
    itemId: article.itemId,
    name: article.name,
    internalSku: article.internalSku,
    unit: article.unit,
  };
  if (line.menge === null) return { article: matched, via, baseQuantity: null, problems: ['menge_fehlt'] };
  const unit = normalizeInventoryUnitInput(line.einheit);
  const purchaseUnit = reference?.purchaseUnit ?? article.unit;
  const at = (baseQuantity: number | null, problems: DeliveryProblem[] = []): DeliveryLineMatch => ({
    article: matched,
    via,
    baseQuantity: baseQuantity === null ? null : rounded(baseQuantity),
    problems,
  });
  if (unit !== null && unit === purchaseUnit && reference)
    return at((line.menge * reference.baseQuantity) / reference.packQuantity);
  if (unit !== null && unit === article.unit) return at(line.menge);
  // A pack the supplier reference does not know, of an article counted in pieces.
  if (line.packungsinhalt !== null && article.unit === 'piece')
    return at(line.menge * line.packungsinhalt, ['packung_umgerechnet']);
  return at(null, [unit === null ? 'einheit_unbekannt' : 'einheit_abweichend']);
}
