'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { LocationSelectWithCreate } from '@/components/inventar/location-select-with-create';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { InlinePending } from '@/components/ui/inline-pending';
import { Input } from '@/components/ui/input';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { SelectWithCreate } from '@/components/ui/select-with-create';
import { Textarea } from '@/components/ui/textarea';
import type { InventoryLocation, InventoryPickerOption } from '@/lib/inventory/types';
import { formatDecimalDe, parseDecimalInput } from '@/lib/ui/decimal';
import { cn } from '@/lib/utils';
import type { WorkTemplateDraft } from '@/lib/work-templates/types';

import { newId, type CreateInventoryItemInput } from './work-template-editor-shared';

export function MaterialsEditor({
  draft,
  editable,
  onChange,
  onPatch,
  inventoryItems,
  inventoryLocations,
  onCreateItem,
  isItemPending,
}: {
  draft: WorkTemplateDraft;
  editable: boolean;
  onChange: (draft: WorkTemplateDraft) => void;
  onPatch: (patch: (current: WorkTemplateDraft) => WorkTemplateDraft) => void;
  inventoryItems: InventoryPickerOption[];
  inventoryLocations: InventoryLocation[];
  onCreateItem: (lineId: string, input: CreateInventoryItemInput) => void;
  isItemPending: (itemId: string) => boolean;
}) {
  function add() {
    onChange({
      ...draft,
      materials: [
        ...draft.materials,
        {
          id: newId(),
          itemId: '',
          preferredLocationId: null,
          plannedQuantity: 1,
          isBillable: true,
          notes: null,
          sortOrder: draft.materials.length,
        },
      ],
    });
  }
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Geplantes Material</h3>
          <p className="text-sm text-muted-foreground">
            Mengen werden geplant, nicht reserviert oder ausgebucht.
          </p>
        </div>
        {editable && (
          <Button type="button" size="sm" variant="outline" onClick={add}>
            <Plus className="size-4" />
            Material
          </Button>
        )}
      </div>
      {draft.materials.map((line) => (
        <WorkTemplateMaterialLine
          key={line.id}
          line={line}
          pending={isItemPending(line.itemId)}
          draft={draft}
          editable={editable}
          onChange={onChange}
          onPatch={onPatch}
          inventoryItems={inventoryItems}
          inventoryLocations={inventoryLocations}
          onCreateItem={onCreateItem}
        />
      ))}
    </section>
  );
}

function WorkTemplateMaterialLine({
  line,
  pending,
  draft,
  editable,
  onChange,
  onPatch,
  inventoryItems,
  inventoryLocations,
  onCreateItem,
}: {
  line: WorkTemplateDraft['materials'][number];
  pending: boolean;
  draft: WorkTemplateDraft;
  editable: boolean;
  onChange: (draft: WorkTemplateDraft) => void;
  onPatch: (patch: (current: WorkTemplateDraft) => WorkTemplateDraft) => void;
  inventoryItems: InventoryPickerOption[];
  inventoryLocations: InventoryLocation[];
  onCreateItem: (lineId: string, input: CreateInventoryItemInput) => void;
}) {
  return (
    <Card
      className={cn('gap-3 py-4', pending && 'opacity-70')}
      aria-busy={pending || undefined}
      data-testid="work-template-material"
      data-row-id={line.id}
    >
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <Field
          label={
            <span className="inline-flex items-center gap-2">
              Artikel
              <InlinePending active={pending} label="Artikel wird erstellt" />
            </span>
          }
          htmlFor={`material-item-${line.id}`}
        >
          <SelectWithCreate
            id={`material-item-${line.id}`}
            items={inventoryItems}
            getOption={(item) => ({
              value: item.id,
              label: item.name,
              description: item.internalSku ?? undefined,
            })}
            value={line.itemId}
            onValueChange={(value) =>
              onChange({
                ...draft,
                materials: draft.materials.map((item) =>
                  item.id === line.id
                    ? {
                        ...item,
                        itemId: value,
                        isBillable:
                          inventoryItems.find((option) => option.id === value)?.isBillable ?? item.isBillable,
                      }
                    : item,
                ),
              })
            }
            createLabel="Neuen Artikel erstellen"
            disabled={!editable}
            renderCreateDialog={({ open, onOpenChange }) => (
              <CreateMaterialDialog
                open={open}
                onOpenChange={onOpenChange}
                onSubmit={(input) => onCreateItem(line.id, input)}
              />
            )}
          />
        </Field>
        <Field label="Bevorzugtes Lager" htmlFor={`material-location-${line.id}`}>
          <LocationSelectWithCreate
            id={`material-location-${line.id}`}
            locations={inventoryLocations}
            value={line.preferredLocationId ?? ''}
            onValueChange={(value) =>
              onPatch((current) => ({
                ...current,
                materials: current.materials.map((item) =>
                  item.id === line.id ? { ...item, preferredLocationId: value || null } : item,
                ),
              }))
            }
            allowNone
            disabled={!editable}
          />
        </Field>
        <Field label="Geplante Menge" htmlFor={`quantity-${line.id}`}>
          <PlannedQuantityStepper
            id={`quantity-${line.id}`}
            quantity={line.plannedQuantity}
            disabled={!editable}
            onQuantityChange={(plannedQuantity) =>
              onChange({
                ...draft,
                materials: draft.materials.map((item) =>
                  item.id === line.id ? { ...item, plannedQuantity } : item,
                ),
              })
            }
            unitLabel={inventoryItems.find((item) => item.id === line.itemId)?.unit}
          />
        </Field>
        <div className="flex items-end justify-between gap-3">
          <label className="flex h-11 items-center gap-2">
            <Checkbox
              checked={line.isBillable}
              disabled={!editable}
              onCheckedChange={(checked) =>
                onChange({
                  ...draft,
                  materials: draft.materials.map((item) =>
                    item.id === line.id ? { ...item, isBillable: checked === true } : item,
                  ),
                })
              }
            />
            Abrechenbar
          </label>
          {editable && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() =>
                onChange({ ...draft, materials: draft.materials.filter((item) => item.id !== line.id) })
              }
              aria-label="Material löschen"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
        <Field label="Notiz" htmlFor={`material-notes-${line.id}`} className="sm:col-span-2">
          <Textarea
            value={line.notes ?? ''}
            disabled={!editable}
            onChange={(event) =>
              onChange({
                ...draft,
                materials: draft.materials.map((item) =>
                  item.id === line.id ? { ...item, notes: event.target.value || null } : item,
                ),
              })
            }
          />
        </Field>
      </CardContent>
    </Card>
  );
}

// Closes on submit; the editor selects the optimistic article on the line and reports the outcome.
function CreateMaterialDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateInventoryItemInput) => void;
}) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('Stk.');
  const [error, setError] = useState<string | null>(null);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!name.trim() || !unit.trim()) {
      setError('Bitte gib Name und Einheit an.');
      return;
    }
    onSubmit({ name, unit });
    setName('');
    setError(null);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Artikel erstellen</DialogTitle>
            <DialogDescription>Der Artikel wird ohne Bestand angelegt.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Name" htmlFor="quick-item-name" required>
              <Input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
            </Field>
            <Field label="Einheit" htmlFor="quick-item-unit" required>
              <Input
                value={unit}
                onChange={(event) => {
                  setUnit(event.target.value);
                  setError(null);
                }}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit">Erstellen</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Keeps the typed text, so a comma or a trailing zero survives while the user
 * types „0,125“; the draft stores the parsed number with the column's three
 * fractional digits.
 */
function PlannedQuantityStepper({
  id,
  quantity,
  disabled,
  onQuantityChange,
  unitLabel,
}: {
  id: string;
  quantity: number;
  disabled: boolean;
  onQuantityChange: (quantity: number) => void;
  unitLabel: string | undefined;
}) {
  const [text, setText] = useState(() => formatDecimalDe(quantity, 3));
  const shown = parseDecimalInput(text) === quantity ? text : formatDecimalDe(quantity, 3);
  return (
    <QuantityStepper
      id={id}
      value={shown}
      min={0.001}
      step={1}
      disabled={disabled}
      onChange={(value) => {
        setText(value);
        onQuantityChange(parseDecimalInput(value));
      }}
      unitLabel={unitLabel}
    />
  );
}
