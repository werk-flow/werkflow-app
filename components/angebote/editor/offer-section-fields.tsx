'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { move } from '@/components/arbeitsvorlagen/work-template-editor-shared';
import { InvoiceLineSourceNote } from '@/components/rechnungen/invoice-catalog-line';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatEuroCents, formatTaxRate } from '@/lib/document-rendering/format';
import { INVENTORY_UNITS } from '@/lib/inventory/units';
import { INVOICE_TAX_RATES } from '@/lib/invoices/types';
import type { OfferAmounts } from '@/lib/offers/amounts';
import {
  articlePositionForm,
  contentFieldId,
  emptyPosition,
  type PositionForm,
  type SectionForm,
} from '@/lib/offers/content-form';
import { positionNumbers } from '@/lib/offers/numbering';
import type { OfferPosition } from '@/lib/offers/types';
import { OfferArticlePicker } from './offer-article-picker';

type Errors = Record<string, string | undefined>;

/** Up, down and remove for a Titel or a position; the labels name which one. */
function OrderButtons({
  label,
  index,
  count,
  onMove,
  onRemove,
  disabled,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
        aria-label={`${label} nach oben`}
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled || index === count - 1}
        onClick={() => onMove(1)}
        aria-label={`${label} nach unten`}
      >
        <ArrowDown className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled}
        onClick={onRemove}
        aria-label={`${label} entfernen`}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

/** One Titel: its name, its positions in order, its subtotal, and adding a position, an article or a text line. */
export function OfferSectionFields({
  index,
  count,
  section,
  amounts,
  onChange,
  onMove,
  onRemove,
  onAddArticle,
  newKey,
  errors,
  disabled,
}: {
  index: number;
  count: number;
  section: SectionForm;
  amounts: OfferAmounts['sections'][number] | null;
  onChange: (section: SectionForm) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  /** Appends a Position to this Titel as it is when the article's price arrives. */
  onAddArticle: (position: PositionForm) => void;
  newKey: () => string;
  errors: Errors;
  disabled: boolean;
}) {
  const number = String(index + 1);
  const titleId = contentFieldId(index, 'title');
  const setPositions = (positions: PositionForm[]) => onChange({ ...section, positions });
  return (
    <li className="space-y-3 rounded-lg border p-3 sm:p-4">
      <div className="flex items-end gap-2">
        <Field
          label={`Titel ${number}`}
          htmlFor={titleId}
          required
          error={errors[titleId]}
          className="min-w-0 flex-1"
        >
          <Input
            value={section.title}
            onChange={(event) => onChange({ ...section, title: event.target.value })}
            maxLength={200}
            autoComplete="off"
            placeholder="zum Beispiel Heizung"
            disabled={disabled}
          />
        </Field>
        <OrderButtons
          label={`Titel ${number}`}
          index={index}
          count={count}
          onMove={onMove}
          onRemove={onRemove}
          disabled={disabled}
        />
      </div>
      <PositionList
        sectionIndex={index}
        number={number}
        positions={section.positions}
        positionCents={amounts?.positionCents ?? null}
        onChange={setPositions}
        errors={errors}
        disabled={disabled}
      />
      <SectionFooter
        sectionIndex={index}
        number={number}
        netCents={amounts?.netCents ?? null}
        onAdd={(kind) => setPositions([...section.positions, emptyPosition(newKey(), kind)])}
        onPickArticle={() => onChange(section)}
        onAddArticle={onAddArticle}
        disabled={disabled}
      />
    </li>
  );
}

/** The positions of one Titel in order, each with its fields and its order buttons. */
function PositionList({
  sectionIndex,
  number,
  positions,
  positionCents,
  onChange,
  errors,
  disabled,
}: {
  sectionIndex: number;
  number: string;
  positions: PositionForm[];
  positionCents: Array<number | null> | null;
  onChange: (positions: PositionForm[]) => void;
  errors: Errors;
  disabled: boolean;
}) {
  if (positions.length === 0) return null;
  const numbers = positionNumbers(number, positions);
  return (
    <ol className="divide-y rounded-lg border">
      {positions.map((position, index) => (
        <PositionFields
          key={position.key}
          fieldId={(field) => contentFieldId(sectionIndex, { position: index, field })}
          number={numbers[index] ?? null}
          position={position}
          amountCents={positionCents?.[index] ?? null}
          onChange={(next) => onChange(positions.map((current, at) => (at === index ? next : current)))}
          order={{
            index,
            count: positions.length,
            onMove: (direction) => onChange(move(positions, index, direction)),
            onRemove: () => onChange(positions.filter((_position, at) => at !== index)),
          }}
          errors={errors}
          disabled={disabled}
        />
      ))}
    </ol>
  );
}

/** Adding a position, an article or a text line, and the Titel's subtotal. */
function SectionFooter({
  sectionIndex,
  number,
  netCents,
  onAdd,
  onPickArticle,
  onAddArticle,
  disabled,
}: {
  sectionIndex: number;
  number: string;
  netCents: number | null;
  onAdd: (kind: OfferPosition['kind']) => void;
  onPickArticle: () => void;
  onAddArticle: (position: PositionForm) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-start gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onAdd('free')} disabled={disabled}>
          <Plus className="size-4" />
          Position
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onAdd('text')} disabled={disabled}>
          <Plus className="size-4" />
          Text
        </Button>
        <OfferArticlePicker
          id={`offer-section-${sectionIndex}-article`}
          label={`Artikel zu Titel ${number} hinzufügen`}
          onPick={onPickArticle}
          // The answer arrives after other edits may have changed the Titel: the editor appends it to the current one.
          onAdd={(line) => onAddArticle(articlePositionForm(`article-${crypto.randomUUID()}`, line))}
          disabled={disabled}
        />
      </div>
      <p className="text-sm font-medium tabular-nums">
        {`Summe Titel ${number}: `}
        {netCents === null ? '–' : formatEuroCents(netCents)}
      </p>
    </div>
  );
}

type PositionProps = {
  fieldId: (field: 'name' | 'quantity' | 'unit' | 'price') => string;
  /** As printed, for example `1.2`; null for a text line. */
  number: string | null;
  position: PositionForm;
  /** The position's amount, or null while it cannot be read or for a text line. */
  amountCents: number | null;
  onChange: (position: PositionForm) => void;
  order: { index: number; count: number; onMove: (direction: -1 | 1) => void; onRemove: () => void };
  errors: Errors;
  disabled: boolean;
};

function PositionFields({
  fieldId,
  number,
  position,
  amountCents,
  onChange,
  order,
  errors,
  disabled,
}: PositionProps) {
  const label = number ? `Position ${number}` : 'Text';
  return (
    <li className="space-y-3 p-3 sm:p-4">
      {/* The number and the order buttons share a line above the fields, at every width. */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground tabular-nums">
          {number ?? <Badge variant="secondary">Text</Badge>}
        </span>
        <OrderButtons label={label} {...order} disabled={disabled} />
      </div>
      {position.kind === 'free' && position.source && <InvoiceLineSourceNote source={position.source} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bezeichnung" htmlFor={fieldId('name')} required error={errors[fieldId('name')]}>
          <Input
            value={position.name}
            onChange={(event) => onChange({ ...position, name: event.target.value })}
            maxLength={200}
            autoComplete="off"
            disabled={disabled}
          />
        </Field>
        <Field label="Beschreibung" htmlFor={`${fieldId('name')}-description`}>
          <Textarea
            value={position.description}
            onChange={(event) => onChange({ ...position, description: event.target.value })}
            maxLength={4000}
            rows={2}
            disabled={disabled}
          />
        </Field>
      </div>
      {position.kind === 'free' && (
        <PositionAmountFields
          fieldId={fieldId}
          position={position}
          amountCents={amountCents}
          onChange={onChange}
          errors={errors}
          disabled={disabled}
        />
      )}
    </li>
  );
}

/** Menge, Einheit, Netto-Preis, MwSt. and the position's amount. */
function PositionAmountFields({
  fieldId,
  position,
  amountCents,
  onChange,
  errors,
  disabled,
}: Omit<PositionProps, 'number' | 'order'>) {
  const unitId = fieldId('unit');
  const taxId = `${fieldId('price')}-tax`;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end">
      <Field label="Menge" htmlFor={fieldId('quantity')} required error={errors[fieldId('quantity')]}>
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={position.quantity}
          onChange={(event) => onChange({ ...position, quantity: event.target.value })}
          disabled={disabled}
        />
      </Field>
      <PositionUnitField
        id={unitId}
        position={position}
        onChange={onChange}
        error={errors[unitId]}
        disabled={disabled}
      />
      <Field
        label={position.priceQuantity === 1 ? 'Einzelpreis netto' : `Netto je ${position.priceQuantity}`}
        htmlFor={fieldId('price')}
        required
        error={errors[fieldId('price')]}
      >
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={position.price}
          onChange={(event) => onChange({ ...position, price: event.target.value })}
          placeholder="0,00"
          disabled={disabled}
        />
      </Field>
      <Field label="MwSt." htmlFor={taxId}>
        <Select
          value={String(position.taxRateBasisPoints)}
          onValueChange={(value) => {
            const rate = INVOICE_TAX_RATES.find((candidate) => String(candidate) === value);
            if (rate !== undefined) onChange({ ...position, taxRateBasisPoints: rate });
          }}
          disabled={disabled}
        >
          <SelectTrigger id={taxId} className="w-full">
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
        <span className="sr-only">Betrag netto: </span>
        {amountCents === null ? '–' : formatEuroCents(amountCents)}
      </p>
    </div>
  );
}

/** Einheit, empty while an article's stored unit is outside the list: the office picks one. */
function PositionUnitField({
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
        onChange={(unit) => onChange({ ...position, unit })}
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
