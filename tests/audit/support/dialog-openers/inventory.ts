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
import { openMenuItem } from '../../../golden/support/steps/shared';
import { seedLeistung } from '../../../golden/support/db/price-catalog';
import {
  createLeistungButton,
  leistungDialogLayer,
  leistungPriceDialogLayer,
  leistungRow,
  leistungRowActionItem,
  leistungRowActionsButton,
} from '../../../golden/support/steps/angebote';
import { worldName } from '../../../../lib/testing/seed-world-plan';
import type { DialogOpener } from '../dialog-opener';
import { surfaceFixture, type SurfaceContext } from '../surface-fixtures';

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
    trigger: (context) =>
      openMenuItem(seededItemActionsButton(context), inventoryRowActionItem(context.page, 'adjustStock')),
    layer: (page) => inventoryDialogLayer(page, 'adjustStock'),
    returnFocus: seededItemActionsButton,
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;

function seededLeistungName(context: SurfaceContext): string {
  return worldName('Layout Montage Heizung', context.world.runId);
}

/** One Leistung with a past, a current and a coming price, so the history shows every state. */
async function prepareLeistung(context: SurfaceContext): Promise<string> {
  const { world, page } = context;
  const name = seededLeistungName(context);
  await surfaceFixture(world, 'commercial.leistung', () =>
    seedLeistung({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      leistungNumber: `L-${world.runId}`,
      name,
      description: 'Stundensatz Monteur',
      prices: [
        { validFrom: '2020-01-01', salePriceCents: 6200, costRateCents: 4000 },
        { validFrom: '2021-01-01', salePriceCents: 6500, costRateCents: 4200 },
        { validFrom: '2099-01-01', salePriceCents: 7500, costRateCents: 4600 },
      ],
    }),
  );
  // The search narrows the list to this world's Leistung.
  await page.goto(`/angebote/leistungen?q=${encodeURIComponent(`L-${world.runId}`)}`);
  return name;
}

function seededRowActionsButton(context: SurfaceContext) {
  return leistungRowActionsButton(leistungRow(context.page, seededLeistungName(context)));
}

/** The Angebote openers; their acceptance captures run with the inventory group. */
export const COMMERCIAL_OPENERS = {
  'commercial.leistung': {
    trigger: async ({ page }) => createLeistungButton(page),
    layer: (page) => leistungDialogLayer(page, 'create'),
  },
  'commercial.leistung-prices': {
    trigger: async (context) => {
      await prepareLeistung(context);
      return openMenuItem(seededRowActionsButton(context), leistungRowActionItem(context.page, 'prices'));
    },
    layer: leistungPriceDialogLayer,
    returnFocus: seededRowActionsButton,
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;
