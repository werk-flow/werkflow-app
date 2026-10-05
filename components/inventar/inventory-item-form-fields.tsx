'use client';

import { useMemo } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SelectWithCreate } from '@/components/ui/select-with-create';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type {
  InventoryCategory,
  InventoryItemType,
  InventoryLocation,
  InventoryUnitOption,
} from '@/lib/inventory/types';
import {
  formatInventoryQuantity,
  getInventoryUnitLabel,
  INVENTORY_ITEM_TYPE_LABELS,
  INVENTORY_UNIT_OPTIONS,
} from '@/lib/inventory/types';
import { getItemNumberFieldErrors, NONE_VALUE, type ItemFormState } from './inventory-form-state';
import { LocationSelectWithCreate } from './location-select-with-create';
import { NEW_SUPPLIER_VALUE, SupplierQuickCreateDialog } from './supplier-quick-create-dialog';

type ItemFieldsProps = {
  form: ItemFormState;
  setForm: (form: ItemFormState) => void;
};

/** Number-field errors after a submit attempt, keyed by control id. */
type NumberFieldErrors = Partial<ReturnType<typeof getItemNumberFieldErrors>>;

// The four field groups of the item dialog. Each renders straight into the
// dialog body's grid, so none of them adds a wrapper element.

export function ItemMasterDataFields({
  form,
  setForm,
  categories,
  nameError,
}: ItemFieldsProps & {
  categories: InventoryCategory[];
  nameError: string | undefined;
}) {
  const unitOptions: InventoryUnitOption[] = INVENTORY_UNIT_OPTIONS;

  return (
    <>
      <h3 className="text-sm font-semibold sm:col-span-2">Stammdaten</h3>
      <Field label="Name" htmlFor="inventory-item-name" required error={nameError}>
        <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      </Field>
      <Field label="Typ" htmlFor="inventory-item-type">
        <Select
          value={form.itemType}
          onValueChange={(value) => setForm({ ...form, itemType: value as InventoryItemType })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(INVENTORY_ITEM_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Kategorie" htmlFor="inventory-item-category">
        <SearchableSelect
          options={categories.map((category) => ({
            value: category.id,
            label: category.name,
          }))}
          value={form.categoryId === NONE_VALUE ? '' : form.categoryId}
          onChange={(value) => setForm({ ...form, categoryId: value || NONE_VALUE })}
          placeholder="Keine Kategorie"
          searchPlaceholder="Kategorie suchen …"
          emptyMessage="Keine Kategorie gefunden"
          allowNone
          noneLabel="Keine Kategorie"
        />
      </Field>
      <Field label="Einheit" htmlFor="inventory-item-unit">
        <SearchableSelect
          options={unitOptions}
          value={form.unit}
          onChange={(value) => setForm({ ...form, unit: value })}
          searchPlaceholder="Einheit suchen …"
          emptyMessage="Keine Einheit gefunden"
        />
      </Field>
    </>
  );
}

export function ItemStockFields({
  form,
  setForm,
  locations,
  initialQuantity,
  initialLocationError,
  numberErrors,
}: ItemFieldsProps & {
  locations: InventoryLocation[];
  initialQuantity: number;
  initialLocationError: string | undefined;
  numberErrors: NumberFieldErrors;
}) {
  return (
    <>
      <h3 className="border-t pt-4 text-sm font-semibold sm:col-span-2">Bestand & Kennzeichnung</h3>
      {!form.id && (
        <>
          <Field label="Lager" htmlFor="inventory-item-initial-location" error={initialLocationError}>
            <LocationSelectWithCreate
              locations={locations}
              value={form.initialLocationId}
              onValueChange={(value) => setForm({ ...form, initialLocationId: value })}
              placeholder="Lager wählen oder erstellen"
              allowNone
              noneLabel="Noch kein Lager"
            />
          </Field>
          <Field
            label="Startbestand"
            htmlFor="inventory-item-initial-quantity"
            description={
              initialQuantity > 0
                ? `Beim Speichern werden ${formatInventoryQuantity(
                    initialQuantity,
                    form.unit,
                  )} in das gewählte Lager gebucht.`
                : 'Ohne Startbestand wird nur der Artikel angelegt.'
            }
          >
            <QuantityStepper
              value={form.initialQuantity}
              onChange={(value) => setForm({ ...form, initialQuantity: value })}
              unitLabel={getInventoryUnitLabel(form.unit)}
              min={0}
            />
          </Field>
        </>
      )}
      <Field label="Interne SKU" htmlFor="inventory-item-internal-sku">
        <Input
          value={form.internalSku}
          onChange={(event) => setForm({ ...form, internalSku: event.target.value })}
        />
      </Field>
      <Field label="Barcode" htmlFor="inventory-item-barcode">
        <Input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} />
      </Field>
      <Field
        label="Mindestbestand"
        htmlFor="inventory-item-minimum-stock"
        error={numberErrors['inventory-item-minimum-stock']}
      >
        <Input
          inputMode="decimal"
          value={form.globalMinimumStock}
          onChange={(event) => setForm({ ...form, globalMinimumStock: event.target.value })}
        />
      </Field>
      <Field
        label="Zielbestand"
        htmlFor="inventory-item-target-stock"
        error={numberErrors['inventory-item-target-stock']}
      >
        <Input
          inputMode="decimal"
          value={form.globalTargetStock}
          onChange={(event) => setForm({ ...form, globalTargetStock: event.target.value })}
        />
      </Field>
    </>
  );
}

export function ItemSupplierFields({
  form,
  setForm,
  suppliers,
  numberErrors,
}: ItemFieldsProps & {
  suppliers: Array<{ id: string; name: string }>;
  numberErrors: NumberFieldErrors;
}) {
  const supplierItems = useMemo(() => {
    const items: Array<{ id: string; name: string }> = [...suppliers];
    if (form.supplierId === NEW_SUPPLIER_VALUE && form.supplierName) {
      items.push({ id: NEW_SUPPLIER_VALUE, name: `${form.supplierName} (neu)` });
    }
    return items;
  }, [suppliers, form.supplierId, form.supplierName]);

  return (
    <>
      <h3 className="border-t pt-4 text-sm font-semibold sm:col-span-2">Lieferant & Preise</h3>
      <Field label="Hersteller" htmlFor="inventory-item-manufacturer">
        <Input
          value={form.manufacturer}
          onChange={(event) => setForm({ ...form, manufacturer: event.target.value })}
        />
      </Field>
      <Field label="Lieferant" htmlFor="inventory-item-supplier">
        <SelectWithCreate
          items={supplierItems}
          getOption={(supplier) => ({
            value: supplier.id,
            label: supplier.name,
          })}
          value={form.supplierId === NONE_VALUE ? '' : form.supplierId}
          onValueChange={(value) => {
            // The quick-create path writes id and name atomically via
            // onCreated below; skipping here avoids an ordering dependency
            // between the two same-tick setForm calls.
            if (value === NEW_SUPPLIER_VALUE) return;
            setForm({
              ...form,
              supplierId: value || NONE_VALUE,
              // A picked existing supplier clears any pending new name.
              supplierName: '',
            });
          }}
          createLabel="Neuen Lieferanten anlegen"
          renderCreateDialog={({ open: createOpen, onOpenChange: onCreateOpenChange, onCreated }) => (
            <SupplierQuickCreateDialog
              open={createOpen}
              onOpenChange={onCreateOpenChange}
              onCreated={onCreated}
            />
          )}
          onCreated={(supplier) =>
            setForm({
              ...form,
              supplierId: NEW_SUPPLIER_VALUE,
              supplierName: supplier.name,
            })
          }
          placeholder="Kein Lieferant"
          searchPlaceholder="Lieferant suchen …"
          emptyMessage="Kein Lieferant gefunden"
          allowNone
          noneLabel="Kein Lieferant"
        />
      </Field>
      <Field label="Lieferanten-Nr." htmlFor="inventory-item-supplier-number">
        <Input
          value={form.supplierArticleNumber}
          onChange={(event) => setForm({ ...form, supplierArticleNumber: event.target.value })}
        />
      </Field>
      <Field
        label="Einkaufspreis"
        htmlFor="inventory-item-purchase-price"
        error={numberErrors['inventory-item-purchase-price']}
      >
        <Input
          inputMode="decimal"
          value={form.purchasePrice}
          onChange={(event) => setForm({ ...form, purchasePrice: event.target.value })}
        />
      </Field>
      <Field
        label="Verkaufspreis"
        htmlFor="inventory-item-sale-price"
        error={numberErrors['inventory-item-sale-price']}
      >
        <Input
          inputMode="decimal"
          value={form.salePrice}
          onChange={(event) => setForm({ ...form, salePrice: event.target.value })}
        />
      </Field>
      <div className="flex items-center gap-2 rounded-md border px-3 py-2">
        <Checkbox
          id="inventory-item-billable"
          checked={form.isBillable}
          onCheckedChange={(checked) => setForm({ ...form, isBillable: checked === true })}
        />
        <Label htmlFor="inventory-item-billable">Abrechenbar</Label>
      </div>
    </>
  );
}

export function ItemNotesFields({ form, setForm }: ItemFieldsProps) {
  return (
    <>
      <h3 className="border-t pt-4 text-sm font-semibold sm:col-span-2">Beschreibung & Notizen</h3>
      <div className="sm:col-span-2">
        <Field label="Beschreibung" htmlFor="inventory-item-description">
          <Textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Notizen" htmlFor="inventory-item-notes">
          <Textarea
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </Field>
      </div>
    </>
  );
}
