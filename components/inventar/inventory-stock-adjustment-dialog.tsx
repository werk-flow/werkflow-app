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
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Textarea } from '@/components/ui/textarea';
import type { InventoryLocation } from '@/lib/inventory/types';
import { formatInventoryQuantity, getInventoryUnitLabel } from '@/lib/inventory/types';
import { parseDecimalInput } from '@/lib/ui/decimal';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { cn } from '@/lib/utils';
import { type StockDialogState } from './inventory-form-state';
import { LocationSelectWithCreate } from './location-select-with-create';

type StockAdjustmentDialogProps = {
  state: StockDialogState;
  setState: (state: StockDialogState) => void;
  locations: InventoryLocation[];
  isSaving: boolean;
  error: string | null;
  onSave: () => void;
};

/** An open adjustment: the item, the Lager, the direction and the entered values. */
type OpenStockDialogState = NonNullable<StockDialogState>;

export function StockAdjustmentDialog({
  state,
  setState,
  locations,
  isSaving,
  error,
  onSave,
}: StockAdjustmentDialogProps) {
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
  // Keyed by control id in visual order; shown after the first submit attempt.
  const validationErrors = {
    'inventory-stock-location': state && !state.locationId ? 'Bitte wähle ein Lager.' : undefined,
    'inventory-stock-quantity': state && quantity <= 0 ? 'Bitte gib eine Menge größer als 0 ein.' : undefined,
  };
  const locationError = attempted ? validationErrors['inventory-stock-location'] : undefined;
  const quantityError = attempted ? validationErrors['inventory-stock-quantity'] : undefined;

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
            if (!state || focusFirstInvalidField(validationErrors)) return;
            onSave();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody className="space-y-4">
            {state && (
              <StockAdjustmentFields
                state={state}
                setState={setState}
                locations={locations}
                quantity={quantity}
                selectedLocation={selectedLocation}
                locationError={locationError}
                quantityError={quantityError}
              />
            )}
            <ErrorText>{error}</ErrorText>
          </DialogBody>
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

/** The direction, Lager, quantity and reason of an open adjustment, with its effect. */
function StockAdjustmentFields({
  state,
  setState,
  locations,
  quantity,
  selectedLocation,
  locationError,
  quantityError,
}: {
  state: OpenStockDialogState;
  setState: (state: StockDialogState) => void;
  locations: InventoryLocation[];
  quantity: number;
  selectedLocation: InventoryLocation | null | undefined;
  locationError: string | undefined;
  quantityError: string | undefined;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label id="inventory-stock-action-label">Aktion</Label>
        <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="inventory-stock-action-label">
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
      <StockEffectNote state={state} quantity={quantity} selectedLocation={selectedLocation} />
    </div>
  );
}

/** What the booking will do, in words, before it is saved. */
function StockEffectNote({
  state,
  quantity,
  selectedLocation,
}: {
  state: OpenStockDialogState;
  quantity: number;
  selectedLocation: InventoryLocation | null | undefined;
}) {
  return (
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
  );
}
