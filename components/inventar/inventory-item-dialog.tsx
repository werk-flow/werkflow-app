'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
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
import type { InventoryCategory, InventoryLocation } from '@/lib/inventory/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { getItemNumberFieldErrors, type ItemFormState } from './inventory-form-state';
import {
  ItemMasterDataFields,
  ItemNotesFields,
  ItemStockFields,
  ItemSupplierFields,
} from './inventory-item-form-fields';
import { parseDecimalInput } from '@/lib/ui/decimal';

export function ItemDialog({
  open,
  onOpenChange,
  form,
  setForm,
  categories,
  suppliers,
  locations,
  isSaving,
  error,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ItemFormState;
  setForm: (form: ItemFormState) => void;
  categories: InventoryCategory[];
  suppliers: Array<{ id: string; name: string }>;
  locations: InventoryLocation[];
  isSaving: boolean;
  error: string | null;
  onSave: () => void;
}) {
  const initialQuantity = parseDecimalInput(form.initialQuantity);
  const [attempted, setAttempted] = useState(false);
  // A reopened dialog starts without the previous attempt's errors (adjust state on prop change).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setAttempted(false);
  }
  const fieldErrors = {
    'inventory-item-name': form.name.trim() ? undefined : 'Bitte gib einen Namen ein.',
    'inventory-item-initial-location':
      !form.id && initialQuantity > 0 && !form.initialLocationId
        ? 'Wähle ein Lager für den Startbestand.'
        : undefined,
    ...getItemNumberFieldErrors(form),
  };
  const shownErrors: Partial<typeof fieldErrors> = attempted ? fieldErrors : {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isSaving}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>{form.id ? 'Artikel bearbeiten' : 'Artikel anlegen'}</DialogTitle>
          <DialogDescription>
            Stammdaten, Lagerkennzahlen und Barcode für den Inventarartikel.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (focusFirstInvalidField(fieldErrors)) return;
            onSave();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="grid gap-4 py-1 sm:grid-cols-2">
            <ItemMasterDataFields
              form={form}
              setForm={setForm}
              categories={categories}
              nameError={shownErrors['inventory-item-name']}
            />
            <ItemStockFields
              form={form}
              setForm={setForm}
              locations={locations}
              initialQuantity={initialQuantity}
              initialLocationError={shownErrors['inventory-item-initial-location']}
              numberErrors={shownErrors}
            />
            <ItemSupplierFields
              form={form}
              setForm={setForm}
              suppliers={suppliers}
              numberErrors={shownErrors}
            />
            <ItemNotesFields form={form} setForm={setForm} />
            <div className="sm:col-span-2">
              <ErrorText>{error}</ErrorText>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button pending={isSaving} type="submit" disabled={isSaving}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
