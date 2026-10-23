import { expect, type Locator, type Page } from '@playwright/test';
import type { DialogOpenerId } from '../../../../lib/testing/selection/dialog-inventory';
import {
  createItemButton,
  createLocationButton,
  csvImportButton,
  inventoryDialogLayer,
  inventoryItemRow,
  inventoryRowActionItem,
  inventoryRowActionsButton,
  itemDialogPicker,
  itemDialogPickerCreateAction,
  materialPlanButton,
  materialPlanLayer,
} from '../../../golden/support/steps/inventory';
import type { DialogOpener } from '../dialog-opener';
import type { SurfaceContext } from '../surface-fixtures';

type ItemDialogPicker = Parameters<typeof itemDialogPicker>[1];

function itemCreateLayer(page: Page): Locator {
  return inventoryDialogLayer(page, 'createItem');
}

/** Opens „Artikel anlegen“, then the picker, and returns the picker's create action. */
async function itemPickerCreateAction({ page }: SurfaceContext, picker: ItemDialogPicker): Promise<Locator> {
  await createItemButton(page).click();
  const dialog = itemCreateLayer(page);
  await expect(dialog).toBeVisible();
  await itemDialogPicker(dialog, picker).click();
  return itemDialogPickerCreateAction(page, picker);
}

/** The row menu of the world's seeded inventory item. */
function seededItemActionsButton({ page, world }: SurfaceContext): Locator {
  return inventoryRowActionsButton(inventoryItemRow(page, world.inventory.itemName));
}

export const INVENTORY_OPENERS = {
  'inventory.create-location': {
    trigger: (context) => itemPickerCreateAction(context, 'location'),
    layer: (page) => inventoryDialogLayer(page, 'quickCreateLocation'),
    returnFocus: ({ page }) => itemDialogPicker(itemCreateLayer(page), 'location'),
    parents: (page) => [itemCreateLayer(page)],
  },
  'inventory.create-supplier': {
    trigger: (context) => itemPickerCreateAction(context, 'supplier'),
    layer: (page) => inventoryDialogLayer(page, 'quickCreateSupplier'),
    returnFocus: ({ page }) => itemDialogPicker(itemCreateLayer(page), 'supplier'),
    parents: (page) => [itemCreateLayer(page)],
  },
  'inventory.import': {
    trigger: async ({ page }) => csvImportButton(page),
    layer: (page) => inventoryDialogLayer(page, 'importCsv'),
  },
  'inventory.item': {
    trigger: async ({ page }) => createItemButton(page),
    layer: itemCreateLayer,
  },
  'inventory.job-materials': {
    trigger: async ({ page }) => {
      // The plan action stays disabled while the organization has no items.
      const button = materialPlanButton(page);
      await expect(button).toBeEnabled();
      return button;
    },
    layer: materialPlanLayer,
  },
  'inventory.location': {
    trigger: async ({ page }) => createLocationButton(page),
    layer: (page) => inventoryDialogLayer(page, 'createLocation'),
  },
  'inventory.stock-adjustment': {
    opensOn: 'desktop',
    phonePath:
      'The phone card of the item list holds the same ItemActionsMenu (components/inventar/inventory-content.tsx).',
    trigger: async (context) => {
      await seededItemActionsButton(context).click();
      return inventoryRowActionItem(context.page, 'adjustStock');
    },
    layer: (page) => inventoryDialogLayer(page, 'adjustStock'),
    returnFocus: seededItemActionsButton,
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;
