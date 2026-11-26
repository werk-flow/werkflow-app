import { emptyLine, parseQuantity, quantityInput, type DraftLineForm } from '@/lib/invoices/draft-form';
import { centsToEuroInput, parseEuroCents } from '@/lib/price-catalog/money';
import { offerAmounts, type OfferAmounts } from './amounts';
import type { OfferPosition, OfferSection } from './types';

// The content editor's text state and its parse into the Titel and
// Positionen the save sends. A position's fields are those of an invoice
// line, read by the same rules. Each refusal is a German sentence keyed by
// the control's id, so the editor marks the field and focuses the first
// (focusFirstInvalidField). The server parses the same limits again
// (action-schemas.ts).

export type PositionForm = DraftLineForm & { kind: OfferPosition['kind'] };
export type SectionForm = { key: string; title: string; positions: PositionForm[] };

export type ParsedContent =
  | { ok: true; sections: OfferSection[] }
  | { ok: false; errors: Record<string, string> };

/** The control id of a Titel's field, or of a field of one of its positions. */
export function contentFieldId(
  sectionIndex: number,
  field: 'title' | { position: number; field: 'name' | 'quantity' | 'price' },
): string {
  return typeof field === 'string'
    ? `offer-section-${sectionIndex}-title`
    : `offer-section-${sectionIndex}-position-${field.position}-${field.field}`;
}

/** The editor's text state of a stored content. */
export function contentFormOf(sections: readonly OfferSection[]): SectionForm[] {
  return sections.map((section, sectionIndex) => ({
    key: `stored-${sectionIndex}`,
    title: section.title,
    positions: section.positions.map((position, positionIndex) => {
      const key = `stored-${sectionIndex}-${positionIndex}`;
      if (position.kind === 'text') {
        return { ...emptyLine(key), kind: 'text', name: position.name, description: position.description };
      }
      return {
        key,
        kind: 'free',
        name: position.name,
        description: position.description,
        quantity: quantityInput(position.quantity),
        unit: position.unit,
        price: centsToEuroInput(position.unitPriceCents),
        priceQuantity: position.priceQuantity,
        taxRateBasisPoints: position.taxRateBasisPoints,
        // Positionen from the catalog come with K4c and K6.
        source: null,
      };
    }),
  }));
}

/** A new position of a kind: a free one starts as one piece at the standard rate. */
export function emptyPosition(key: string, kind: OfferPosition['kind']): PositionForm {
  return { ...emptyLine(key), kind };
}

function parsePosition(
  position: PositionForm,
  fieldId: (field: 'name' | 'quantity' | 'price') => string,
  errors: Record<string, string>,
): OfferPosition | null {
  const name = position.name.trim();
  const description = position.description.trim();
  if (!name) errors[fieldId('name')] = 'Gib der Position eine Bezeichnung.';
  if (position.kind === 'text') return name ? { kind: 'text', name, description } : null;
  const quantity = parseQuantity(position.quantity);
  const unitPriceCents = parseEuroCents(position.price);
  if (quantity === null) errors[fieldId('quantity')] = 'Gib die Menge an, höchstens drei Nachkommastellen.';
  if (unitPriceCents === null || unitPriceCents === undefined) {
    errors[fieldId('price')] = 'Gib den Netto-Einzelpreis an, zum Beispiel 72,50.';
  }
  if (!name || quantity === null || unitPriceCents === null || unitPriceCents === undefined) return null;
  return {
    kind: 'free',
    name,
    description,
    quantity,
    unit: position.unit,
    unitPriceCents,
    priceQuantity: position.priceQuantity,
    taxRateBasisPoints: position.taxRateBasisPoints,
  };
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

/**
 * Below Next's 1 MB body limit of a Server Action, with room for the request's
 * own fields: a larger content never reaches the server, so the editor says
 * what to shorten instead.
 */
const MAX_CONTENT_BYTES = 900_000;

/** Whether the parsed content is too large to send in one save. */
export function contentTooLarge(sections: readonly OfferSection[]): boolean {
  return new TextEncoder().encode(JSON.stringify(sections)).length > MAX_CONTENT_BYTES;
}

/** The live amounts of the content as typed; null while a position cannot be read or the line rule refuses it. */
export function liveContentAmounts(sections: readonly SectionForm[]): OfferAmounts | null {
  const parsed = parseContentForm(
    // A Titel without a name still adds up: only the positions decide the amounts.
    sections.map((section) => ({ ...section, title: section.title || '-' })),
  );
  if (!parsed.ok) return null;
  try {
    return offerAmounts(parsed.sections);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
