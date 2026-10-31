'use client';

import type { InventoryOverview } from '@/lib/inventory/types';
import { ImportDialog } from './inventory-import-dialog';
import { ItemDialog } from './inventory-item-dialog';
import { LocationDialog } from './inventory-location-dialog';
import { StockAdjustmentDialog } from './inventory-stock-adjustment-dialog';
import type { useInventoryEditing } from './use-inventory-editing';

/** The inventory page's item, Lager, stock and import dialogs. */
export function InventoryDialogs({
  overview,
  editing,
  importDialogOpen,
  setImportDialogOpen,
}: {
  overview: InventoryOverview;
  editing: ReturnType<typeof useInventoryEditing>;
  importDialogOpen: boolean;
  setImportDialogOpen: (open: boolean) => void;
}) {
  return (
    <>
      <ItemDialog
        open={editing.item.dialogOpen}
        onOpenChange={editing.item.setDialogOpen}
        form={editing.item.form}
        setForm={editing.item.setForm}
        categories={overview.categories}
        suppliers={overview.suppliers}
        locations={overview.locations}
        isSaving={editing.item.isSaving}
        error={editing.formError}
        onSave={editing.item.save}
      />

      <LocationDialog
        open={editing.location.dialogOpen}
        onOpenChange={editing.location.setDialogOpen}
        form={editing.location.form}
        setForm={editing.location.setForm}
        onSave={editing.location.save}
        error={editing.formError}
      />

      <StockAdjustmentDialog
        state={editing.stock.dialog}
        setState={editing.stock.setDialog}
        locations={overview.locations}
        isSaving={editing.stock.isSaving}
        error={editing.formError}
        onSave={editing.stock.save}
      />

      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        existingItemCount={overview.summary.totalItems}
        locations={overview.locations}
        categories={overview.categories}
      />
    </>
  );
}
