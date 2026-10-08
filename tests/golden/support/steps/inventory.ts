import { expect, type Locator, type Page } from '@playwright/test';
import {
  formatInventoryQuantity,
  INVENTORY_ITEM_TYPE_LABELS,
  type InventoryItemType,
} from '../../../../lib/inventory/types';
import {
  confirmed,
  expectBannerAfter,
  listPager,
  selectFromSearchable,
  SHARED_COPY,
  visibleText,
} from './shared';

/** Copy of the Lager area that no pure product module owns. Type and unit labels come from lib/inventory/types. */
export const INVENTORY_COPY = {
  rowActions: 'Aktionen',
  withdraw: 'Entnehmen',
  billable: 'Abrechenbar',
  materialDemand: 'Bedarf',
  allTypes: 'Alle Typen',
  allLocations: 'Alle Lager',
  insufficientStock: /Bestand.*reicht nicht aus/,
  /** The „Von“ and „Nach“ cells of a movement (components/inventar/inventory-row-format.ts). */
  movementSource: { external: 'Externe Quelle' },
  movementTarget: { correctionOut: 'Korrektur/Ausgang' },
  material: {
    section: 'Material & Inventar',
    planSaved: 'Die Materialplanung wurde gespeichert.',
    noDirectProjectMaterial: 'Noch kein direktes Projektmaterial erfasst.',
    inheritedFromJobs: 'Aus Aufträgen übernommen',
    projectTotal: 'Projekt gesamt',
  },
} as const;

const INVENTORY_LABELS = {
  searchItem: 'Artikel suchen',
  typeFilter: 'Nach Typ filtern',
  locationFilter: 'Nach Lager filtern',
  pendingLocation: 'Lager wird angelegt',
  newSupplier: 'Neuen Lieferanten anlegen',
  applySupplier: 'Übernehmen',
  planMaterial: 'Material planen',
  takeFromStock: 'Aus Lager entnehmen',
  importCsv: 'CSV importieren',
  import: 'Importieren',
} as const;

/** The /inventar dialogs, each named by its heading. */
const INVENTORY_DIALOGS = {
  createItem: 'Artikel anlegen',
  editItem: 'Artikel bearbeiten',
  createLocation: 'Lager anlegen',
  adjustStock: 'Bestand ändern',
  importCsv: INVENTORY_LABELS.importCsv,
} as const;
type InventoryDialog = keyof typeof INVENTORY_DIALOGS;

const INVENTORY_TABS = {
  items: 'Alle Artikel',
  locations: 'Lager',
  planned: 'Geplant',
  movements: 'Bewegungen',
} as const;
type InventoryView = keyof typeof INVENTORY_TABS;
/** The /inventar views in tab order. */
export const INVENTORY_VIEWS = Object.keys(INVENTORY_TABS) as InventoryView[];

/** The row actions menu of an item on /inventar. */
const INVENTORY_ROW_ACTIONS = {
  edit: SHARED_COPY.action.edit,
  adjustStock: INVENTORY_DIALOGS.adjustStock,
} as const;

/** The material line actions on a job and the dialog each one opens. */
export const JOB_MATERIAL_ACTIONS = {
  take: { trigger: 'Entnahme buchen', heading: 'Entnahme buchen', submit: 'Entnahme buchen' },
  return: { trigger: 'Zurücklegen', heading: 'Material zurücklegen', submit: 'Zurücklegen' },
} as const;
type JobMaterialAction = keyof typeof JOB_MATERIAL_ACTIONS;

export function inventoryDialog(page: Page, dialog: InventoryDialog): Locator {
  return page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: INVENTORY_DIALOGS[dialog] }) });
}

export function createItemButton(page: Page): Locator {
  return page.getByRole('button', { name: INVENTORY_DIALOGS.createItem, exact: true });
}

export function createLocationButton(page: Page): Locator {
  return page.getByRole('button', { name: INVENTORY_DIALOGS.createLocation, exact: true });
}

export function csvImportButton(page: Page): Locator {
  return page.getByRole('button', { name: INVENTORY_LABELS.importCsv });
}

export function csvImportSubmit(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: INVENTORY_LABELS.import });
}

export function inventoryTab(page: Page, view: InventoryView): Locator {
  return page.getByRole('tab', { name: INVENTORY_TABS[view], exact: true });
}

/** The item search on /inventar and in the material dialogs. */
export function itemSearchField(scope: Page | Locator): Locator {
  return scope.getByLabel(INVENTORY_LABELS.searchItem);
}

export function itemTypeFilter(page: Page): Locator {
  return page.getByLabel(INVENTORY_LABELS.typeFilter);
}

export function itemLocationFilter(page: Page): Locator {
  return page.getByLabel(INVENTORY_LABELS.locationFilter);
}

/** The optimistic card of a location that is still being created. */
export function pendingLocationStatus(page: Page): Locator {
  return page.getByRole('status', { name: INVENTORY_LABELS.pendingLocation });
}

/** A table row on /inventar (items or movements) that mentions this text. */
export function inventoryRow(page: Page, text: string): Locator {
  return confirmed(page.getByRole('row').filter({ hasText: text }));
}

const ITEM_LIST_COPY = {
  pager: 'Artikelseiten',
  itemCreated: 'Der Artikel wurde angelegt.',
  itemSaved: 'Der Artikel wurde gespeichert.',
  itemName: 'Name',
} as const;

/** The pagination of the /inventar item list. */
export function inventoryItemPager(page: Page): Locator {
  return listPager(page, ITEM_LIST_COPY.pager);
}

/** The item row whose name cell shows exactly this name. */
export function inventoryItemRow(page: Page, name: string): Locator {
  return confirmed(
    page
      .getByRole('main')
      .getByRole('row')
      .filter({ has: page.getByText(name, { exact: true }) }),
  );
}

export function inventoryItemCreatedMessage(page: Page): Locator {
  return visibleText(page, ITEM_LIST_COPY.itemCreated);
}

/** Chooses an item type in the /inventar type filter. */
export async function chooseInventoryItemTypeFilter(page: Page, type: InventoryItemType): Promise<void> {
  await itemTypeFilter(page).click();
  await page.getByRole('option', { name: INVENTORY_ITEM_TYPE_LABELS[type], exact: true }).click();
}

/** Renames an item through its row's edit dialog and waits for the saved confirmation. */
export async function renameInventoryItem(page: Page, oldName: string, newName: string): Promise<void> {
  await openItemRowAction(page, inventoryItemRow(page, oldName), 'edit');
  const dialog = inventoryDialog(page, 'editItem');
  const name = dialog.getByRole('textbox', { name: ITEM_LIST_COPY.itemName, exact: true });
  await expect(name).toBeEnabled();
  await name.fill(newName);
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(ITEM_LIST_COPY.itemSaved, { exact: true })).toBeVisible();
}

/** Opens one action of an item row's „Aktionen“ menu. */
export async function openItemRowAction(
  page: Page,
  row: Locator,
  action: keyof typeof INVENTORY_ROW_ACTIONS,
): Promise<void> {
  await row.getByRole('button', { name: INVENTORY_COPY.rowActions, exact: true }).click();
  await page.getByRole('menuitem', { name: INVENTORY_ROW_ACTIONS[action] }).click();
}

/** One location card in the „Lager“ view, a region named by the location. */
export function inventoryLocationCard(page: Page, locationName: string): Locator {
  return confirmed(page.getByRole('main').getByRole('region', { name: locationName, exact: true }));
}

/** One item's tile in the project's „Projekt gesamt“ totals. */
export function projectMaterialTotal(page: Page, itemId: string): Locator {
  return confirmed(
    page
      .getByRole('region', { name: INVENTORY_COPY.material.projectTotal, exact: true })
      .locator(`[data-row-id="${itemId}"]`),
  );
}

/** The billable pill text of a project total with this quantity. */
export function billableQuantityPattern(quantity: number): RegExp {
  return new RegExp(`${INVENTORY_COPY.billable}\\s+${quantity}`);
}

/**
 * The quantity input of the material rows inside a material dialog. The rows
 * have no accessible name per row; the generated id suffix is the contract.
 */
export function materialRowQuantity(dialog: Locator): Locator {
  return dialog.locator('input[id$="-quantity"]');
}

/** The location picker trigger of the material rows inside a material dialog. */
export function materialRowLocation(dialog: Locator): Locator {
  return dialog.locator('button[id$="-location"]');
}

/** The work page's action that takes material from stock; pass the field work pack to scope it. */
export function takeFromStockButton(scope: Page | Locator): Locator {
  return scope.getByRole('button', { name: INVENTORY_LABELS.takeFromStock });
}

/** The still-out line of a job material row: „Noch draußen: 0 Stk.“. */
export function materialStillOutText(quantity: number, unit = 'piece'): string {
  return `Noch draußen: ${formatInventoryQuantity(quantity, unit)}`;
}

export function jobMaterialLine(page: Page, itemName: string): Locator {
  return confirmed(page.getByRole('main').getByTestId('job-material-line').filter({ hasText: itemName }));
}

export function jobMaterialLineAction(line: Locator, action: JobMaterialAction): Locator {
  return line.getByRole('button', { name: JOB_MATERIAL_ACTIONS[action].trigger });
}

function materialPlanButton(page: Page): Locator {
  return page.getByRole('button', { name: INVENTORY_LABELS.planMaterial });
}

function materialPlanDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: INVENTORY_LABELS.planMaterial }),
  });
}

function materialPlanSavedBanner(page: Page): Locator {
  return page.getByRole('alert').filter({ hasText: INVENTORY_COPY.material.planSaved });
}

/**
 * Plans material from the open job or project detail and waits for the saved
 * banner and the closed dialog.
 */
export async function planMaterialOnDetailPage(
  page: Page,
  input: { itemName: string; locationName: string; quantity: number },
): Promise<void> {
  const button = materialPlanButton(page);
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();
  const dialog = materialPlanDialog(page);
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await itemSearchField(dialog).fill(input.itemName);
  await dialog.getByRole('button').filter({ hasText: input.itemName }).click();
  await materialRowQuantity(dialog).fill(String(input.quantity));
  await selectFromSearchable(page, materialRowLocation(dialog), input.locationName);
  await dialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
  // The dialog closes with the click; the banner confirms the write.
  await expect(materialPlanSavedBanner(page)).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

export async function createInventoryLocation(page: Page, name: string): Promise<void> {
  await page.goto('/inventar');
  await createLocationButton(page).click();
  const dialog = inventoryDialog(page, 'createLocation');
  await dialog.locator('#inventory-location-name').fill(name);
  await dialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

export async function createInventoryItem(
  page: Page,
  options: {
    name: string;
    locationName?: string;
    initialQuantity?: number;
    supplierName?: string;
  },
): Promise<void> {
  if (options.initialQuantity !== undefined) {
    if (!options.locationName) {
      throw new Error('createInventoryItem: initialQuantity requires a locationName');
    }
    if (!Number.isFinite(options.initialQuantity)) {
      throw new Error('createInventoryItem: initialQuantity must be finite');
    }
  }

  await page.goto('/inventar');
  await createItemButton(page).click();
  const dialog = inventoryDialog(page, 'createItem');
  await dialog.locator('#inventory-item-name').fill(options.name);
  if (options.locationName) {
    await selectFromSearchable(
      page,
      dialog.locator('#inventory-item-initial-location'),
      options.locationName,
    );
    await dialog.locator('#inventory-item-initial-quantity').fill(String(options.initialQuantity ?? 0));
  }
  if (options.supplierName) {
    // SelectWithCreate: the action row opens a quick-create dialog that stages
    // the new supplier name; the supplier row is created on item save.
    await dialog.locator('#inventory-item-supplier').click();
    await page.getByRole('button', { name: INVENTORY_LABELS.newSupplier, exact: true }).click();
    const supplierDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: INVENTORY_LABELS.newSupplier }),
    });
    await supplierDialog.locator('#inventory-new-supplier-name').fill(options.supplierName);
    await supplierDialog.getByRole('button', { name: INVENTORY_LABELS.applySupplier }).click();
    await expect(supplierDialog).toHaveCount(0, { timeout: 10_000 });
  }
  await dialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

export async function takeMaterialOnJobPage(
  page: Page,
  jobNumber: string,
  itemName: string,
  quantity: number,
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  await expect(visibleText(page, INVENTORY_COPY.material.section)).toBeVisible({
    timeout: 20_000,
  });
  await takeFromStockButton(page).click();
  await expect(page.getByRole('heading', { name: JOB_MATERIAL_ACTIONS.take.heading })).toBeVisible();

  // Pick the item from the search list; a row with quantity 1 appears.
  await page.getByRole('dialog').getByRole('button').filter({ hasText: itemName }).first().click();
  await page.locator('input[id^="material-row-"][id$="-quantity"]').fill(String(quantity));

  // The line rows outside the dialog also carry an "Entnahme buchen" button,
  // so the confirm click must stay scoped to the dialog.
  await page.getByRole('dialog').getByRole('button', { name: JOB_MATERIAL_ACTIONS.take.submit }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

export async function returnMaterialOnJobPage(
  page: Page,
  jobNumber: string,
  itemName: string,
  quantity: number,
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  await expect(visibleText(page, INVENTORY_COPY.material.section)).toBeVisible({
    timeout: 20_000,
  });
  await jobMaterialLine(page, itemName)
    .locator('button:enabled')
    .filter({ hasText: JOB_MATERIAL_ACTIONS.return.trigger })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: JOB_MATERIAL_ACTIONS.return.heading })).toBeVisible();

  await page.locator('input[id^="material-row-"][id$="-quantity"]').fill(String(quantity));
  await page.getByRole('dialog').getByRole('button', { name: JOB_MATERIAL_ACTIONS.return.submit }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

export async function planMaterialOnJobPage(
  page: Page,
  jobNumber: string,
  itemName: string,
  locationName: string,
  quantity: number,
): Promise<void> {
  await page.goto(`/auftraege/${encodeURIComponent(jobNumber)}`);
  await materialPlanButton(page).click();
  const dialog = materialPlanDialog(page);
  await itemSearchField(dialog).fill(itemName);
  await dialog.getByRole('button').filter({ hasText: itemName }).first().click();
  await materialRowQuantity(dialog).first().fill(String(quantity));
  await selectFromSearchable(page, materialRowLocation(dialog).first(), locationName);
  // The dialog closes and the line shows with the click; the banner confirms
  // the write, and a refusal reopens the dialog instead.
  await expectBannerAfter(page, INVENTORY_COPY.material.planSaved, () =>
    dialog.getByRole('button', { name: SHARED_COPY.action.save }).click(),
  );
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}
