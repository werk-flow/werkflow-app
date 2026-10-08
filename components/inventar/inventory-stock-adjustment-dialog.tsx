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
import { Label } from '@/components/ui/label';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Textarea } from '@/components/ui/textarea';
import type { InventoryLocation } from '@/lib/inventory/types';
import { formatInventoryQuantity, getInventoryUnitLabel } from '@/lib/inventory/types';
import { parseDecimalInput } from '@/lib/ui/decimal';
import { cn } from '@/lib/utils';
import { type StockDialogState } from './inventory-form-state';
import { LocationSelectWithCreate } from './location-select-with-create';

export function StockAdjustmentDialog({
  state,
  setState,
  locations,
  isSaving,
  error,
  onSave,
}: {
  state: StockDialogState;
  setState: (state: StockDialogState) => void;
  locations: InventoryLocation[];
  isSaving: boolean;
  error: string | null;
  onSave: () => void;
}) {
  const quantity = state ? parseDecimalInput(state.quantity) : 0;
  const selectedLocation = state ? locations.find((location) => location.id === state.locationId) : null;
  const [attempted, setAttempted] = useState(false);
  // Another item starts without the previous item's errors (adjust state on prop change).
  const itemId = state?.item.id ?? null;
  const [attemptedItemId, setAttemptedItemId] = useState(itemId);
  if (itemId !== attemptedItemId) {
    setAttemptedItemId(itemId);
    setAttempted(false);
  }
  const locationError = attempted && state && !state.locationId ? 'Bitte wähle ein Lager.' : undefined;
  const quantityError =
    attempted && state && quantity <= 0 ? 'Bitte gib eine Menge größer als 0 ein.' : undefined;

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && setState(null)} pending={isSaving}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bestand ändern</DialogTitle>
          <DialogDescription>{state?.item.name}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (!state?.locationId) {
              document.getElementById('inventory-stock-location')?.focus();
              return;
            }
            if (quantity <= 0) {
              document.getElementById('inventory-stock-quantity')?.focus();
              return;
            }
            onSave();
          }}
          noValidate
          className="space-y-4"
        >
          {state && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label id="inventory-stock-action-label">Aktion</Label>
                <div
                  className="grid grid-cols-2 gap-2"
                  role="group"
                  aria-labelledby="inventory-stock-action-label"
                >
                  <Button
                    type="button"
                    variant={state.direction === 'add' ? 'default' : 'outline'}
                    onClick={() => setState({ ...state, direction: 'add' })}
                  >
                    Hinzufügen
                  </Button>
                  <Button
                    type="button"
                    variant={state.direction === 'remove' ? 'default' : 'outline'}
                    onClick={() => setState({ ...state, direction: 'remove' })}
                  >
                    Entnehmen
                  </Button>
                </div>
              </div>
              <Field label="Lager" htmlFor="inventory-stock-location" required error={locationError}>
                <LocationSelectWithCreate
                  locations={locations}
                  value={state.locationId}
                  onValueChange={(value) => setState({ ...state, locationId: value })}
                  placeholder="Lager wählen oder erstellen"
                />
              </Field>
              <Field
                label={`Menge (${getInventoryUnitLabel(state.item.unit)})`}
                htmlFor="inventory-stock-quantity"
                required
                error={quantityError}
              >
                <QuantityStepper
                  value={state.quantity}
                  onChange={(value) => setState({ ...state, quantity: value })}
                  unitLabel={getInventoryUnitLabel(state.item.unit)}
                  min={0}
                />
              </Field>
              <Field label="Grund" htmlFor="inventory-stock-reason">
                <Textarea
                  value={state.reason}
                  onChange={(event) => setState({ ...state, reason: event.target.value })}
                />
              </Field>
              <p
                className={cn(
                  'rounded-md px-3 py-2 text-sm',
                  state.direction === 'add'
                    ? 'bg-success-soft text-success-soft-foreground'
                    : 'bg-destructive-soft text-destructive-soft-foreground',
                )}
              >
                {state.direction === 'add'
                  ? `Diese Aktion fügt ${formatInventoryQuantity(
                      quantity,
                      state.item.unit,
                    )} ${selectedLocation ? `zu ${selectedLocation.name}` : 'zum Inventar'} hinzu.`
                  : `Diese Aktion zieht ${formatInventoryQuantity(
                      quantity,
                      state.item.unit,
                    )} ${selectedLocation ? `aus ${selectedLocation.name}` : 'aus dem Inventar'} ab.`}
              </p>
            </div>
          )}
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setState(null)} disabled={isSaving}>
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
