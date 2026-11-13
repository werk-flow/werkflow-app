'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SelectWithCreate } from '@/components/ui/select-with-create';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import type { SaveArticleSupplierInput } from '@/lib/inventory/action-schemas';
import type { ArticleSupplierReference } from '@/lib/inventory/article-price-terms';
import { getInventoryUnitLabel } from '@/lib/inventory/types';
import { OFFERED_INVENTORY_UNITS } from '@/lib/inventory/units';
import { parseDecimalInput } from '@/lib/ui/decimal';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { describePack } from '@/lib/inventory/article-terms-format';
import { NEW_SUPPLIER_VALUE, SupplierQuickCreateDialog } from './supplier-quick-create-dialog';

/** The purchase-unit choice „in the base unit“. */
const BASE_UNIT_VALUE = '__base_unit__';

export const ARTICLE_TERMS_FAILURE_MESSAGES: Record<string, string> = {
  item_not_found: 'Der Artikel wurde nicht gefunden.',
  supplier_not_found: 'Der ausgewählte Lieferant wurde nicht gefunden.',
  supplier_required: 'Bitte wähle einen Lieferanten aus.',
  supplier_reference_not_found: 'Dieser Lieferant ist nicht mehr am Artikel hinterlegt.',
  supplier_reference_taken:
    'Diese Artikelnummer ist bei diesem Lieferanten schon einem Artikel zugeordnet. Prüfe die Nummer.',
  invalid_conversion: 'Bitte gib beide Mengen der Umrechnung größer als 0 an.',
};

type SupplierForm = {
  supplierId: string;
  supplierName: string;
  supplierArticleNumber: string;
  purchaseUnit: string;
  packQuantity: string;
  baseQuantity: string;
  isPreferred: boolean;
};

const decimalText = (value: number) => String(value).replace('.', ',');

function initialForm(
  reference: ArticleSupplierReference | null,
  isFirst: boolean,
  orphanArticleNumber: string | null,
): SupplierForm {
  if (!reference) {
    return {
      supplierId: '',
      supplierName: '',
      supplierArticleNumber: isFirst ? (orphanArticleNumber ?? '') : '',
      purchaseUnit: BASE_UNIT_VALUE,
      packQuantity: '1',
      baseQuantity: '1',
      isPreferred: isFirst,
    };
  }
  return {
    supplierId: reference.supplierId,
    supplierName: '',
    supplierArticleNumber: reference.supplierArticleNumber ?? '',
    purchaseUnit: reference.purchaseUnit ?? BASE_UNIT_VALUE,
    packQuantity: decimalText(reference.packQuantity),
    baseQuantity: decimalText(reference.baseQuantity),
    isPreferred: reference.isPreferred,
  };
}

const POSITIVE_DECIMAL = /^\d+([.,]\d{1,3})?$/;
const QUANTITY_MESSAGE = 'Bitte gib eine Menge größer als 0 an, zum Beispiel 1 oder 2,5.';

function quantityError(value: string): string | undefined {
  return POSITIVE_DECIMAL.test(value.trim()) && parseDecimalInput(value) > 0 ? undefined : QUANTITY_MESSAGE;
}

/** The form's errors, keyed by control id in visual order. */
function supplierFormErrors(form: SupplierForm) {
  const hasPack = form.purchaseUnit !== BASE_UNIT_VALUE;
  return {
    'article-supplier-supplier': form.supplierId ? undefined : 'Bitte wähle einen Lieferanten aus.',
    'article-supplier-pack-quantity': hasPack ? quantityError(form.packQuantity) : undefined,
    'article-supplier-base-quantity': hasPack ? quantityError(form.baseQuantity) : undefined,
  };
}

/** The save input of the form; a pack only with a purchase unit other than the base unit. */
function toSaveInput(
  form: SupplierForm,
  itemId: string,
  referenceId: string | null,
): SaveArticleSupplierInput {
  const isNew = form.supplierId === NEW_SUPPLIER_VALUE;
  const hasPack = form.purchaseUnit !== BASE_UNIT_VALUE;
  return {
    itemId,
    referenceId,
    supplierId: isNew ? null : form.supplierId,
    supplierName: isNew ? form.supplierName : null,
    supplierArticleNumber: form.supplierArticleNumber,
    purchaseUnit: hasPack ? form.purchaseUnit : null,
    packQuantity: hasPack ? parseDecimalInput(form.packQuantity) : 1,
    baseQuantity: hasPack ? parseDecimalInput(form.baseQuantity) : 1,
    isPreferred: form.isPreferred,
  };
}

type FormPart = { form: SupplierForm; setForm: (form: SupplierForm) => void };

/** The supplier: one of the organization's, or a new one created with the reference. */
function SupplierPickerField({
  form,
  setForm,
  suppliers,
  error,
}: FormPart & { suppliers: Array<{ id: string; name: string }>; error: string | undefined }) {
  const supplierItems = useMemo(() => {
    const items = [...suppliers];
    if (form.supplierId === NEW_SUPPLIER_VALUE && form.supplierName) {
      items.push({ id: NEW_SUPPLIER_VALUE, name: `${form.supplierName} (neu)` });
    }
    return items;
  }, [suppliers, form.supplierId, form.supplierName]);
  return (
    <Field label="Lieferant" htmlFor="article-supplier-supplier" required error={error}>
      <SelectWithCreate
        items={supplierItems}
        getOption={(supplier) => ({ value: supplier.id, label: supplier.name })}
        value={form.supplierId}
        onValueChange={(value) => {
          // The quick-create path sets id and name together in onCreated.
          if (value === NEW_SUPPLIER_VALUE) return;
          setForm({ ...form, supplierId: value, supplierName: '' });
        }}
        createLabel="Neuen Lieferanten anlegen"
        renderCreateDialog={({ open, onOpenChange, onCreated }) => (
          <SupplierQuickCreateDialog open={open} onOpenChange={onOpenChange} onCreated={onCreated} />
        )}
        onCreated={(supplier) =>
          setForm({ ...form, supplierId: NEW_SUPPLIER_VALUE, supplierName: supplier.name })
        }
        placeholder="Lieferant wählen"
        searchPlaceholder="Lieferant suchen …"
        emptyMessage="Kein Lieferant gefunden"
      />
    </Field>
  );
}

/** The purchase unit and, for a pack, its two quantities read back as a sentence. */
function PackFields({
  form,
  setForm,
  baseUnit,
  errors,
}: FormPart & { baseUnit: string; errors: Partial<ReturnType<typeof supplierFormErrors>> }) {
  const unitOptions = useMemo(
    () => [
      { value: BASE_UNIT_VALUE, label: `${getInventoryUnitLabel(baseUnit)} (Basiseinheit)` },
      ...OFFERED_INVENTORY_UNITS.filter((unit) => unit.code !== baseUnit).map((unit) => ({
        value: unit.code,
        label: unit.label,
      })),
    ],
    [baseUnit],
  );
  const hasPack = form.purchaseUnit !== BASE_UNIT_VALUE;
  const valid = !quantityError(form.packQuantity) && !quantityError(form.baseQuantity);
  const packSentence = valid
    ? describePack(
        {
          purchaseUnit: form.purchaseUnit,
          packQuantity: parseDecimalInput(form.packQuantity),
          baseQuantity: parseDecimalInput(form.baseQuantity),
        },
        baseUnit,
      )
    : null;
  return (
    <>
      <Field
        label="Bestelleinheit"
        htmlFor="article-supplier-purchase-unit"
        description="In welcher Einheit du bei diesem Lieferanten bestellst."
      >
        <SearchableSelect
          options={unitOptions}
          value={form.purchaseUnit}
          onChange={(value) => setForm({ ...form, purchaseUnit: value || BASE_UNIT_VALUE })}
          placeholder="Einheit wählen"
          searchPlaceholder="Einheit suchen …"
          emptyMessage="Keine Einheit gefunden"
        />
      </Field>
      {hasPack ? (
        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <Field
            label={`Menge in ${getInventoryUnitLabel(form.purchaseUnit)}`}
            htmlFor="article-supplier-pack-quantity"
            error={errors['article-supplier-pack-quantity']}
          >
            <Input
              inputMode="decimal"
              autoComplete="off"
              value={form.packQuantity}
              onChange={(event) => setForm({ ...form, packQuantity: event.target.value })}
            />
          </Field>
          <Field
            label={`entspricht ${getInventoryUnitLabel(baseUnit)}`}
            htmlFor="article-supplier-base-quantity"
            error={errors['article-supplier-base-quantity']}
          >
            <Input
              inputMode="decimal"
              autoComplete="off"
              value={form.baseQuantity}
              onChange={(event) => setForm({ ...form, baseQuantity: event.target.value })}
            />
          </Field>
          <p className="col-span-2 text-sm text-muted-foreground" aria-live="polite">
            {packSentence
              ? `Umrechnung: ${packSentence}.`
              : 'Gib beide Mengen an, dann steht hier die Umrechnung.'}
          </p>
        </div>
      ) : null}
    </>
  );
}

/** The fields of one reference; the preferred mark is locked on the preferred or first reference. */
function SupplierFormBody({
  form,
  setForm,
  suppliers,
  baseUnit,
  errors,
  error,
  preferredLocked,
}: FormPart & {
  suppliers: Array<{ id: string; name: string }>;
  baseUnit: string;
  errors: Partial<ReturnType<typeof supplierFormErrors>>;
  error: string | null;
  preferredLocked: boolean;
}) {
  return (
    <DialogBody className="grid gap-4 py-1 sm:grid-cols-2">
      <SupplierPickerField
        form={form}
        setForm={setForm}
        suppliers={suppliers}
        error={errors['article-supplier-supplier']}
      />
      <Field label="Artikelnummer des Lieferanten" htmlFor="article-supplier-number">
        <Input
          value={form.supplierArticleNumber}
          autoComplete="off"
          onChange={(event) => setForm({ ...form, supplierArticleNumber: event.target.value })}
        />
      </Field>
      <PackFields form={form} setForm={setForm} baseUnit={baseUnit} errors={errors} />
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 sm:col-span-2">
        <Checkbox
          id="article-supplier-preferred"
          checked={form.isPreferred}
          disabled={preferredLocked}
          onCheckedChange={(checked) => setForm({ ...form, isPreferred: checked === true })}
        />
        <Label htmlFor="article-supplier-preferred">Bevorzugter Lieferant</Label>
      </div>
      <div className="sm:col-span-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </DialogBody>
  );
}

/**
 * Adds or changes one supplier reference of an article: supplier, its article
 * number and the purchase unit with its conversion to the base unit, which the
 * dialog reads back as a sentence before it saves.
 */
export function ArticleSupplierDialog({
  itemId,
  baseUnit,
  reference,
  isFirst,
  orphanArticleNumber,
  suppliers,
  onClose,
  onSave,
}: {
  itemId: string;
  baseUnit: string;
  /** The reference to change, or `null` to add one. */
  reference: ArticleSupplierReference | null;
  /** The article has no reference yet: the new one becomes preferred. */
  isFirst: boolean;
  /** An article number the article carries without a supplier, offered for its first reference. */
  orphanArticleNumber: string | null;
  suppliers: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (input: SaveArticleSupplierInput) => Promise<ActionResult<{ referenceId: string }> | null>;
}) {
  const [form, setForm] = useState(() => initialForm(reference, isFirst, orphanArticleNumber));
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();
  const errors = supplierFormErrors(form);
  const shown: Partial<typeof errors> = attempted ? errors : {};

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    // A nested dialog's submit would also submit the article form behind it.
    event.stopPropagation();
    setAttempted(true);
    if (focusFirstInvalidField(errors)) return;
    void run(async () => {
      setError(null);
      const result = await onSave(toSaveInput(form, itemId, reference?.id ?? null)).catch(() => null);
      if (!result?.success) {
        const fallback = 'Der Lieferant konnte nicht gespeichert werden.';
        setError(describeFailure(result?.error ?? 'save_failed', ARTICLE_TERMS_FAILURE_MESSAGES, fallback));
        return;
      }
      onClose();
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={isPending}>
      <DialogContent size="lg">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{reference ? 'Lieferant bearbeiten' : 'Lieferant hinzufügen'}</DialogTitle>
            <DialogDescription>
              Artikelnummer und Packungsgröße, wie der Lieferant den Artikel verkauft.
            </DialogDescription>
          </DialogHeader>
          <SupplierFormBody
            form={form}
            setForm={setForm}
            suppliers={suppliers}
            baseUnit={baseUnit}
            errors={shown}
            error={error}
            preferredLocked={reference?.isPreferred === true || isFirst}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Abbrechen
            </Button>
            <Button type="submit" pending={isPending} disabled={isPending}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
