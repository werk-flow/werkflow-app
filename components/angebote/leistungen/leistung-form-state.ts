import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import type { CreateLeistungInput, LeistungFieldsInput } from '@/lib/price-catalog/action-schemas';
import { centsToEuroInput, MAX_PRICE_CENTS, parseEuroCents } from '@/lib/price-catalog/money';
import type { LeistungKind, LeistungListEntry, LeistungTaxRate } from '@/lib/price-catalog/types';

// The Leistung dialogs' form state and its checks. The server parses the same
// limits again (lib/price-catalog/action-schemas.ts).

export const LEISTUNG_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  leistung_number_taken: 'Diese Nummer hat schon eine andere Leistung. Wähle eine andere Nummer.',
  leistung_not_found: 'Die Leistung gibt es nicht mehr oder sie ist archiviert. Lade die Liste neu.',
  save_failed: 'Die Leistung konnte nicht gespeichert werden. Bitte versuche es erneut.',
};

export type LeistungFieldsForm = {
  leistungNumber: string;
  name: string;
  description: string;
  kind: LeistungKind;
  unit: string;
  taxRate: LeistungTaxRate;
};

export type LeistungPriceForm = { validFrom: string; salePrice: string; costRate: string };

export function emptyLeistungFields(): LeistungFieldsForm {
  return { leistungNumber: '', name: '', description: '', kind: 'arbeit', unit: 'hour', taxRate: 1900 };
}

export function leistungFieldsOf(entry: LeistungListEntry): LeistungFieldsForm {
  return {
    leistungNumber: entry.leistungNumber,
    name: entry.name,
    description: entry.description,
    kind: entry.kind,
    // A stored code outside the list must be chosen again before a save.
    unit: entry.unit ?? '',
    taxRate: entry.taxRateBasisPoints === 700 ? 700 : entry.taxRateBasisPoints === 0 ? 0 : 1900,
  };
}

/** A new price starts today; editing an entry's latest price starts from its amounts. */
export function emptyLeistungPrice(latest?: {
  salePriceCents: number;
  costRateCents: number | null;
}): LeistungPriceForm {
  return {
    validFrom: getBusinessTodayIso(),
    salePrice: latest ? centsToEuroInput(latest.salePriceCents) : '',
    costRate: latest ? centsToEuroInput(latest.costRateCents) : '',
  };
}

const PRICE_MESSAGE = `Gib einen Betrag in Euro ein, zum Beispiel 65,50, höchstens ${(MAX_PRICE_CENTS / 100).toLocaleString('de-DE')} €.`;

/** Errors of the master-data fields, keyed by control id in visual order. */
export function leistungFieldErrors(form: LeistungFieldsForm): Record<string, string | undefined> {
  return {
    'leistung-number': form.leistungNumber.trim() ? undefined : 'Gib eine Nummer ein, zum Beispiel L-100.',
    'leistung-name': form.name.trim() ? undefined : 'Gib der Leistung einen Namen.',
    'leistung-unit': form.unit ? undefined : 'Wähle eine Einheit.',
  };
}

/** Errors of the price fields under `prefix`, keyed by control id in visual order. */
export function leistungPriceErrors(
  form: LeistungPriceForm,
  prefix: string,
): Record<string, string | undefined> {
  const sale = parseEuroCents(form.salePrice);
  return {
    [`${prefix}-valid-from`]: form.validFrom ? undefined : 'Wähle den Tag, ab dem der Preis gilt.',
    [`${prefix}-sale-price`]:
      sale === null ? 'Gib den Verkaufspreis ein.' : sale === undefined ? PRICE_MESSAGE : undefined,
    [`${prefix}-cost-rate`]: parseEuroCents(form.costRate) === undefined ? PRICE_MESSAGE : undefined,
  };
}

export function leistungFieldsInput(form: LeistungFieldsForm): LeistungFieldsInput {
  return {
    leistungNumber: form.leistungNumber,
    name: form.name,
    description: form.description,
    kind: form.kind,
    unit: form.unit,
    taxRateBasisPoints: form.taxRate,
  };
}

/** The price input of a checked form: amounts as cents, an empty cost rate as none. */
export function leistungPriceInput(
  form: LeistungPriceForm,
): Pick<CreateLeistungInput, 'validFrom' | 'salePriceCents' | 'costRateCents'> {
  return {
    validFrom: form.validFrom,
    salePriceCents: parseEuroCents(form.salePrice) ?? 0,
    costRateCents: parseEuroCents(form.costRate) ?? null,
  };
}
