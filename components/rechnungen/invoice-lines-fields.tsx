'use client';

import { Plus, Trash2 } from 'lucide-react';

import { SectionTitle } from '@/components/shared/section-title';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatEuroCents, formatTaxRate } from '@/lib/document-rendering/format';
import { INVENTORY_UNITS, OFFERED_INVENTORY_UNITS } from '@/lib/inventory/units';
import { lineFieldId, type DraftLineForm } from '@/lib/invoices/draft-form';
import { INVOICE_TAX_RATES } from '@/lib/invoices/types';

type LineProps = {
  index: number;
  line: DraftLineForm;
  /** The line's net amount, or null while it cannot be read. */
  netCents: number | null;
  onChange: (line: DraftLineForm) => void;
  onRemove: () => void;
  errors: Record<string, string | undefined>;
  disabled: boolean;
};

/** The units a line offers: every unit in use, and a retired one the line already has. */
function unitOptions(current: string) {
  return INVENTORY_UNITS.filter(
    (unit) => OFFERED_INVENTORY_UNITS.includes(unit) || unit.code === current,
  ).map((unit) => ({ value: unit.code, label: unit.label }));
}

/** The draft's lines, free text each: name, quantity, unit, net price, VAT rate. */
export function InvoiceLinesFields({
  lines,
  lineNetCents,
  onChange,
  onAdd,
  errors,
  disabled,
}: {
  lines: DraftLineForm[];
  lineNetCents: Array<number | null>;
  onChange: (lines: DraftLineForm[]) => void;
  onAdd: () => void;
  errors: Record<string, string | undefined>;
  disabled: boolean;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle as="h2">Positionen</SectionTitle>
        <Button type="button" variant="outline" size="sm" onClick={onAdd} disabled={disabled}>
          <Plus className="size-4" />
          Position hinzufügen
        </Button>
      </div>
      {lines.length === 0 ? (
        <EmptyState
          size="compact"
          title="Noch keine Positionen"
          description="Füge die erste Position über „Position hinzufügen“ hinzu."
        />
      ) : (
        <ol className="divide-y rounded-lg border">
          {lines.map((line, index) => (
            <InvoiceLineFields
              key={line.key}
              index={index}
              line={line}
              netCents={lineNetCents[index] ?? null}
              onChange={(next) => onChange(lines.map((current, at) => (at === index ? next : current)))}
              onRemove={() => onChange(lines.filter((_line, at) => at !== index))}
              errors={errors}
              disabled={disabled}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function InvoiceLineFields({ index, line, netCents, onChange, onRemove, errors, disabled }: LineProps) {
  return (
    <li className="space-y-3 p-4">
      <div className="flex items-start gap-2">
        <span className="pt-8 text-sm text-muted-foreground tabular-nums">{index + 1}.</span>
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Field
            label="Bezeichnung"
            htmlFor={lineFieldId(index, 'name')}
            required
            error={errors[lineFieldId(index, 'name')]}
          >
            <Input
              value={line.name}
              onChange={(event) => onChange({ ...line, name: event.target.value })}
              maxLength={200}
              autoComplete="off"
              disabled={disabled}
            />
          </Field>
          <Field label="Beschreibung" htmlFor={`invoice-line-${index}-description`}>
            <Input
              value={line.description}
              onChange={(event) => onChange({ ...line, description: event.target.value })}
              maxLength={2000}
              autoComplete="off"
              disabled={disabled}
            />
          </Field>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mt-6 shrink-0"
          aria-label={`Position ${index + 1} entfernen`}
          onClick={onRemove}
          disabled={disabled}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      <LineAmountFields
        index={index}
        line={line}
        netCents={netCents}
        onChange={onChange}
        errors={errors}
        disabled={disabled}
      />
    </li>
  );
}

/** Menge, Einheit, Netto-Preis, USt. and the line's net amount. */
function LineAmountFields({
  index,
  line,
  netCents,
  onChange,
  errors,
  disabled,
}: Omit<LineProps, 'onRemove'>) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end">
      <Field
        label="Menge"
        htmlFor={lineFieldId(index, 'quantity')}
        required
        error={errors[lineFieldId(index, 'quantity')]}
      >
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={line.quantity}
          onChange={(event) => onChange({ ...line, quantity: event.target.value })}
          disabled={disabled}
        />
      </Field>
      <Field label="Einheit" htmlFor={`invoice-line-${index}-unit`}>
        <SearchableSelect
          id={`invoice-line-${index}-unit`}
          value={line.unit}
          onChange={(unit) => onChange({ ...line, unit })}
          options={unitOptions(line.unit)}
          searchPlaceholder="Einheit suchen…"
          emptyMessage="Keine Einheit gefunden"
          disabled={disabled}
        />
      </Field>
      <Field
        label={line.priceQuantity === 1 ? 'Einzelpreis netto' : `Netto je ${line.priceQuantity}`}
        htmlFor={lineFieldId(index, 'price')}
        required
        error={errors[lineFieldId(index, 'price')]}
      >
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={line.price}
          onChange={(event) => onChange({ ...line, price: event.target.value })}
          placeholder="0,00"
          disabled={disabled}
        />
      </Field>
      <Field label="USt." htmlFor={`invoice-line-${index}-tax`}>
        <Select
          value={String(line.taxRateBasisPoints)}
          onValueChange={(value) => {
            const rate = INVOICE_TAX_RATES.find((candidate) => String(candidate) === value);
            if (rate !== undefined) onChange({ ...line, taxRateBasisPoints: rate });
          }}
          disabled={disabled}
        >
          <SelectTrigger id={`invoice-line-${index}-tax`} className="w-full">
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
      <p className="col-span-2 text-right text-sm font-medium tabular-nums sm:col-span-1 sm:min-w-28 sm:pb-2">
        <span className="sr-only">Netto: </span>
        {netCents === null ? '–' : formatEuroCents(netCents)}
      </p>
    </div>
  );
}
