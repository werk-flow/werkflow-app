'use client';

import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { parseIsoLocalDate } from '@/lib/utils';
import type { LeistungPriceForm } from './leistung-form-state';

/**
 * First day, sale price and internal cost rate of one price version. The
 * control ids start with `prefix`, so the create dialog and the price dialog
 * keep their own.
 */
export function LeistungPriceFields({
  prefix,
  unitLabel,
  form,
  onChange,
  errors,
}: {
  prefix: string;
  /** The short unit label the amounts are per, „Std“. */
  unitLabel: string | null;
  form: LeistungPriceForm;
  onChange: (form: LeistungPriceForm) => void;
  errors: Record<string, string | undefined>;
}) {
  const perUnit = unitLabel ? `Netto je ${unitLabel}.` : 'Netto je Einheit.';
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field
        label="Gültig ab"
        htmlFor={`${prefix}-valid-from`}
        required
        error={errors[`${prefix}-valid-from`]}
      >
        <DatePicker
          id={`${prefix}-valid-from`}
          ariaLabel="Gültig ab"
          value={parseIsoLocalDate(form.validFrom)}
          onChange={(date) => onChange({ ...form, validFrom: date ? formatBerlinLocalDate(date) : '' })}
        />
      </Field>
      <Field
        label="Verkaufspreis"
        htmlFor={`${prefix}-sale-price`}
        required
        description={perUnit}
        error={errors[`${prefix}-sale-price`]}
      >
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={form.salePrice}
          onChange={(event) => onChange({ ...form, salePrice: event.target.value })}
          placeholder="0,00"
        />
      </Field>
      <Field
        label="Kostensatz"
        htmlFor={`${prefix}-cost-rate`}
        description="Intern, erscheint nie im Angebot."
        error={errors[`${prefix}-cost-rate`]}
      >
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={form.costRate}
          onChange={(event) => onChange({ ...form, costRate: event.target.value })}
          placeholder="0,00"
        />
      </Field>
    </div>
  );
}
