import { centsToEuroInput, parseEuroCents } from '@/lib/price-catalog/money';
import type { InvoiceDetail, InvoiceLineValues, InvoiceTaxRate, InvoiceTerms } from './types';

// The draft editor's text state and its parse into the values the save sends.
// Each refusal is a German sentence keyed by the control's id, so the editor
// marks the field and focuses the first (focusFirstInvalidField). The server
// parses the same limits again (action-schemas.ts).

export type DraftLineForm = {
  /** Stable while the editor is open, so a removed line keeps its neighbours' focus. */
  key: string;
  name: string;
  description: string;
  quantity: string;
  unit: string;
  price: string;
  priceQuantity: InvoiceLineValues['priceQuantity'];
  taxRateBasisPoints: InvoiceTaxRate;
};

export type DraftForm = {
  serviceStart: string;
  serviceEnd: string;
  paymentDueDays: string;
  discountPercent: string;
  discountDays: string;
  orderReference: string;
  buyerReference: string;
  openingText: string;
  closingText: string;
  lines: DraftLineForm[];
};

export type ParsedDraft =
  | { ok: true; terms: InvoiceTerms; lines: InvoiceLineValues[] }
  | { ok: false; errors: Record<string, string> };

/** The control id of a line's field. */
export function lineFieldId(index: number, field: 'name' | 'quantity' | 'price'): string {
  return `invoice-line-${index}-${field}`;
}

export const TERM_FIELD_IDS = {
  serviceStart: 'invoice-service-start',
  serviceEnd: 'invoice-service-end',
  paymentDueDays: 'invoice-payment-due',
  discountPercent: 'invoice-discount-percent',
  discountDays: 'invoice-discount-days',
} as const;

/** A decimal typed with a comma or a dot, signed, at most three decimals: „-1,5“ → „-1.5“. */
function parseQuantity(text: string): string | null {
  const match = /^(-?)(\d{1,9})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!match) return null;
  const [, sign = '', whole = '0', fraction = ''] = match;
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** „2“ or „2,5“ percent → basis points; null for anything else. */
function parsePercentBasisPoints(text: string): number | null {
  const match = /^(\d{1,2})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return basisPoints >= 1 && basisPoints <= 9999 ? basisPoints : null;
}

function parseDays(text: string, min: number): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return days >= min && days <= 365 ? days : null;
}

/** „4,5“ from 450 basis points. */
function percentInput(basisPoints: number | null): string {
  if (basisPoints === null) return '';
  const fraction = String(basisPoints % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return `${Math.trunc(basisPoints / 100)}${fraction ? `,${fraction}` : ''}`;
}

/** „1,5“ from the stored „1.500“. */
function quantityInput(quantity: string): string {
  const trimmed = quantity.includes('.') ? quantity.replace(/0+$/, '').replace(/\.$/, '') : quantity;
  return trimmed.replace('.', ',');
}

/** The editor's text state of a stored draft. */
export function draftFormOf(invoice: InvoiceDetail): DraftForm {
  return {
    serviceStart: invoice.serviceStart ?? '',
    // One day shows as a Leistungsdatum without an end.
    serviceEnd: invoice.serviceEnd && invoice.serviceEnd !== invoice.serviceStart ? invoice.serviceEnd : '',
    paymentDueDays: String(invoice.paymentDueDays),
    discountPercent: percentInput(invoice.discountBasisPoints),
    discountDays: invoice.discountDays === null ? '' : String(invoice.discountDays),
    orderReference: invoice.orderReference,
    buyerReference: invoice.buyerReference,
    openingText: invoice.openingText,
    closingText: invoice.closingText,
    lines: invoice.lines.map((line, index) => ({
      key: `stored-${index}`,
      name: line.name,
      description: line.description,
      quantity: quantityInput(line.quantity),
      unit: line.unit,
      price: centsToEuroInput(line.unitPriceCents),
      priceQuantity: line.priceQuantity,
      taxRateBasisPoints: line.taxRateBasisPoints,
    })),
  };
}

/** A new free line: one piece at the standard rate. */
export function emptyLine(key: string): DraftLineForm {
  return {
    key,
    name: '',
    description: '',
    quantity: '1',
    unit: 'piece',
    price: '',
    priceQuantity: 1,
    taxRateBasisPoints: 1900,
  };
}

function parseTerms(form: DraftForm, errors: Record<string, string>): InvoiceTerms | null {
  const paymentDueDays = parseDays(form.paymentDueDays, 0);
  if (paymentDueDays === null)
    errors[TERM_FIELD_IDS.paymentDueDays] = 'Gib das Zahlungsziel in Tagen an (0 bis 365).';
  if (form.serviceEnd && !form.serviceStart)
    errors[TERM_FIELD_IDS.serviceStart] = 'Gib den ersten Leistungstag an.';
  if (form.serviceStart && form.serviceEnd && form.serviceEnd < form.serviceStart) {
    errors[TERM_FIELD_IDS.serviceEnd] = 'Das Ende liegt vor dem Beginn.';
  }
  const hasDiscount = form.discountPercent.trim() !== '' || form.discountDays.trim() !== '';
  const discountBasisPoints = hasDiscount ? parsePercentBasisPoints(form.discountPercent) : null;
  const discountDays = hasDiscount ? parseDays(form.discountDays, 1) : null;
  if (hasDiscount && discountBasisPoints === null) {
    errors[TERM_FIELD_IDS.discountPercent] = 'Gib den Skonto in Prozent an, zum Beispiel 2 oder 2,5.';
  }
  if (hasDiscount && (discountDays === null || (paymentDueDays !== null && discountDays > paymentDueDays))) {
    errors[TERM_FIELD_IDS.discountDays] = 'Gib die Skontofrist in Tagen an, höchstens bis zum Zahlungsziel.';
  }
  if (paymentDueDays === null) return null;
  return {
    serviceStart: form.serviceStart || null,
    serviceEnd: form.serviceEnd || form.serviceStart || null,
    paymentDueDays,
    discountDays,
    discountBasisPoints,
    orderReference: form.orderReference.trim(),
    buyerReference: form.buyerReference.trim(),
    openingText: form.openingText.trim(),
    closingText: form.closingText.trim(),
  };
}

function parseLine(
  line: DraftLineForm,
  index: number,
  errors: Record<string, string>,
): InvoiceLineValues | null {
  const quantity = parseQuantity(line.quantity);
  const unitPriceCents = parseEuroCents(line.price);
  if (!line.name.trim()) errors[lineFieldId(index, 'name')] = 'Gib der Position eine Bezeichnung.';
  if (quantity === null) {
    errors[lineFieldId(index, 'quantity')] = 'Gib die Menge an, höchstens drei Nachkommastellen.';
  }
  if (unitPriceCents === null || unitPriceCents === undefined) {
    errors[lineFieldId(index, 'price')] = 'Gib den Netto-Einzelpreis an, zum Beispiel 72,50.';
  }
  if (!line.name.trim() || quantity === null || unitPriceCents === null || unitPriceCents === undefined)
    return null;
  return {
    name: line.name.trim(),
    description: line.description.trim(),
    quantity,
    unit: line.unit,
    unitPriceCents,
    priceQuantity: line.priceQuantity,
    taxRateBasisPoints: line.taxRateBasisPoints,
  };
}

/** Every line of the editor's text, or null while one cannot be read: the totals wait for all. */
export function parseDraftLines(lines: readonly DraftLineForm[]): InvoiceLineValues[] | null {
  const parsed = lines.map((line, index) => parseLine(line, index, {}));
  return parsed.every((line): line is InvoiceLineValues => line !== null) ? parsed : null;
}

/** The terms and lines of the editor's text, or a sentence per field at fault. */
export function parseDraftForm(form: DraftForm): ParsedDraft {
  const errors: Record<string, string> = {};
  const terms = parseTerms(form, errors);
  const lines = form.lines.map((line, index) => parseLine(line, index, errors));
  const parsed = lines.filter((line): line is InvoiceLineValues => line !== null);
  if (!terms || parsed.length !== lines.length || Object.keys(errors).length > 0)
    return { ok: false, errors };
  return { ok: true, terms, lines: parsed };
}
