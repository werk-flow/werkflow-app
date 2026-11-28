import type { DeliveryArticle } from './delivery-articles';
import { type InventoryUnitCode, isInventoryUnitCode, normalizeInventoryUnitInput } from './units';

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
  /** The line's EAN names another own article than its number. */
  | 'ean_abweichend'
  | 'menge_fehlt'
  /** The unit is not one of the unit list. */
  | 'einheit_unbekannt'
  /** The unit is neither a purchase unit of the article's references nor its base unit. */
  | 'einheit_abweichend'
  /** The article's own unit is an old free text outside the unit list. */
  | 'artikeleinheit_unbekannt'
  /** References that fit the line convert its unit differently. */
  | 'packung_unklar'
  /** The pack content the Lieferschein prints differs from the stored conversion. */
  | 'packung_abweichend'
  /** Converted by the pack content the Lieferschein prints, not by a stored conversion. */
  | 'packung_umgerechnet';

export type DeliveryLineMatch = {
  /** The own article; its unit is null when it is an old free text outside the unit list. */
  article: { name: string; internalSku: string | null; unit: InventoryUnitCode | null } | null;
  via: 'artikelnummer' | 'ean' | null;
  /** The delivered quantity in the article's base unit, when the units allow it. */
  baseQuantity: number | null;
  problems: DeliveryProblem[];
};

/** Units that hold a counted number of pieces, so a printed pack content converts them. */
const PACKAGING_UNITS: ReadonlySet<string> = new Set(['package', 'box', 'bundle', 'sack', 'pallet']);

/** Packing words of Lieferscheine outside the unit list, such as „VE“ (Verpackungseinheit). */
const PACKAGING_WORDS: ReadonlySet<string> = new Set(['ve', 'vpe', 'gebinde']);

/** Whether a printed unit is a packaging unit, so the printed pack content may convert it. */
function isPackaging(unit: InventoryUnitCode | null, printed: string | null): boolean {
  if (unit !== null) return PACKAGING_UNITS.has(unit);
  return printed !== null && PACKAGING_WORDS.has(printed.trim().toLowerCase().replace(/\.$/, ''));
}

const rounded = (value: number): number => Math.round(value * 1000) / 1000;

/** The distinct values a line set names, for the lookup of its articles. */
export function lookupValues(values: ReadonlyArray<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

/** The own article a line names, how it was found, and the references its pack may convert through. */
function findArticle(line: DeliveryLine, articles: readonly DeliveryArticle[]) {
  const number = line.artikelnummer;
  const byNumber = number
    ? articles.filter((article) =>
        article.references.some((reference) => reference.supplierArticleNumber === number),
      )
    : [];
  const ean = line.ean;
  const candidates =
    byNumber.length > 0 || !ean ? byNumber : articles.filter((article) => article.barcodes.includes(ean));
  const via = byNumber.length > 0 ? ('artikelnummer' as const) : ('ean' as const);
  const [article, ...more] = candidates;
  if (!article) return { status: 'unknown' as const };
  if (more.length > 0) return { status: 'ambiguous' as const };
  // The number wins, but an EAN that names another own article puts the line in doubt.
  const eanConflict =
    via === 'artikelnummer' &&
    ean !== null &&
    articles.some((other) => other !== article && other.barcodes.includes(ean));
  // A number names its own references; an EAN names the article, so any of its references may fit.
  const references =
    via === 'artikelnummer'
      ? article.references.filter((reference) => reference.supplierArticleNumber === number)
      : article.references;
  return { status: 'found' as const, article, via, references, eanConflict };
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
  const { article, via, references, eanConflict } = found;
  const baseUnit = isInventoryUnitCode(article.unit) ? article.unit : null;
  const at = (baseQuantity: number | null, problems: DeliveryProblem[] = []): DeliveryLineMatch => ({
    article: { name: article.name, internalSku: article.internalSku, unit: baseUnit },
    via,
    baseQuantity: baseQuantity === null ? null : rounded(baseQuantity),
    problems,
  });
  if (eanConflict) return at(null, ['ean_abweichend']);
  if (line.menge === null) return at(null, ['menge_fehlt']);
  if (baseUnit === null) return at(null, ['artikeleinheit_unbekannt']);
  const unit = normalizeInventoryUnitInput(line.einheit);
  if (unit !== null && unit === baseUnit) return at(line.menge);
  const ratios = [
    ...new Set(
      references
        .filter((reference) => reference.purchaseUnit !== null && reference.purchaseUnit === unit)
        .map((reference) => reference.baseQuantity / reference.packQuantity),
    ),
  ];
  const [ratio, ...otherRatios] = ratios;
  if (otherRatios.length > 0) return at(null, ['packung_unklar']);
  const printed = baseUnit === 'piece' ? line.packungsinhalt : null;
  if (ratio !== undefined)
    return printed !== null && printed !== ratio ? at(null, ['packung_abweichend']) : at(line.menge * ratio);
  // A pack the references do not know, of an article counted in pieces.
  if (printed !== null && isPackaging(unit, line.einheit))
    return at(line.menge * printed, ['packung_umgerechnet']);
  return at(null, [unit === null ? 'einheit_unbekannt' : 'einheit_abweichend']);
}
