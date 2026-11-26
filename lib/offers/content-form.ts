import type { PriceQuantity } from '@/lib/inventory/line-amount';
import { isInventoryUnitCode } from '@/lib/inventory/units';
import { emptyLine, parsePricedLine, quantityInput, type DraftLineForm } from '@/lib/invoices/draft-form';
import type { OfferCatalogLine } from '@/lib/invoices/line-sources';
import { centsToEuroInput, parseEuroCents } from '@/lib/price-catalog/money';
import { offerAmounts, type OfferAmounts } from './amounts';
import { markupPriceCents, MAX_MARKUP_TENTHS, offerCalculation, type OfferCalculation } from './calculation';
import type { OfferCostedSection, OfferPosition, OfferPositionCost, OfferSection } from './types';

// The content editor's text state and its parse into the Titel and
// Positionen the save sends. A priced position is read as an invoice line is
// (parsePricedLine) and needs a unit of the list; a text line needs only its
// Bezeichnung. A Position from an article or a Leistung keeps it as its
// source. A priced Position's cost is optional; a markup on it sets the
// price, and is neither kept nor checked by the save. Each refusal is a German sentence keyed by the
// control's id, so the editor marks the field and focuses the first
// (focusFirstInvalidField). The server parses the same limits again
// (action-schemas.ts).

export type PositionForm = DraftLineForm & {
  kind: OfferPosition['kind'];
  /** Net cost per `costPriceQuantity`, empty while the office knows none. */
  cost: string;
  costPriceQuantity: PriceQuantity;
  /** A markup in percent on the cost that set the price; cleared when the price is typed. */
  markup: string;
};

type PositionField = 'name' | 'quantity' | 'unit' | 'price' | 'cost' | 'markup';
export type SectionForm = { key: string; title: string; positions: PositionForm[] };

export type ParsedContent =
  | { ok: true; sections: OfferSection[] }
  | { ok: false; errors: Record<string, string> };

/** The control id of a Titel's field, or of a field of one of its positions. */
export function contentFieldId(
  sectionIndex: number,
  field: 'title' | { position: number; field: PositionField },
): string {
  return typeof field === 'string'
    ? `offer-section-${sectionIndex}-title`
    : `offer-section-${sectionIndex}-position-${field.position}-${field.field}`;
}

/** The editor's text state of a stored content; `keyPrefix` names one load of it. */
export function contentFormOf(sections: readonly OfferCostedSection[], keyPrefix = 'stored'): SectionForm[] {
  return sections.map((section, sectionIndex) => ({
    key: `${keyPrefix}-${sectionIndex}`,
    title: section.title,
    positions: section.positions.map((position, positionIndex) => {
      const key = `${keyPrefix}-${sectionIndex}-${positionIndex}`;
      if (position.kind === 'text') {
        return { ...emptyPosition(key, 'text'), name: position.name, description: position.description };
      }
      return {
        ...costFields(position.cost, position.priceQuantity),
        key,
        kind: 'free',
        name: position.name,
        description: position.description,
        quantity: quantityInput(position.quantity),
        unit: position.unit,
        price: centsToEuroInput(position.unitPriceCents),
        priceQuantity: position.priceQuantity,
        taxRateBasisPoints: position.taxRateBasisPoints,
        source: position.source,
      };
    }),
  }));
}

function costFields(cost: OfferPositionCost | null, priceQuantity: PriceQuantity) {
  return {
    cost: cost ? centsToEuroInput(cost.amountCents) : '',
    // A typed cost is stated per the Position's own price quantity.
    costPriceQuantity: cost?.priceQuantity ?? priceQuantity,
    markup: '',
  };
}

/** A new position of a kind: a free one starts as one piece at the standard rate. */
export function emptyPosition(key: string, kind: OfferPosition['kind']): PositionForm {
  const line = emptyLine(key);
  return { ...line, kind, ...costFields(null, line.priceQuantity) };
}

/**
 * A new Position from an article or a Leistung as the server read it
 * (readOfferArticleLine, readOfferLeistungLine): one unit at its sale price,
 * with its cost, all editable. A unit outside the list stays empty, so the
 * office picks one before the save.
 */
export function catalogPositionForm(key: string, line: OfferCatalogLine): PositionForm {
  return {
    ...costFields(line.cost, line.priceQuantity),
    key,
    kind: 'free',
    name: line.name,
    description: line.description,
    quantity: '1',
    unit: line.unit ?? '',
    price: centsToEuroInput(line.unitPriceCents),
    priceQuantity: line.priceQuantity,
    taxRateBasisPoints: line.taxRateBasisPoints,
    source: line.source,
  };
}

/** „25“ or „12,5“ percent → tenths of a percent, up to 999,9 %; null for anything else. */
function parseMarkupTenths(text: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d))?$/.exec(text.trim());
  if (!match) return null;
  const tenths = Number(match[1]) * 10 + Number(match[2] ?? '0');
  return tenths <= MAX_MARKUP_TENTHS ? tenths : null;
}

/**
 * The position after its cost or markup changed: a markup that reads on a
 * cost that reads sets the price by the shared line rule. Otherwise the
 * price stays as typed, and the parse names the field at fault.
 */
export function withCostOrMarkup(
  position: PositionForm,
  change: { cost: string } | { markup: string },
): PositionForm {
  const next = { ...position, ...change };
  const costCents = parseEuroCents(next.cost);
  const markupTenths = parseMarkupTenths(next.markup);
  if (costCents === null || costCents === undefined || markupTenths === null) return next;
  const priceCents = markupPriceCents(
    { amountCents: costCents, priceQuantity: next.costPriceQuantity },
    next.priceQuantity,
    markupTenths,
  );
  return { ...next, price: centsToEuroInput(priceCents) };
}

/**
 * Why a typed markup sets no price, while the office types: it does not read,
 * or there is no cost to put it on. Null when it applies or is empty. A
 * markup is never saved, so it never stops a save.
 */
export function markupSentence(position: PositionForm): string | null {
  if (!position.markup.trim()) return null;
  if (parseMarkupTenths(position.markup) === null) {
    return 'Gib den Aufschlag in Prozent an, zum Beispiel 25 oder 12,5.';
  }
  return parseEuroCents(position.cost) === null ? 'Trag zuerst die Kosten ein.' : null;
}

const PRICED_FIELDS = ['name', 'quantity', 'unit', 'price', 'cost'] as const;

/** The cost of a priced position as typed: null when empty, undefined with a sentence when it does not read. */
function parseCost(
  position: PositionForm,
  fieldId: (field: PositionField) => string,
  errors: Record<string, string>,
): OfferPositionCost | null | undefined {
  const amountCents = parseEuroCents(position.cost);
  if (amountCents === undefined) {
    errors[fieldId('cost')] = 'Gib die Kosten netto an, zum Beispiel 48,20, oder lass das Feld leer.';
    return undefined;
  }
  return amountCents === null ? null : { amountCents, priceQuantity: position.costPriceQuantity };
}

function parsePosition(
  position: PositionForm,
  fieldId: (field: PositionField) => string,
  errors: Record<string, string>,
): OfferPosition | null {
  if (position.kind === 'free') {
    const lineErrors: Record<string, string> = {};
    const values = parsePricedLine(position, fieldId, lineErrors);
    const unitKnown = isInventoryUnitCode(position.unit);
    if (!unitKnown) lineErrors[fieldId('unit')] = 'Wähle eine Einheit.';
    const cost = parseCost(position, fieldId, lineErrors);
    // In the order the fields show, so the first one at fault takes the focus.
    for (const field of PRICED_FIELDS) {
      const sentence = lineErrors[fieldId(field)];
      if (sentence) errors[fieldId(field)] = sentence;
    }
    const source = position.source ? { kind: position.source.kind, id: position.source.id } : null;
    return values && unitKnown && cost !== undefined ? { kind: 'free', ...values, source, cost } : null;
  }
  const name = position.name.trim();
  if (!name) errors[fieldId('name')] = 'Gib der Position eine Bezeichnung.';
  return name ? { kind: 'text', name, description: position.description.trim() } : null;
}

/** The Titel and Positionen of the editor's text, or a sentence per field at fault. */
export function parseContentForm(sections: readonly SectionForm[]): ParsedContent {
  const errors: Record<string, string> = {};
  const parsed = sections.map((section, sectionIndex) => {
    const title = section.title.trim();
    if (!title) errors[contentFieldId(sectionIndex, 'title')] = 'Gib dem Titel einen Namen.';
    const positions = section.positions.map((position, index) =>
      parsePosition(position, (field) => contentFieldId(sectionIndex, { position: index, field }), errors),
    );
    return { title, positions: positions.filter((position) => position !== null) };
  });
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, sections: parsed };
}

/** How much one offer holds; the save's schema refuses the same limits (action-schemas.ts). */
export const OFFER_CONTENT_LIMITS = { sections: 100, positionsPerSection: 500, positions: 1000 } as const;

/**
 * Below Next's 1 MB body limit of a Server Action, with room for the request's
 * own fields: a larger content never reaches the server, so the editor says
 * what to shorten instead.
 */
const MAX_CONTENT_BYTES = 900_000;

/** Whether the content fits one save, counted in UTF-8 bytes; the editor and the save's schema both ask. */
export function contentFitsOneSave(sections: readonly unknown[]): boolean {
  return new TextEncoder().encode(JSON.stringify(sections)).length <= MAX_CONTENT_BYTES;
}

/**
 * The sentence for parsed content one save cannot take: more Titel or
 * Positionen than an offer holds, or more bytes than a Server Action carries.
 * Null when it fits.
 */
export function contentLimitSentence(sections: readonly OfferSection[]): string | null {
  if (sections.length > OFFER_CONTENT_LIMITS.sections) {
    return `Ein Angebot hat höchstens ${OFFER_CONTENT_LIMITS.sections} Titel. Fasse Titel zusammen.`;
  }
  if (sections.some((section) => section.positions.length > OFFER_CONTENT_LIMITS.positionsPerSection)) {
    return `Ein Titel hat höchstens ${OFFER_CONTENT_LIMITS.positionsPerSection} Positionen. Verteile sie auf mehrere Titel.`;
  }
  if (
    sections.reduce((count, section) => count + section.positions.length, 0) > OFFER_CONTENT_LIMITS.positions
  ) {
    return 'Ein Angebot hat höchstens 1.000 Positionen. Verteile sie auf mehrere Angebote.';
  }
  if (!contentFitsOneSave(sections)) {
    return 'Die Positionen sind zu lang für eine Speicherung. Kürze lange Beschreibungen.';
  }
  return null;
}

/**
 * The live amounts and calculation of the content as typed; null while a
 * position cannot be read or the line rule refuses it.
 */
export function liveContentFigures(
  sections: readonly SectionForm[],
): { amounts: OfferAmounts; calculation: OfferCalculation } | null {
  const parsed = parseContentForm(
    // A Titel without a name still adds up: only the positions decide the amounts.
    sections.map((section) => ({ ...section, title: section.title.trim() || '-' })),
  );
  if (!parsed.ok) return null;
  try {
    const amounts = offerAmounts(parsed.sections);
    return { amounts, calculation: offerCalculation(parsed.sections, amounts) };
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
