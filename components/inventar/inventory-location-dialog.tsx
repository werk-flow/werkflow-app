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
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { InventoryLocationType } from '@/lib/inventory/types';
import { INVENTORY_LOCATION_TYPE_LABELS } from '@/lib/inventory/types';
import type { LocationFormState } from './inventory-form-state';

// Create-only dialog: it closes on submit and the Lager tab shows the pending
// card, so it carries no pending state; a refused create reopens it with the error.
export function LocationDialog({
  open,
  onOpenChange,
  form,
  setForm,
  onSave,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: LocationFormState;
  setForm: (form: LocationFormState) => void;
  onSave: () => void;
  error: string | null;
}) {
  const [attempted, setAttempted] = useState(false);
  // A reopened dialog starts without the previous attempt's errors (adjust state on prop change).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setAttempted(false);
  }
  const nameError = attempted && !form.name.trim() ? 'Bitte gib einen Namen ein.' : undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lager anlegen</DialogTitle>
          <DialogDescription>Räume, Lagerhallen, Regale oder Fahrzeuge.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (!form.name.trim()) {
              document.getElementById('inventory-location-name')?.focus();
              return;
            }
            onSave();
          }}
          noValidate
          className="space-y-4"
        >
          <Field label="Name" htmlFor="inventory-location-name" required error={nameError}>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Typ" htmlFor="inventory-location-type">
            <Select
              value={form.locationType}
              onValueChange={(value) => setForm({ ...form, locationType: value as InventoryLocationType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(INVENTORY_LOCATION_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Beschreibung" htmlFor="inventory-location-description">
            <Textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit">Speichern</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
