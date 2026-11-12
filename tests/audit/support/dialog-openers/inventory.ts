import { expect, type Locator, type Page } from '@playwright/test';
import type { DialogOpenerId } from '../../../../lib/testing/selection/dialog-inventory';
import { randomUUID } from 'node:crypto';
import { seedBookedImportBatch } from '../../../golden/support/db/inventory';
import {
  createItemButton,
  createLocationButton,
  csvImportButton,
  csvImportButtonOf,
  csvImportRepeatChecked,
  inventoryImportFileInput,
  inventoryDialogLayer,
  inventoryItemRow,
  inventoryRowActionItem,
  inventoryRowActionsButton,
  itemDialogPicker,
  itemDialogPickerCreateAction,
  materialPlanButton,
  materialPlanLayer,
} from '../../../golden/support/steps/inventory';
import { openMenuItem } from '../../../golden/support/steps/shared';
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

/** The menu button of the world's seeded inventory item: in its row, or on its card on a phone. */
function seededItemActionsButton({ page, world }: SurfaceContext): Locator {
  return inventoryRowActionsButton(inventoryItemRow(page, world.inventory.itemName));
}

function importLayer(page: Page): Locator {
  return inventoryDialogLayer(page, 'importCsv');
}

/**
 * A synthetic file whose headers the dialog maps by itself: a new article, a
 * second row of the same Artikelnummer in another unit, and a row with a unit
 * outside the list. A fresh suffix keeps each file new to the repeat check.
 */
function importFile(rows: 'mixed' | 'header-only') {
  const suffix = randomUUID().slice(0, 8);
  const header = 'Artikelname;Artikelnummer;Lager;Bestand;Einheit';
  const lines =
    rows === 'header-only'
      ? [header]
      : [
          header,
          `Kupferrohr 15 mm;NR-${suffix};Hauptlager Nord;25;Meter`,
          `Kupferrohr 15 mm Stange;NR-${suffix};Hauptlager Nord;5;Stück`,
          `Pressfitting 15 mm;PF-${suffix};Hauptlager Nord;40;Stk`,
          `Dichtband;DB-${suffix};Hauptlager Nord;3;Fass`,
        ];
  return { name: `nordrohr-${suffix}.csv`, mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')) };
}

/** Opens the import dialog and chooses the file; returns the open dialog. */
async function importWithFile(page: Page, file: ReturnType<typeof importFile>): Promise<Locator> {
  await csvImportButton(page).click();
  const dialog = importLayer(page);
  await expect(dialog).toBeVisible();
  await inventoryImportFileInput(dialog).setInputFiles(file);
  return dialog;
}

/** Each state of the import dialog opens from the step button that leads to it; Escape returns to „CSV importieren“. */
const importStateReturnFocus = ({ page }: SurfaceContext) => csvImportButton(page);

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
  'inventory.import-preview': {
    trigger: async ({ page }) => {
      const dialog = await importWithFile(page, importFile('mixed'));
      // The preview waits for the repeat check of the chosen file.
      await expect(csvImportRepeatChecked(dialog)).toBeVisible();
      return csvImportButtonOf(dialog, 'importPreview');
    },
    layer: importLayer,
    returnFocus: importStateReturnFocus,
  },
  'inventory.import-result': {
    trigger: async ({ page }) => {
      const dialog = await importWithFile(page, importFile('mixed'));
      await expect(csvImportRepeatChecked(dialog)).toBeVisible();
      await csvImportButtonOf(dialog, 'importPreview').click();
      return csvImportButtonOf(dialog, 'importBook');
    },
    layer: importLayer,
    returnFocus: importStateReturnFocus,
  },
  'inventory.import-repeat': {
    trigger: async ({ page, world }) => {
      const file = importFile('mixed');
      await seedBookedImportBatch({
        orgId: world.orgId,
        actorId: world.users.buero.id,
        fileName: file.name,
        content: file.buffer,
      });
      const dialog = await importWithFile(page, file);
      await expect(csvImportButtonOf(dialog, 'importRepeatConfirm')).toBeVisible();
      return csvImportButtonOf(dialog, 'importPreview');
    },
    layer: importLayer,
    returnFocus: importStateReturnFocus,
  },
  'inventory.import-empty-file': {
    trigger: async ({ page }) =>
      csvImportButtonOf(await importWithFile(page, importFile('header-only')), 'importPreview'),
    layer: importLayer,
    returnFocus: importStateReturnFocus,
  },
  'inventory.import-read-failure': {
    trigger: async ({ page }) => {
      // The browser cannot read the chosen file, as with a file removed after the choice.
      await page.evaluate(() => {
        File.prototype.arrayBuffer = () => Promise.reject(new DOMException('gone', 'NotReadableError'));
      });
      return csvImportButtonOf(await importWithFile(page, importFile('mixed')), 'importPreview');
    },
    layer: importLayer,
    returnFocus: importStateReturnFocus,
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
    trigger: (context) =>
      openMenuItem(seededItemActionsButton(context), inventoryRowActionItem(context.page, 'adjustStock')),
    layer: (page) => inventoryDialogLayer(page, 'adjustStock'),
    returnFocus: seededItemActionsButton,
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;
