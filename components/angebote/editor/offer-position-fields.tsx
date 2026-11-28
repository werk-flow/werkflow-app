'use client';

import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatEuroCents, formatTaxRate } from '@/lib/document-rendering/format';
import { INVENTORY_UNITS } from '@/lib/inventory/units';
import { INVOICE_TAX_RATES } from '@/lib/invoices/types';
import type { PositionFigures } from '@/lib/offers/calculation';
import {
  withAdjustmentDirection,
  withUnit,
  type PositionField,
  type PositionForm,
} from '@/lib/offers/content-form';

const DIRECTIONS = [
  ['rabatt', 'Nachlass'],
  ['zuschlag', 'Zuschlag'],
] as const;

const SCOPES = [
  ['titel', 'Titel'],
  ['angebot', 'Angebot'],
  ['betrag', 'Fester Betrag'],
] as const;

/** „Art“ (Nachlass or Zuschlag) and „Bezogen auf“ (Titel, Angebot or a fixed amount). */
function AdjustmentChoiceFields({
  id,
  position,
  onChange,
  disabled,
}: {
  id: string;
  position: PositionForm;
  onChange: (position: PositionForm) => void;
  disabled: boolean;
}) {
  return (
    <>
      <Field label="Art" htmlFor={`${id}-direction`}>
        <Select
          value={position.adjustment}
          onValueChange={(next) => {
            const direction = DIRECTIONS.find(([value]) => value === next)?.[0];
            if (direction) onChange(withAdjustmentDirection(position, direction));
          }}
          disabled={disabled}
        >
          <SelectTrigger id={`${id}-direction`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIRECTIONS.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Bezogen auf" htmlFor={`${id}-scope`}>
        <Select
          value={position.adjustmentScope}
          onValueChange={(next) => {
            const adjustmentScope = SCOPES.find(([value]) => value === next)?.[0];
            if (adjustmentScope) onChange({ ...position, adjustmentScope });
          }}
          disabled={disabled}
        >
          <SelectTrigger id={`${id}-scope`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPES.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

/** Einheit, empty while an article's stored unit is outside the list: the office picks one. */
export function PositionUnitField({
  id,
  position,
  onChange,
  error,
  disabled,
}: {
  id: string;
  position: PositionForm;
  onChange: (position: PositionForm) => void;
  error: string | undefined;
  disabled: boolean;
}) {
  return (
    <Field
      label="Einheit"
      htmlFor={id}
      required
      error={error}
      // An article's stored unit outside the list leaves the unit to the office.
      description={position.unit ? undefined : 'Die Einheit des Artikels ist unbekannt. Wähle eine.'}
    >
      <SearchableSelect
        id={id}
        value={position.unit}
        onChange={(unit) => onChange(withUnit(position, unit))}
        placeholder="Einheit wählen…"
        // Every unit in use, and a retired one the position already has.
        options={INVENTORY_UNITS.flatMap((unit) =>
          unit.retired && unit.code !== position.unit ? [] : [{ value: unit.code, label: unit.label }],
        )}
        searchPlaceholder="Einheit suchen…"
        emptyMessage="Keine Einheit gefunden"
        disabled={disabled}
      />
    </Field>
  );
}

/** „MwSt.“ of a priced Position or a fixed Nachlass or Zuschlag. */
export function PositionTaxField({
  id,
  position,
  onChange,
  disabled,
}: {
  id: string;
  position: PositionForm;
  onChange: (position: PositionForm) => void;
  disabled: boolean;
}) {
  return (
    <Field label="MwSt." htmlFor={id}>
      <Select
        value={String(position.taxRateBasisPoints)}
        onValueChange={(value) => {
          const rate = INVOICE_TAX_RATES.find((candidate) => String(candidate) === value);
          if (rate !== undefined) onChange({ ...position, taxRateBasisPoints: rate });
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INVOICE_TAX_RATES.map((rate) => (
            <SelectItem key={rate} value={String(rate)}>
              {formatTaxRate(rate)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** A fixed Nachlass's net amount and VAT rate, or a percentage's „Prozent“. */
function AdjustmentValueFields({
  fieldId,
  position,
  onChange,
  errors,
  disabled,
}: {
  fieldId: (field: PositionField) => string;
  position: PositionForm;
  onChange: (position: PositionForm) => void;
  errors: Record<string, string | undefined>;
  disabled: boolean;
}) {
  return position.adjustmentScope === 'betrag' ? (
    <>
      <Field label="Betrag netto" htmlFor={fieldId('price')} required error={errors[fieldId('price')]}>
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={position.price}
          onChange={(event) => onChange({ ...position, price: event.target.value })}
          placeholder="0,00"
          disabled={disabled}
        />
      </Field>
      <PositionTaxField
        id={`${fieldId('price')}-tax`}
        position={position}
        onChange={onChange}
        disabled={disabled}
      />
    </>
  ) : (
    <Field
      label="Prozent"
      htmlFor={fieldId('percent')}
      required
      error={errors[fieldId('percent')]}
      className="col-span-2"
    >
      <Input
        inputMode="decimal"
        autoComplete="off"
        value={position.percent}
        onChange={(event) => onChange({ ...position, percent: event.target.value })}
        placeholder="zum Beispiel 3"
        disabled={disabled}
      />
    </Field>
  );
}

/**
 * A Nachlass or Zuschlag: its direction, what it is of, its percentage or its
 * fixed net amount with its VAT rate, and its amount, which counts in the
 * Titel's sum. A percentage covers the normal Positionen only; the line
 * below says so.
 */
export function AdjustmentFields({
  fieldId,
  position,
  figures,
  onChange,
  errors,
  disabled,
}: {
  fieldId: (field: PositionField) => string;
  position: PositionForm;
  figures: PositionFigures | null;
  onChange: (position: PositionForm) => void;
  errors: Record<string, string | undefined>;
  disabled: boolean;
}) {
  const fixed = position.adjustmentScope === 'betrag';
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end">
        <AdjustmentChoiceFields
          id={fieldId('percent')}
          position={position}
          onChange={onChange}
          disabled={disabled}
        />
        <AdjustmentValueFields
          fieldId={fieldId}
          position={position}
          onChange={onChange}
          errors={errors}
          disabled={disabled}
        />
        <p className="col-span-2 text-right text-sm font-medium tabular-nums sm:col-span-1 sm:min-w-28 sm:pb-2">
          <span className="sr-only">Betrag netto: </span>
          {figures === null ? '–' : formatEuroCents(figures.saleCents)}
        </p>
      </div>
      {!fixed && (
        <p className="text-xs text-muted-foreground">
          {position.adjustmentScope === 'titel'
            ? 'Vom Titel zählen nur die normalen Positionen, keine Bedarfs- oder Alternativpositionen.'
            : 'Vom ganzen Angebot zählen nur die normalen Positionen, keine Bedarfs- oder Alternativpositionen.'}
        </p>
      )}
    </>
  );
}
