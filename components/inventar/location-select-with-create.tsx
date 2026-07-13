'use client';

import { useMemo, useState, useTransition } from 'react';
import { Loader2, Plus } from 'lucide-react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/components/ui/searchable-select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createInventoryLocation } from '@/lib/inventory/actions';
import type { InventoryLocation, InventoryLocationType } from '@/lib/inventory/types';
import { INVENTORY_LOCATION_TYPE_LABELS } from '@/lib/inventory/types';

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
  const [createOpen, setCreateOpen] = useState(false);
  const [localLocations, setLocalLocations] = useState<InventoryLocation[]>([]);

  const allLocations = useMemo(() => {
    const merged = [...locations];
    for (const location of localLocations) {
      if (!merged.some((entry) => entry.id === location.id)) {
        merged.push(location);
      }
    }
    return merged;
  }, [locations, localLocations]);

  const options: SearchableSelectOption[] = useMemo(
    () =>
      allLocations.map((location) => ({
        value: location.id,
        label: location.name,
        description: INVENTORY_LOCATION_TYPE_LABELS[location.locationType],
      })),
    [allLocations]
  );

  function handleCreated(location: InventoryLocation) {
    setLocalLocations((current) => [...current, location]);
    onValueChange(location.id);
    onLocationCreated?.(location);
  }

  return (
    <>
      <SearchableSelect
        id={id}
        options={options}
        value={value}
        onChange={onValueChange}
        placeholder={placeholder}
        searchPlaceholder="Lager suchen..."
        emptyMessage="Kein Lager gefunden"
        disabled={disabled}
        allowNone={allowNone}
        noneLabel={noneLabel}
        action={{
          label: 'Neues Lager erstellen',
          icon: <Plus className="size-4" />,
          onClick: () => setCreateOpen(true),
        }}
      />

      <CreateLocationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </>
  );
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
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [locationType, setLocationType] = useState<InventoryLocationType>('room');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await createInventoryLocation({
        name,
        description,
        locationType,
      });

      if (!result.success) {
        setError('Das Lager konnte nicht erstellt werden. Prüfe den Namen und versuche es erneut.');
        return;
      }

      onCreated(result.location);
      setName('');
      setDescription('');
      setLocationType('room');
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lager erstellen</DialogTitle>
          <DialogDescription>
            Lege einen Lagerraum, ein Regal oder ein Fahrzeug direkt hier an.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="quick-location-name">Name</Label>
            <Input
              id="quick-location-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-location-type">Typ</Label>
            <Select
              value={locationType}
              onValueChange={(value) => setLocationType(value as InventoryLocationType)}
            >
              <SelectTrigger id="quick-location-type">
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-location-description">Beschreibung</Label>
            <Textarea
              id="quick-location-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Abbrechen
          </Button>
          <Button onClick={handleSave} disabled={isPending || !name.trim()}>
            {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
