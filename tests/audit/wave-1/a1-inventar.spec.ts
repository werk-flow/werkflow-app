import { expect, test } from '../support/fixtures';
import {
  formatInventoryQuantity,
  getInventoryUnitLabel,
  INVENTORY_ITEM_TYPE_LABELS,
  INVENTORY_LOCATION_TYPE_LABELS,
  INVENTORY_MOVEMENT_TYPE_LABELS,
} from '../../../lib/inventory/types';
import { getInventoryLedgerState } from '../../golden/support/db/inventory';
import { observeRouteRenders } from '../../golden/support/route-renders';
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
  inventoryField,
  inventoryImportColumnPicker,
  inventoryImportFileInput,
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
    await expect(projectQualificationSection(adminPage)).toBeVisible();
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
    await inventoryField(editDialog, 'itemType').click();
    for (const type of ['material', 'consumable', 'tool', 'asset'] as const) {
      await expect(
        adminPage.getByRole('option', { name: INVENTORY_ITEM_TYPE_LABELS[type], exact: true }),
      ).toBeVisible();
    }
    await adminPage.getByRole('option', { name: INVENTORY_ITEM_TYPE_LABELS.material, exact: true }).click();
    await selectFromSearchable(
      adminPage,
      inventoryField(editDialog, 'itemUnit'),
      getInventoryUnitLabel('meter'),
    );
    await inventoryField(editDialog, 'itemInternalSku').fill(`SKU-${world.runId}`);
    await inventoryField(editDialog, 'itemBarcode').fill(`400${world.runId.replace(/\D/g, '').slice(-10)}`);
    await inventoryField(editDialog, 'itemManufacturer').fill('WerkFlow Prüfhersteller');
    await inventoryField(editDialog, 'itemSupplierNumber').fill(`LIEF-${world.runId}`);
    await inventoryField(editDialog, 'itemMinimumStock').fill('2');
    await inventoryField(editDialog, 'itemTargetStock').fill('12');
    await inventoryField(editDialog, 'itemPurchasePrice').fill('12,50');
    await inventoryField(editDialog, 'itemSalePrice').fill('24,90');
    await inventoryField(editDialog, 'itemDescription').fill('A1 vollständige Artikelbeschreibung');
    await inventoryField(editDialog, 'itemNotes').fill('A1 interne Notiz');
    const billableCheckbox = editDialog.getByRole('checkbox', {
      name: INVENTORY_COPY.billable,
    });
    if (!(await billableCheckbox.isChecked())) await billableCheckbox.click();
    await editDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
    await expect(editDialog).toHaveCount(0);

    const createDialog = inventoryDialog(adminPage, 'createItem');
    for (const [suffix, type] of [
      ['V', 'consumable'],
      ['W', 'tool'],
      ['G', 'asset'],
    ] as const) {
      await createItemButton(adminPage).click();
      await inventoryField(createDialog, 'itemName').fill(`A1 Typ ${suffix} ${world.runId}`);
      await inventoryField(createDialog, 'itemType').click();
      await adminPage.getByRole('option', { name: INVENTORY_ITEM_TYPE_LABELS[type], exact: true }).click();
      await createDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
      await expect(createDialog).toHaveCount(0);
    }
    const toolItemName = `A1 Typ W ${world.runId}`;

    await createLocationButton(adminPage).click();
    const locationDialog = inventoryDialog(adminPage, 'createLocation');
    const vehicleLocation = `A1 Fahrzeug ${world.runId}`;
    await inventoryField(locationDialog, 'locationName').fill(vehicleLocation);
    await inventoryField(locationDialog, 'locationType').click();
    for (const type of ['storage', 'room', 'shelf', 'vehicle', 'other'] as const) {
      await expect(
        adminPage.getByRole('option', { name: INVENTORY_LOCATION_TYPE_LABELS[type], exact: true }),
      ).toBeVisible();
    }
    await adminPage
      .getByRole('option', { name: INVENTORY_LOCATION_TYPE_LABELS.vehicle, exact: true })
      .click();
    await inventoryField(locationDialog, 'locationDescription').fill('Servicefahrzeug Nord');
    await locationDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
    await expect(locationDialog).toHaveCount(0);
    await inventoryTab(adminPage, 'locations').click();
    await expect(pendingLocationStatus(adminPage)).toHaveCount(0);
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
    await expect(visibleText(adminPage, liveItemName)).toBeVisible();
  });

  test('A1-41: Zu-/Abgang, Negativsperre und nachvollziehbare Bewegung', async ({ adminPage, world }) => {
    const locationName = `A1 Bestandslager ${world.runId}`;
    const itemName = `A1 Bestandsartikel ${world.runId}`;
    const inboundReason = testData`A1 Zugang`;
    const outboundReason = testData`A1 Ausgang`;
    // Each save renders the route once at most (tests/golden/route-renders.json).
    const renders = observeRouteRenders(adminPage, 'a1-inventar');
    await createInventoryLocation(adminPage, locationName);
    await renders.forSave('item.create', () =>
      createInventoryItem(adminPage, { name: itemName, locationName, initialQuantity: 5 }),
    );
    await adminPage.goto('/inventar');
    const row = inventoryRow(adminPage, itemName);
    const stockDialog = inventoryDialog(adminPage, 'adjustStock');

    await openItemRowAction(adminPage, row, 'adjustStock');
    await inventoryField(stockDialog, 'stockQuantity').fill('2');
    await inventoryField(stockDialog, 'stockReason').fill(inboundReason);
    await renders.forSave('stock.adjust', async () => {
      await stockDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
      await expect(stockDialog).toHaveCount(0);
    });

    await openItemRowAction(adminPage, row, 'adjustStock');
    await stockDialog.getByRole('button', { name: INVENTORY_COPY.withdraw }).click();
    await inventoryField(stockDialog, 'stockQuantity').fill('1');
    await inventoryField(stockDialog, 'stockReason').fill(outboundReason);
    await stockDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
    await expect(stockDialog).toHaveCount(0);

    await openItemRowAction(adminPage, row, 'adjustStock');
    await stockDialog.getByRole('button', { name: INVENTORY_COPY.withdraw }).click();
    await inventoryField(stockDialog, 'stockQuantity').fill('999');
    await inventoryField(stockDialog, 'stockReason').fill('A1 Negativtest');
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
    await inventoryImportFileInput(dialog).setInputFiles({
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
      await selectFromSearchable(adminPage, inventoryImportColumnPicker(dialog, field), header);
    }
    await csvImportSubmit(dialog).click();
    await expect(dialog).toHaveCount(0);
    const importedRow = inventoryRow(adminPage, importedItem);
    await expect(importedRow).toContainText(importedCategory);
    await expect(importedRow).toContainText(importedLocation);
    // Bestand and Verfügbar both show the imported quantity.
    await expect(
      importedRow.getByRole('cell', { name: formatInventoryQuantity(4, 'piece'), exact: true }),
    ).toHaveCount(2);
    await openItemRowAction(adminPage, importedRow, 'edit');
    const itemDialog = inventoryDialog(adminPage, 'editItem');
    await expect(inventoryField(itemDialog, 'itemCategory')).toContainText(importedCategory);
    await expect(inventoryField(itemDialog, 'itemSupplier')).toContainText(importedSupplier);
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
