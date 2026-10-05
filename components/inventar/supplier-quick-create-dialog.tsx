'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/** Selection value of a supplier that is created with the item on save. */
export const NEW_SUPPLIER_VALUE = '__new_supplier__';

export function SupplierQuickCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (supplier: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // React synthetic submit events bubble through the portal along the REACT
    // tree: without stopPropagation this nested dialog's submit also fires the
    // surrounding ItemDialog form and saves the item prematurely.
    event.stopPropagation();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Bitte gib den Namen des Lieferanten ein.');
      document.getElementById('inventory-new-supplier-name')?.focus();
      return;
    }
    setNameError(null);
    // The supplier row itself is created server-side when the item is saved
    // (upsertInventoryItem's supplierName path); this dialog only stages the
    // name as the pending selection.
    onCreated({ id: NEW_SUPPLIER_VALUE, name: trimmed });
    setName('');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Neuen Lieferanten anlegen</DialogTitle>
          <DialogDescription>Der Lieferant wird beim Speichern des Artikels angelegt.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Field label="Name" htmlFor="inventory-new-supplier-name" required error={nameError}>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="z. B. Großhandel Nord GmbH"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit">Übernehmen</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
