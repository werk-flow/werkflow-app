'use client';

import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
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
import { Label } from '@/components/ui/label';
import type { InventoryLocation, InventoryPickerOption } from '@/lib/inventory/types';
import { INVENTORY_PICKER_PAGE_SIZE } from '@/lib/inventory/types';
import {
  addItemToDialogRows,
  getMaterialDialogCopy,
  matchesItemSearch,
  type MaterialDialogMode,
  type MaterialDialogRow,
  type MaterialDialogState,
} from './job-material-dialog-model';
import { MaterialDialogRowCard } from './job-material-dialog-row';
import { MaterialItemPicker } from './job-material-item-picker';

type MaterialSelectionDialogProps = {
  dialog: MaterialDialogState | null;
  setDialog: (dialog: MaterialDialogState | null) => void;
  items: InventoryPickerOption[];
  locations: InventoryLocation[];
  isSaving: boolean;
  isSearching: boolean;
  searchFailed: boolean;
  onRetrySearch: () => void;
  onSave: () => void;
};

/** The changes the dialog makes to its open state; each clears the shown error. */
function materialDialogEditor(
  currentDialog: MaterialDialogState,
  setDialog: (dialog: MaterialDialogState | null) => void,
  {
    locations,
    mode,
    canAddMultiple,
  }: { locations: InventoryLocation[]; mode: MaterialDialogMode; canAddMultiple: boolean },
) {
  function patchDialog(patch: Partial<MaterialDialogState>) {
    setDialog({ ...currentDialog, ...patch });
  }

  function addItem(item: InventoryPickerOption) {
    patchDialog({
      rows: addItemToDialogRows(currentDialog.rows, item, { locations, mode, canAddMultiple }),
      error: null,
    });
  }

  function updateRow(key: string, patch: Partial<MaterialDialogRow>) {
    patchDialog({
      rows: currentDialog.rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
      error: null,
    });
  }

  function removeRow(key: string) {
    patchDialog({
      rows: currentDialog.rows.filter((row) => row.key !== key),
      error: null,
    });
  }

  return { patchDialog, addItem, updateRow, removeRow };
}

/** A return keeps its item, and so does an edit once the position has bookings. */
function canChangeDialogItem({ mode, rows }: MaterialDialogState): boolean {
  return (
    mode !== 'return' &&
    (mode !== 'edit' || rows.every((row) => row.takenQuantity === 0 && row.returnedQuantity === 0))
  );
}

function LockedItemNotice() {
  return (
    <div className="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
      Der Artikel kann nicht mehr geändert werden, weil für diese Position bereits Entnahmen oder Rückgaben
      gebucht wurden.
    </div>
  );
}

export function MaterialSelectionDialog({
  dialog,
  setDialog,
  items,
  locations,
  isSaving,
  isSearching,
  searchFailed,
  onRetrySearch,
  onSave,
}: MaterialSelectionDialogProps) {
  const mode = dialog?.mode ?? 'plan';
  const matchingItems = useMemo(
    () => items.filter((item) => matchesItemSearch(item, dialog?.search ?? '')),
    [dialog?.search, items],
  );
  const filteredItems = matchingItems.slice(0, INVENTORY_PICKER_PAGE_SIZE);
  // A full page means the catalog may hold more than the list shows.
  const hasMoreItems = matchingItems.length >= INVENTORY_PICKER_PAGE_SIZE;

  if (!dialog) return null;

  const currentDialog = dialog;
  const canAddMultiple = mode === 'plan' || mode === 'take';
  const canChangeItem = canChangeDialogItem(currentDialog);
  const editor = materialDialogEditor(currentDialog, setDialog, { locations, mode, canAddMultiple });

  const { title, description } = getMaterialDialogCopy(mode);

  return (
    <Dialog open onOpenChange={(open) => !open && setDialog(null)} pending={isSaving}>
      <DialogContent size="4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="grid grid-cols-1 gap-5 py-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
            {canChangeItem ? (
              <MaterialItemPicker
                mode={mode}
                search={currentDialog.search}
                onSearchChange={(search) => editor.patchDialog({ search })}
                filteredItems={filteredItems}
                hasMoreItems={hasMoreItems}
                isSearching={isSearching}
                searchFailed={searchFailed}
                onRetrySearch={onRetrySearch}
                onAdd={editor.addItem}
              />
            ) : (
              <LockedItemNotice />
            )}

            <SelectedMaterialPositions
              rows={currentDialog.rows}
              items={items}
              locations={locations}
              mode={mode}
              canRemove={(canAddMultiple || mode === 'edit') && currentDialog.rows.length > 1}
              onUpdateRow={editor.updateRow}
              onRemoveRow={editor.removeRow}
            />

            <ErrorText className="lg:col-span-2">{currentDialog.error}</ErrorText>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button pending={isSaving} type="submit" disabled={isSaving}>
              {mode === 'take' ? 'Entnahme buchen' : mode === 'return' ? 'Zurücklegen' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The right column of the material dialog: the positions picked so far. */
function SelectedMaterialPositions({
  rows,
  items,
  locations,
  mode,
  canRemove,
  onUpdateRow,
  onRemoveRow,
}: {
  rows: MaterialDialogRow[];
  items: InventoryPickerOption[];
  locations: InventoryLocation[];
  mode: MaterialDialogMode;
  canRemove: boolean;
  onUpdateRow: (key: string, patch: Partial<MaterialDialogRow>) => void;
  onRemoveRow: (key: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label>Ausgewählte Positionen</Label>
        <Badge variant="secondary">{rows.length}</Badge>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          Wähle links einen oder mehrere Artikel aus.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <MaterialDialogRowCard
              key={row.key}
              row={row}
              item={items.find((entry) => entry.id === row.itemId)}
              locations={locations}
              mode={mode}
              canRemove={canRemove}
              onChange={(patch) => onUpdateRow(row.key, patch)}
              onRemove={() => onRemoveRow(row.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
