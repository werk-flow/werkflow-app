import {
  CONDITION_LINE_KINDS,
  discountText,
  MAX_DISCOUNT_TENTHS,
  type ConditionLineKind,
  type CustomerCondition,
} from './customer-conditions';
import { centsToEuroInput, parseEuroCents } from './money';

// The text state of the dialog that records a new version of a customer's
// conditions, and its parse into what recordCustomerCondition takes. Each
// refusal is a German sentence keyed by the control's id, so the dialog marks
// the field and focuses the first (focusFirstInvalidField). The server parses
// the same limits again (action-schemas.ts).

export type ConditionPriceRow = { key: string; leistungId: string; price: string };
export type ConditionForm = {
  validFrom: string;
  /** Percent as typed; empty is no discount. */
  discounts: Record<ConditionLineKind, string>;
  prices: ConditionPriceRow[];
};

export const conditionFieldId = {
  validFrom: 'condition-valid-from',
  discount: (kind: ConditionLineKind): string => `condition-discount-${kind}`,
  leistung: (key: string): string => `condition-price-${key}-leistung`,
  price: (key: string): string => `condition-price-${key}-price`,
};

/** „12,5“ of tenths of a percent; empty for none. */
function discountInput(tenths: number): string {
  return tenths === 0 ? '' : discountText(tenths);
}

/** A new version starts from the newest one, from `today` on. */
export function conditionFormOf(newest: CustomerCondition | null, today: string): ConditionForm {
  return {
    validFrom: today,
    discounts: {
      material: discountInput(newest?.discountTenths.material ?? 0),
      arbeit: discountInput(newest?.discountTenths.arbeit ?? 0),
      anfahrt: discountInput(newest?.discountTenths.anfahrt ?? 0),
    },
    prices: (newest?.leistungPrices ?? []).map((price) => ({
      key: price.leistungId,
      leistungId: price.leistungId,
      price: centsToEuroInput(price.salePriceCents),
    })),
  };
}

/** „10“, „12,5“ or „12.5“ percent → tenths up to 100 %; 0 for empty text; null for anything else. */
function parseDiscountTenths(text: string): number | null {
  const trimmed = text.trim().replace(/\s*%$/, '');
  if (trimmed === '') return 0;
  const match = /^(\d{1,3})(?:[.,](\d))?$/.exec(trimmed);
  if (!match) return null;
  const tenths = Number(match[1]) * 10 + Number(match[2] ?? '0');
  return tenths <= MAX_DISCOUNT_TENTHS ? tenths : null;
}

export type ConditionInput = {
  validFrom: string;
  discountTenths: Record<ConditionLineKind, number>;
  leistungPrices: Array<{ leistungId: string; salePriceCents: number }>;
};

/** What the form records, or a sentence per field at fault, in the order the fields show. */
export function parseConditionForm(
  form: ConditionForm,
): { ok: true; input: ConditionInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.validFrom)) {
    errors[conditionFieldId.validFrom] = 'Wähle den Tag, ab dem die Konditionen gelten.';
  }
  const discountTenths = { material: 0, arbeit: 0, anfahrt: 0 };
  for (const kind of CONDITION_LINE_KINDS) {
    const tenths = parseDiscountTenths(form.discounts[kind]);
    if (tenths === null) {
      errors[conditionFieldId.discount(kind)] =
        'Gib den Rabatt in Prozent von 0 bis 100 an, zum Beispiel 10 oder 12,5, oder lass das Feld leer.';
    } else {
      discountTenths[kind] = tenths;
    }
  }
  const seen = new Set<string>();
  const leistungPrices: ConditionInput['leistungPrices'] = [];
  for (const row of form.prices) {
    if (!row.leistungId) errors[conditionFieldId.leistung(row.key)] = 'Wähle eine Leistung.';
    else if (seen.has(row.leistungId)) {
      errors[conditionFieldId.leistung(row.key)] = 'Diese Leistung hat schon einen eigenen Preis.';
    }
    seen.add(row.leistungId);
    const cents = parseEuroCents(row.price);
    if (cents === null || cents === undefined) {
      errors[conditionFieldId.price(row.key)] = 'Gib den Preis netto an, zum Beispiel 68,00.';
    } else if (row.leistungId) {
      leistungPrices.push({ leistungId: row.leistungId, salePriceCents: cents });
    }
  }
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, input: { validFrom: form.validFrom, discountTenths, leistungPrices } };
}
