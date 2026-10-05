import { expect, test } from '../support/fixtures';
import {
  formatInventoryQuantity,
  getInventoryUnitLabel,
  INVENTORY_ITEM_TYPE_LABELS,
  INVENTORY_LOCATION_TYPE_LABELS,
  INVENTORY_MOVEMENT_TYPE_LABELS,
} from '../../../lib/inventory/types';
import { getInventoryLedgerState } from '../../golden/support/db/inventory';
import {
  billableQuantityPattern,
  createInventoryItem,
  createInventoryLocation,
  createItemButton,
  createLocationButton,
  csvImportButton,
  csvImportSubmit,
  INVENTORY_COPY,
  INVENTORY_VIEWS,
  inventoryDialog,
  inventoryLocationCard,
  inventoryRow,
  inventoryTab,
  itemLocationFilter,
  itemSearchField,
  itemTypeFilter,
  JOB_MATERIAL_ACTIONS,
  jobMaterialLine,
  jobMaterialLineAction,
  openItemRowAction,
  pendingLocationStatus,
  planMaterialOnDetailPage,
  projectMaterialTotal,
  takeMaterialOnJobPage,
} from '../../golden/support/steps/inventory';
import { projectQualificationSection } from '../../golden/support/steps/qualifications';
import { expectRedirectedAway } from '../../golden/support/steps/organization';
import {
  SHARED_COPY,
  selectFromSearchable,
  testData,
  textInDom,
  visibleText,
} from '../../golden/support/steps/shared';
import { createJob, createProject } from '../../golden/support/steps/work';
import { bookMaterialDialog } from '../support/a1-steps';

test.describe('A1 Inventar @AUDIT-W1-A1', () => {
  test('A1-39/A1-42: Material planen, geplant und ungeplant entnehmen, Projekt summiert', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const projectNumber = `A1-MAT-P-${world.runId}`;
    const jobNumber = `A1-MAT-J-${world.runId}`;
    await createProject(adminPage, { projectNumber, title: `A1 Materialprojekt ${world.runId}` });
    await createJob(adminPage, {
      jobNumber,
      title: `A1 Materialauftrag ${world.runId}`,
      projectNumber,
      assignEmployeeName: 'Emil',
    });

    await adminPage.goto(`/auftraege/${jobNumber}`);
    await adminPage.waitForLoadState('networkidle');
    const stockBeforeJobPlan = await getInventoryLedgerState(
      world.orgId,
      world.inventory.itemId,
      world.inventory.locationId,
    );
    await planMaterialOnDetailPage(adminPage, {
      itemName: world.inventory.itemName,
      locationName: world.inventory.locationName,
      quantity: 3,
    });
    // Planning reserves nothing: the stock ledger is unchanged.
    expect(
      await getInventoryLedgerState(world.orgId, world.inventory.itemId, world.inventory.locationId),
    ).toEqual(stockBeforeJobPlan);

    await employeePage.goto(`/auftraege/${jobNumber}`);
    const materialLine = jobMaterialLine(employeePage, world.inventory.itemName);
    await bookMaterialDialog(
      employeePage,
      jobMaterialLineAction(materialLine, 'take'),
      JOB_MATERIAL_ACTIONS.take.heading,
      '2',
    );
    await bookMaterialDialog(
      employeePage,
      jobMaterialLineAction(materialLine, 'return'),
      JOB_MATERIAL_ACTIONS.return.heading,
      '1',
      JOB_MATERIAL_ACTIONS.return.submit,
    );
    const returnReachedUi = await expect(materialLine)
      .toContainText(/\+1/, { timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!returnReachedUi) await employeePage.reload();
    await expect(materialLine).toContainText(/\+1/);
    await expect(materialLine).toContainText(world.inventory.itemName);
    await expect(materialLine).not.toContainText(INVENTORY_COPY.billable);
    await takeMaterialOnJobPage(employeePage, jobNumber, world.inventory.itemName, 1);

    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    const stockBeforeDirectPlan = await getInventoryLedgerState(
      world.orgId,
      world.inventory.itemId,
      world.inventory.locationId,
    );
    // P1-13 adds the project qualification client section immediately before
    // material. Wait for that boundary to hydrate so the first material click
    // cannot land on the streamed HTML before its handler is attached.
    await expect(projectQualificationSection(adminPage)).toBeVisible({
      timeout: 30_000,
    });
    await planMaterialOnDetailPage(adminPage, {
      itemName: world.inventory.itemName,
      locationName: world.inventory.locationName,
      quantity: 1,
    });
    expect(
      await getInventoryLedgerState(world.orgId, world.inventory.itemId, world.inventory.locationId),
    ).toEqual(stockBeforeDirectPlan);
    await expect(textInDom(adminPage, INVENTORY_COPY.material.noDirectProjectMaterial)).toHaveCount(0);
    await expect(visibleText(adminPage, INVENTORY_COPY.material.inheritedFromJobs)).toBeVisible();
    await expect(visibleText(adminPage, INVENTORY_COPY.material.projectTotal)).toBeVisible();
    await expect(visibleText(adminPage, world.inventory.itemName)).toBeVisible();
    const projectTotal = projectMaterialTotal(adminPage, world.inventory.itemId);
    await expect(projectTotal).toContainText(INVENTORY_COPY.materialDemand);
    await expect(projectTotal).toContainText(/-3/);
    await expect(projectTotal).toContainText(/\+1/);
    await expect(projectTotal).toContainText(billableQuantityPattern(2));
  });

  test('A1-40/A1-44: Artikel und Lager per UI sowie alle Inventaransichten', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const inventoryLocationName = `A1 Lager ${world.runId}`;
    const inventoryItemName = `A1 Artikel ${world.runId}`;
    await createInventoryLocation(adminPage, inventoryLocationName);
    await createInventoryItem(adminPage, {
      name: inventoryItemName,
      locationName: inventoryLocationName,
      initialQuantity: 5,
      supplierName: `A1 Lieferant ${world.runId}`,
    });
    await adminPage.goto('/inventar');
    await openItemRowAction(adminPage, inventoryRow(adminPage, inventoryItemName), 'edit');
    const editDialog = inventoryDialog(adminPage, 'editItem');
    await editDialog.locator('#inventory-item-type').click();
    for (const type of ['material', 'consumable', 'tool', 'asset'] as const) {
      await expect(
        adminPage.getByRole('option', { name: INVENTORY_ITEM_TYPE_LABELS[type], exact: true }),
      ).toBeVisible();
    }
    await adminPage.getByRole('option', { name: INVENTORY_ITEM_TYPE_LABELS.material, exact: true }).click();
    await selectFromSearchable(
      adminPage,
      editDialog.locator('#inventory-item-unit'),
      getInventoryUnitLabel('meter'),
    );
    await editDialog.locator('#inventory-item-internal-sku').fill(`SKU-${world.runId}`);
    await editDialog
      .locator('#inventory-item-barcode')
      .fill(`400${world.runId.replace(/\D/g, '').slice(-10)}`);
    await editDialog.locator('#inventory-item-manufacturer').fill('WerkFlow Prüfhersteller');
    await editDialog.locator('#inventory-item-supplier-number').fill(`LIEF-${world.runId}`);
    await editDialog.locator('#inventory-item-minimum-stock').fill('2');
    await editDialog.locator('#inventory-item-target-stock').fill('12');
    await editDialog.locator('#inventory-item-purchase-price').fill('12,50');
    await editDialog.locator('#inventory-item-sale-price').fill('24,90');
    await editDialog.locator('#inventory-item-description').fill('A1 vollständige Artikelbeschreibung');
    await editDialog.locator('#inventory-item-notes').fill('A1 interne Notiz');
    const billableCheckbox = editDialog.getByRole('checkbox', {
      name: INVENTORY_COPY.billable,
    });
    if (!(await billableCheckbox.isChecked())) await billableCheckbox.click();
    await editDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
    await expect(editDialog).toHaveCount(0, { timeout: 20_000 });

    const createDialog = inventoryDialog(adminPage, 'createItem');
    for (const [suffix, type] of [
      ['V', 'consumable'],
      ['W', 'tool'],
      ['G', 'asset'],
    ] as const) {
      await createItemButton(adminPage).click();
      await createDialog.locator('#inventory-item-name').fill(`A1 Typ ${suffix} ${world.runId}`);
      await createDialog.locator('#inventory-item-type').click();
      await adminPage.getByRole('option', { name: INVENTORY_ITEM_TYPE_LABELS[type], exact: true }).click();
      await createDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
      await expect(createDialog).toHaveCount(0, { timeout: 20_000 });
    }
    const toolItemName = `A1 Typ W ${world.runId}`;

    await createLocationButton(adminPage).click();
    const locationDialog = inventoryDialog(adminPage, 'createLocation');
    const vehicleLocation = `A1 Fahrzeug ${world.runId}`;
    await locationDialog.locator('#inventory-location-name').fill(vehicleLocation);
    await locationDialog.locator('#inventory-location-type').click();
    for (const type of ['storage', 'room', 'shelf', 'vehicle', 'other'] as const) {
      await expect(
        adminPage.getByRole('option', { name: INVENTORY_LOCATION_TYPE_LABELS[type], exact: true }),
      ).toBeVisible();
    }
    await adminPage
      .getByRole('option', { name: INVENTORY_LOCATION_TYPE_LABELS.vehicle, exact: true })
      .click();
    await locationDialog.locator('#inventory-location-description').fill('Servicefahrzeug Nord');
    await locationDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
    await expect(locationDialog).toHaveCount(0, { timeout: 20_000 });
    await inventoryTab(adminPage, 'locations').click();
    await expect(pendingLocationStatus(adminPage)).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(inventoryLocationCard(adminPage, vehicleLocation)).toContainText(
      INVENTORY_LOCATION_TYPE_LABELS.vehicle,
    );

    await adminPage.goto('/inventar');
    await expect(visibleText(adminPage, inventoryItemName)).toBeVisible();
    for (const view of INVENTORY_VIEWS) {
      await inventoryTab(adminPage, view).click();
      await expect(inventoryTab(adminPage, view)).toHaveAttribute('data-state', 'active');
    }
    await inventoryTab(adminPage, 'locations').click();
    await expect(inventoryLocationCard(adminPage, vehicleLocation)).toContainText(
      INVENTORY_LOCATION_TYPE_LABELS.vehicle,
    );
    await inventoryTab(adminPage, 'items').click();
    await itemSearchField(adminPage).fill(inventoryItemName);
    await expect(visibleText(adminPage, inventoryItemName)).toBeVisible();
    await expect(textInDom(adminPage, toolItemName)).toHaveCount(0);
    await itemSearchField(adminPage).fill('');
    await itemTypeFilter(adminPage).click();
    await adminPage.getByRole('option', { name: INVENTORY_ITEM_TYPE_LABELS.tool, exact: true }).click();
    await expect(visibleText(adminPage, toolItemName)).toBeVisible();
    await expect(textInDom(adminPage, inventoryItemName)).toHaveCount(0);
    await itemTypeFilter(adminPage).click();
    await adminPage.getByRole('option', { name: INVENTORY_COPY.allTypes, exact: true }).click();
    await selectFromSearchable(adminPage, itemLocationFilter(adminPage), inventoryLocationName);
    await expect(visibleText(adminPage, inventoryItemName)).toBeVisible();
    await expect(textInDom(adminPage, toolItemName)).toHaveCount(0);

    await expectRedirectedAway(employeePage, '/inventar');
    await selectFromSearchable(adminPage, itemLocationFilter(adminPage), INVENTORY_COPY.allLocations);
    const liveItemName = `A1 Inventar Live ${world.runId}`;
    await itemSearchField(adminPage).fill(liveItemName);
    await expect(textInDom(adminPage, liveItemName)).toHaveCount(0);
    await createInventoryItem(bueroPage, { name: liveItemName });
    await expect(visibleText(adminPage, liveItemName)).toBeVisible({
      timeout: 30_000,
    });
  });

  test('A1-41: Zu-/Abgang, Negativsperre und nachvollziehbare Bewegung', async ({ adminPage, world }) => {
    const locationName = `A1 Bestandslager ${world.runId}`;
    const itemName = `A1 Bestandsartikel ${world.runId}`;
    const inboundReason = testData`A1 Zugang`;
    const outboundReason = testData`A1 Ausgang`;
    await createInventoryLocation(adminPage, locationName);
    await createInventoryItem(adminPage, { name: itemName, locationName, initialQuantity: 5 });
    await adminPage.goto('/inventar');
    const row = inventoryRow(adminPage, itemName);
    const stockDialog = inventoryDialog(adminPage, 'adjustStock');

    await openItemRowAction(adminPage, row, 'adjustStock');
    await stockDialog.locator('#inventory-stock-quantity').fill('2');
    await stockDialog.locator('#inventory-stock-reason').fill(inboundReason);
    await stockDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
    await expect(stockDialog).toHaveCount(0, { timeout: 20_000 });

    await openItemRowAction(adminPage, row, 'adjustStock');
    await stockDialog.getByRole('button', { name: INVENTORY_COPY.withdraw }).click();
    await stockDialog.locator('#inventory-stock-quantity').fill('1');
    await stockDialog.locator('#inventory-stock-reason').fill(outboundReason);
    await stockDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
    await expect(stockDialog).toHaveCount(0, { timeout: 20_000 });

    await openItemRowAction(adminPage, row, 'adjustStock');
    await stockDialog.getByRole('button', { name: INVENTORY_COPY.withdraw }).click();
    await stockDialog.locator('#inventory-stock-quantity').fill('999');
    await stockDialog.locator('#inventory-stock-reason').fill('A1 Negativtest');
    await stockDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
    await expect(stockDialog.getByText(INVENTORY_COPY.insufficientStock)).toBeVisible();
    await stockDialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();

    await inventoryTab(adminPage, 'movements').click();
    const inboundMovement = inventoryRow(adminPage, itemName).filter({
      hasText: INVENTORY_MOVEMENT_TYPE_LABELS.stock_in,
    });
    // Whole-row cells in column order: Zeitpunkt, Artikel, Lager, Von, Nach,
    // Bewegung, Vorher, Menge, Danach, Grund. Run id and time stay in their
    // own cells, so a quantity cannot match them.
    await expect(inboundMovement.getByRole('cell')).toHaveText([
      /\d{4}/,
      itemName,
      locationName,
      INVENTORY_COPY.movementSource.external,
      locationName,
      INVENTORY_MOVEMENT_TYPE_LABELS.stock_in,
      '5',
      '+2',
      '7',
      inboundReason,
    ]);
    const outboundMovement = inventoryRow(adminPage, itemName).filter({
      hasText: INVENTORY_MOVEMENT_TYPE_LABELS.stock_out,
    });
    await expect(outboundMovement.getByRole('cell')).toHaveText([
      /\d{4}/,
      itemName,
      locationName,
      locationName,
      INVENTORY_COPY.movementTarget.correctionOut,
      INVENTORY_MOVEMENT_TYPE_LABELS.stock_out,
      '7',
      '-1',
      '6',
      outboundReason,
    ]);
  });

  test('A1-43: CSV-Spaltenzuordnung legt Stammdaten und Anfangsbewegung an', async ({ adminPage, world }) => {
    const importedItem = `A1 CSV Artikel ${world.runId}`;
    const importedLocation = `A1 CSV Lager ${world.runId}`;
    const importedCategory = testData`A1 Kategorie`;
    const importedSupplier = testData`A1 CSV Lieferant`;
    await adminPage.goto('/inventar');
    await csvImportButton(adminPage).click();
    const dialog = inventoryDialog(adminPage, 'importCsv');
    await dialog.locator('input[type="file"]').setInputFiles({
      name: `a1-import-${world.runId}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(
        `Bezeichnung;Gruppe;Ort;Anbieter;Menge;Einheit\n${importedItem};${importedCategory};${importedLocation};${importedSupplier};4;Stück`,
      ),
    });
    const mappings = {
      name: 'Bezeichnung',
      categoryName: 'Gruppe',
      locationName: 'Ort',
      supplierName: 'Anbieter',
      quantity: 'Menge',
      unit: 'Einheit',
    } as const;
    for (const [field, header] of Object.entries(mappings)) {
      await selectFromSearchable(adminPage, dialog.locator(`#inventory-import-${field}`), header);
    }
    await csvImportSubmit(dialog).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    const importedRow = inventoryRow(adminPage, importedItem);
    await expect(importedRow).toContainText(importedCategory, {
      timeout: 20_000,
    });
    await expect(importedRow).toContainText(importedLocation);
    // Bestand and Verfügbar both show the imported quantity.
    await expect(
      importedRow.getByRole('cell', { name: formatInventoryQuantity(4, 'piece'), exact: true }),
    ).toHaveCount(2);
    await openItemRowAction(adminPage, importedRow, 'edit');
    const itemDialog = inventoryDialog(adminPage, 'editItem');
    await expect(itemDialog.locator('#inventory-item-category')).toContainText(importedCategory);
    await expect(itemDialog.locator('#inventory-item-supplier')).toContainText(importedSupplier);
    await itemDialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();
    await inventoryTab(adminPage, 'locations').click();
    await expect(visibleText(adminPage, importedLocation)).toBeVisible();
    await inventoryTab(adminPage, 'movements').click();
    const initialMovement = inventoryRow(adminPage, importedItem);
    await expect(initialMovement).toContainText(INVENTORY_MOVEMENT_TYPE_LABELS.initial_count);
    await expect(initialMovement.getByRole('cell', { name: '0', exact: true })).toBeVisible();
    await expect(initialMovement.getByRole('cell', { name: '+4', exact: true })).toBeVisible();
    await expect(initialMovement.getByRole('cell', { name: '4', exact: true })).toBeVisible();
  });
});
