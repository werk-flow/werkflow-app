'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useBanner } from '@/components/ui/banner';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useServerAction } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { adjustInventoryStock, createInventoryLocation, upsertInventoryItem } from '@/lib/inventory/actions';
import type { InventoryLocation, InventoryOverview, InventoryOverviewItem } from '@/lib/inventory/types';
import {
  buildItemSaveInput,
  EMPTY_ITEM_FORM,
  EMPTY_LOCATION_FORM,
  getInventoryActionErrorMessage,
  itemToForm,
  type ItemFormState,
  type LocationFormState,
  type PendingItemDraft,
  type StockDialogState,
} from './inventory-form-state';
import type { PendingLocationDraft } from './inventory-locations-view';
import { parseDecimalInput } from '@/lib/ui/decimal';

/** What the item and stock dialogs share: one error slot and the row indicator. */
type SharedItemFeedback = {
  setFormError: (error: string | null) => void;
  busyItems: ReturnType<typeof useBusyIds<string>>;
  waitForItems: () => Promise<void>;
};

type ItemEditor = {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  form: ItemFormState;
  setForm: (form: ItemFormState) => void;
  /** The created item the list shows until the refreshed list carries it. */
  pendingDraft: PendingItemDraft | null;
  isSaving: boolean;
  openCreate: () => void;
  openEdit: (item: InventoryOverviewItem) => void;
  save: () => void;
};

type LocationCreator = {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  form: LocationFormState;
  setForm: (form: LocationFormState) => void;
  pendingDraft: PendingLocationDraft | null;
  openCreate: () => void;
  save: () => void;
};

type StockAdjuster = {
  dialog: StockDialogState;
  setDialog: (state: StockDialogState) => void;
  isSaving: boolean;
  open: (item: InventoryOverviewItem) => void;
  save: () => void;
};

type InventoryEditing = {
  formError: string | null;
  isItemBusy: (itemId: string) => boolean;
  item: ItemEditor;
  location: LocationCreator;
  stock: StockAdjuster;
};

function useInventoryItemEditor(
  overview: InventoryOverview,
  { setFormError, busyItems, waitForItems }: SharedItemFeedback,
): ItemEditor {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [itemForm, setItemForm] = useState<ItemFormState>(EMPTY_ITEM_FORM);
  const [pendingItemDraft, setPendingItemDraft] = useState<PendingItemDraft | null>(null);
  // Dialog edits: the button spins while the action runs; the changed row
  // shows an inline indicator until the refreshed props land.
  const itemSave = useServerAction(upsertInventoryItem);

  const visiblePendingItemDraft =
    pendingItemDraft?.confirmedId && overview.items.some((item) => item.id === pendingItemDraft.confirmedId)
      ? null
      : pendingItemDraft;

  function openCreateItemDialog() {
    setFormError(null);
    setItemForm(EMPTY_ITEM_FORM);
    setItemDialogOpen(true);
  }

  function openEditItemDialog(item: InventoryOverviewItem) {
    setFormError(null);
    setItemForm(itemToForm(item));
    setItemDialogOpen(true);
  }

  function handleItemSave() {
    setFormError(null);
    const initialQuantity = parseDecimalInput(itemForm.initialQuantity);
    if (!itemForm.id && initialQuantity > 0 && !itemForm.initialLocationId) {
      setFormError(getInventoryActionErrorMessage('location_required_for_initial_stock'));
      return;
    }

    const input = buildItemSaveInput(itemForm, initialQuantity);

    if (!itemForm.id) {
      // Create: the dialog closes at once and the table carries the draft as
      // a pending row until the refreshed list contains the new item. A
      // refusal reopens the dialog with the submitted values and the error.
      const submittedForm = itemForm;
      setItemDialogOpen(false);
      // Identity checks keep an earlier submission from touching a later draft.
      const draft: PendingItemDraft = {
        confirmedId: null,
        name: itemForm.name.trim(),
        internalSku: itemForm.internalSku.trim(),
        itemType: itemForm.itemType,
        unit: itemForm.unit,
        quantity: initialQuantity,
        locationName:
          overview.locations.find((location) => location.id === itemForm.initialLocationId)?.name ?? null,
      };
      setPendingItemDraft(draft);
      void (async () => {
        const result = await upsertInventoryItem(input).catch(() => null);
        if (!result?.success) {
          setPendingItemDraft((current) => (current === draft ? null : current));
          setItemForm(submittedForm);
          setFormError(getInventoryActionErrorMessage(result?.error ?? 'save_failed'));
          setItemDialogOpen(true);
          return;
        }
        showBanner({ variant: 'success', message: 'Der Artikel wurde angelegt.' });
        const confirmedDraft = { ...draft, confirmedId: result.item.id };
        setPendingItemDraft((current) => (current === draft ? confirmedDraft : current));
        const refreshed = waitForItems();
        router.refresh();
        await refreshed;
        setPendingItemDraft((current) => (current === confirmedDraft ? null : current));
      })();
      return;
    }

    const itemId = itemForm.id;
    void (async () => {
      const result = await itemSave.run(input).catch(() => null);
      if (!result?.success) {
        setFormError(getInventoryActionErrorMessage(result?.error ?? 'save_failed'));
        return;
      }
      setItemDialogOpen(false);
      showBanner({ variant: 'success', message: 'Der Artikel wurde gespeichert.' });
      router.refresh();
      void busyItems.run(itemId, waitForItems);
    })();
  }

  return {
    dialogOpen: itemDialogOpen,
    setDialogOpen: setItemDialogOpen,
    form: itemForm,
    setForm: setItemForm,
    pendingDraft: visiblePendingItemDraft,
    isSaving: itemSave.isPending,
    openCreate: openCreateItemDialog,
    openEdit: openEditItemDialog,
    save: handleItemSave,
  };
}

function useInventoryLocationCreator(
  locations: InventoryLocation[],
  setFormError: (error: string | null) => void,
): LocationCreator {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [locationForm, setLocationForm] = useState<LocationFormState>(EMPTY_LOCATION_FORM);
  const [pendingLocationDraft, setPendingLocationDraft] = useState<PendingLocationDraft | null>(null);
  const waitForLocations = useSettleOnChange(locations);

  function openCreateLocationDialog() {
    setFormError(null);
    setLocationForm(EMPTY_LOCATION_FORM);
    setLocationDialogOpen(true);
  }

  function handleLocationSave() {
    setFormError(null);
    const form = locationForm;
    // Create: the dialog closes at once; the Lager tab shows a pending card
    // until the refreshed location list contains the new one.
    setLocationDialogOpen(false);
    setLocationForm(EMPTY_LOCATION_FORM);
    const draft: PendingLocationDraft = {
      name: form.name.trim(),
      locationType: form.locationType,
      confirmedId: null,
    };
    setPendingLocationDraft(draft);
    void (async () => {
      const result = await createInventoryLocation(form).catch(() => null);
      if (!result?.success) {
        // A refusal reopens the dialog with the submitted values and the error.
        setPendingLocationDraft((current) => (current === draft ? null : current));
        setLocationForm(form);
        setFormError(getInventoryActionErrorMessage(result?.error ?? 'create_failed'));
        setLocationDialogOpen(true);
        return;
      }
      const confirmedDraft = { ...draft, confirmedId: result.location.id };
      setPendingLocationDraft((current) => (current === draft ? confirmedDraft : current));
      showBanner({ variant: 'success', message: 'Das Lager wurde angelegt.' });
      const settled = waitForLocations();
      router.refresh();
      await settled;
      setPendingLocationDraft((current) => (current === confirmedDraft ? null : current));
    })();
  }

  return {
    dialogOpen: locationDialogOpen,
    setDialogOpen: setLocationDialogOpen,
    form: locationForm,
    setForm: setLocationForm,
    pendingDraft: pendingLocationDraft,
    openCreate: openCreateLocationDialog,
    save: handleLocationSave,
  };
}

function useInventoryStockAdjuster(
  locations: InventoryLocation[],
  { setFormError, busyItems, waitForItems }: SharedItemFeedback,
): StockAdjuster {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [stockDialog, setStockDialog] = useState<StockDialogState>(null);
  const stockSave = useServerAction(adjustInventoryStock);

  function handleStockSave() {
    if (!stockDialog) return;

    setFormError(null);
    const itemId = stockDialog.item.id;
    void (async () => {
      const result = await stockSave
        .run({
          itemId,
          locationId: stockDialog.locationId,
          direction: stockDialog.direction,
          quantity: parseDecimalInput(stockDialog.quantity),
          reason: stockDialog.reason,
        })
        .catch(() => null);
      if (!result?.success) {
        setFormError(getInventoryActionErrorMessage(result?.error ?? 'save_failed'));
        return;
      }
      setStockDialog(null);
      showBanner({ variant: 'success', message: 'Der Bestand wurde angepasst.' });
      router.refresh();
      void busyItems.run(itemId, waitForItems);
    })();
  }

  function openStockDialog(item: InventoryOverviewItem) {
    setFormError(null);
    setStockDialog({
      item,
      locationId: item.stockByLocation[0]?.locationId ?? locations[0]?.id ?? '',
      direction: 'add',
      quantity: '',
      reason: '',
    });
  }

  return {
    dialog: stockDialog,
    setDialog: setStockDialog,
    isSaving: stockSave.isPending,
    open: openStockDialog,
    save: handleStockSave,
  };
}

/**
 * The create and edit flows of the inventory page: the item dialog, the
 * location dialog and the stock adjustment, with their pending drafts.
 */
export function useInventoryEditing(overview: InventoryOverview): InventoryEditing {
  const [formError, setFormError] = useState<string | null>(null);
  const busyItems = useBusyIds();
  const waitForItems = useSettleOnChange(overview.items);
  const shared: SharedItemFeedback = { setFormError, busyItems, waitForItems };
  const item = useInventoryItemEditor(overview, shared);
  const stock = useInventoryStockAdjuster(overview.locations, shared);
  const location = useInventoryLocationCreator(overview.locations, setFormError);

  return { formError, isItemBusy: busyItems.isBusy, item, location, stock };
}
