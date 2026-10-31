'use client';

import { useLayoutEffect, useRef, useState } from 'react';

import { useServerAction } from '@/hooks/use-server-action';

import { SelectWithCreate } from '@/components/ui/select-with-create';
import type { SearchableSelectOption } from '@/components/ui/searchable-select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { describeFailure } from '@/lib/action-messages';
import { createInventoryLocation } from '@/lib/inventory/actions';
import type { InventoryLocation, InventoryLocationType } from '@/lib/inventory/types';
import { INVENTORY_LOCATION_TYPE_LABELS } from '@/lib/inventory/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { LocationTypeSelect } from './location-type-select';

type LocationSelectWithCreateProps = {
  id?: string;
  locations: InventoryLocation[];
  value: string;
  onValueChange: (value: string) => void;
  onLocationCreated?: (location: InventoryLocation) => void;
  disabled?: boolean;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
};

function locationOption(location: InventoryLocation): SearchableSelectOption {
  return {
    value: location.id,
    label: location.name,
    description: INVENTORY_LOCATION_TYPE_LABELS[location.locationType],
  };
}

export function LocationSelectWithCreate({
  id,
  locations,
  value,
  onValueChange,
  onLocationCreated,
  disabled,
  placeholder = 'Lager wählen',
  allowNone = false,
  noneLabel = 'Kein Lager',
}: LocationSelectWithCreateProps) {
  return (
    <SelectWithCreate
      id={id}
      items={locations}
      getOption={locationOption}
      value={value}
      onValueChange={onValueChange}
      onCreated={onLocationCreated}
      placeholder={placeholder}
      searchPlaceholder="Lager suchen…"
      emptyMessage="Kein Lager gefunden"
      disabled={disabled}
      allowNone={allowNone}
      noneLabel={noneLabel}
      createLabel="Neues Lager erstellen"
      renderCreateDialog={({ open, onOpenChange, onCreated }) => (
        <CreateLocationDialog open={open} onOpenChange={onOpenChange} onCreated={onCreated} />
      )}
    />
  );
}

const CREATE_LOCATION_ERROR_MESSAGES = {
  name_required: 'Bitte gib einen Namen ein.',
  not_authorized: 'Du hast keine Berechtigung, Lager anzulegen.',
} satisfies Record<string, string>;

function getCreateLocationErrorMessage(error: string): string {
  return describeFailure(
    error,
    CREATE_LOCATION_ERROR_MESSAGES,
    'Das Lager konnte nicht erstellt werden. Prüfe den Namen und versuche es erneut.',
  );
}

/** The quick-create form's values, its validation and the create call. */
function useQuickLocationForm(
  onOpenChange: (open: boolean) => void,
  onCreated: (location: InventoryLocation) => void,
) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [locationType, setLocationType] = useState<InventoryLocationType>('room');
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  // The save completes after later renders; the parent's latest handler must
  // receive the location, or a handler from the submit-time render replays a
  // stale snapshot of the parent's state.
  const onCreatedRef = useRef(onCreated);
  useLayoutEffect(() => {
    onCreatedRef.current = onCreated;
  });
  // `isPending` is set before the first await, so the button spins in the
  // first frame; the parent select adopts the new location via onCreated.
  const { run: runCreateLocation, isPending } = useServerAction(createInventoryLocation);

  function handleSave() {
    const nameMessage = name.trim() ? undefined : 'Bitte gib dem Lager einen Namen.';
    setNameError(nameMessage ?? null);
    if (focusFirstInvalidField({ 'quick-location-name': nameMessage })) return;
    setError(null);
    void (async () => {
      // A thrown call (network, aborted request) must surface like a failed one.
      const result = await runCreateLocation({
        name,
        description,
        locationType,
      }).catch(() => null);

      if (!result?.success) {
        setError(getCreateLocationErrorMessage(result?.error ?? 'create_failed'));
        return;
      }

      onCreatedRef.current(result.location);
      setName('');
      setDescription('');
      setLocationType('room');
      onOpenChange(false);
    })();
  }

  return {
    name,
    setName,
    description,
    setDescription,
    locationType,
    setLocationType,
    error,
    nameError,
    isPending,
    handleSave,
  };
}

function CreateLocationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (location: InventoryLocation) => void;
}) {
  const {
    name,
    setName,
    description,
    setDescription,
    locationType,
    setLocationType,
    error,
    nameError,
    isPending,
    handleSave,
  } = useQuickLocationForm(onOpenChange, onCreated);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lager erstellen</DialogTitle>
          <DialogDescription>
            Lege einen Lagerraum, ein Regal oder ein Fahrzeug direkt hier an.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!isPending) handleSave();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="space-y-4">
              <Field label="Name" htmlFor="quick-location-name" required error={nameError}>
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label="Typ" htmlFor="quick-location-type">
                <LocationTypeSelect value={locationType} onValueChange={setLocationType} />
              </Field>
              <Field label="Beschreibung" htmlFor="quick-location-description">
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
              </Field>
            </div>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Abbrechen
            </Button>
            <Button pending={isPending} type="submit" disabled={isPending}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
