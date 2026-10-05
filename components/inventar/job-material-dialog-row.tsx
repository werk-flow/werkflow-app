'use client';

import { parseDecimalInput } from '@/lib/ui/decimal';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import type { InventoryLocation, InventoryPickerOption } from '@/lib/inventory/types';
import {
  formatInventoryQuantity,
  getInventoryUnitLabel,
  INVENTORY_ITEM_TYPE_LABELS,
} from '@/lib/inventory/types';
import { cn } from '@/lib/utils';
import {
  getLocationOptions,
  type MaterialDialogMode,
  type MaterialDialogRow,
} from './job-material-dialog-model';

/** One selected position of the material dialog: quantity, location, note and its effect. */
export function MaterialDialogRowCard({
  row,
  item,
  locations,
  mode,
  canRemove,
  onChange,
  onRemove,
}: {
  row: MaterialDialogRow;
  /** Undefined when the catalog page no longer holds the row's item. */
  item: InventoryPickerOption | undefined;
  locations: InventoryLocation[];
  mode: MaterialDialogMode;
  canRemove: boolean;
  onChange: (patch: Partial<MaterialDialogRow>) => void;
  onRemove: () => void;
}) {
  const locationOptions = getLocationOptions(item, locations, mode);
  const unitLabel = item ? getInventoryUnitLabel(item.unit) : '';
  const effectQuantity = item
    ? formatInventoryQuantity(parseDecimalInput(row.quantity), item.unit)
    : row.quantity;
  const fieldIdPrefix = `material-row-${row.key}`;

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item?.name ?? 'Artikel'}</p>
          <p className="text-xs text-muted-foreground">
            {item?.categoryName ?? INVENTORY_ITEM_TYPE_LABELS[item?.itemType ?? 'material']}
          </p>
        </div>
        {canRemove && (
          <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" onClick={onRemove}>
            <X className="size-3.5" />
            <span className="sr-only">Position entfernen</span>
          </Button>
        )}
      </div>

      <div className="space-y-3">
        <Field label="Menge" htmlFor={`${fieldIdPrefix}-quantity`} required>
          <QuantityStepper
            value={row.quantity}
            onChange={(value) => onChange({ quantity: value })}
            unitLabel={unitLabel}
            min={0}
          />
        </Field>
        <Field
          label="Lager"
          htmlFor={`${fieldIdPrefix}-location`}
          required={mode === 'take' || mode === 'return'}
        >
          <SearchableSelect
            options={locationOptions.map((location) => ({
              value: location.id,
              label: location.label,
            }))}
            value={row.locationId}
            onChange={(value) => onChange({ locationId: value })}
            placeholder={mode === 'plan' || mode === 'edit' ? 'Nicht festgelegt' : 'Lager wählen'}
            searchPlaceholder="Lager suchen …"
            emptyMessage="Kein Lager gefunden"
            allowNone={mode === 'plan' || mode === 'edit'}
            noneLabel="Nicht festgelegt"
          />
        </Field>
        <Field label="Notiz" htmlFor={`${fieldIdPrefix}-notes`}>
          <Textarea value={row.notes} onChange={(event) => onChange({ notes: event.target.value })} />
        </Field>
        <p
          className={cn(
            'rounded-md px-3 py-2 text-xs',
            mode === 'take' && 'bg-destructive-soft text-destructive-soft-foreground',
            mode === 'return' && 'bg-success-soft text-success-soft-foreground',
            (mode === 'plan' || mode === 'edit') && 'bg-info-soft text-info-soft-foreground',
          )}
        >
          {mode === 'take'
            ? `Diese Zeile zieht ${effectQuantity} aus dem Lager ab.`
            : mode === 'return'
              ? `Diese Zeile legt ${effectQuantity} zurück ins Lager.`
              : 'Diese Zeile plant Bedarf. Der Bestand bleibt unverändert.'}
        </p>
      </div>
    </div>
  );
}
