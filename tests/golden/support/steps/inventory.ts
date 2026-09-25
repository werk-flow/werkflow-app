import { expect, type Page } from "@playwright/test";
import { selectFromSearchable, visibleText } from './shared';

export async function createInventoryLocation(
  page: Page,
  name: string,
): Promise<void> {
  await page.goto("/inventar");
  await page.getByRole("button", { name: "Lager", exact: true }).click();
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Lager anlegen" }) });
  await dialog.locator("#inventory-location-name").fill(name);
  await dialog.getByRole("button", { name: "Speichern" }).click();
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
      throw new Error(
        "createInventoryItem: initialQuantity requires a locationName",
      );
    }
    if (!Number.isFinite(options.initialQuantity)) {
      throw new Error("createInventoryItem: initialQuantity must be finite");
    }
  }

  await page.goto("/inventar");
  await page.getByRole("button", { name: "Artikel", exact: true }).click();
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Artikel anlegen" }) });
  await dialog.locator("#inventory-item-name").fill(options.name);
  if (options.locationName) {
    await selectFromSearchable(
      page,
      dialog.locator("#inventory-item-initial-location"),
      options.locationName,
    );
    await dialog
      .locator("#inventory-item-initial-quantity")
      .fill(String(options.initialQuantity ?? 0));
  }
  if (options.supplierName) {
    // SelectWithCreate: the action row opens a quick-create dialog that stages
    // the new supplier name; the supplier row is created on item save.
    await dialog.locator("#inventory-item-supplier").click();
    await page
      .getByRole("button", { name: "Neuen Lieferanten anlegen", exact: true })
      .click();
    const supplierDialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "Neuen Lieferanten anlegen" }),
    });
    await supplierDialog
      .locator("#inventory-new-supplier-name")
      .fill(options.supplierName);
    await supplierDialog.getByRole("button", { name: "Übernehmen" }).click();
    await expect(supplierDialog).toHaveCount(0, { timeout: 10_000 });
  }
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

export async function takeMaterialOnJobPage(
  page: Page,
  jobNumber: string,
  itemName: string,
  quantity: number,
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  await expect(visibleText(page, "Material & Inventar")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Aus Lager entnehmen" }).click();
  await expect(
    page.getByRole("heading", { name: "Entnahme buchen" }),
  ).toBeVisible();

  // Pick the item from the search list; a row with quantity 1 appears.
  await page
    .getByRole("dialog")
    .getByRole("button")
    .filter({ hasText: itemName })
    .first()
    .click();
  await page
    .locator('input[id^="material-row-"][id$="-quantity"]')
    .fill(String(quantity));

  // The line rows outside the dialog also carry an "Entnahme buchen" button,
  // so the confirm click must stay scoped to the dialog.
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Entnahme buchen" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
}

export async function returnMaterialOnJobPage(
  page: Page,
  jobNumber: string,
  itemName: string,
  quantity: number,
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  await expect(visibleText(page, "Material & Inventar")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("main")
    .getByTestId("job-material-line")
    .filter({ hasText: itemName })
    .locator("button:enabled")
    .filter({ hasText: "Zurücklegen" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Material zurücklegen" }),
  ).toBeVisible();

  await page
    .locator('input[id^="material-row-"][id$="-quantity"]')
    .fill(String(quantity));
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Zurücklegen" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
}

export async function planMaterialOnJobPage(
  page: Page,
  jobNumber: string,
  itemName: string,
  locationName: string,
  quantity: number,
): Promise<void> {
  await page.goto(`/auftraege/${encodeURIComponent(jobNumber)}`);
  await page.getByRole("button", { name: "Material planen" }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Material planen" }),
  });
  await dialog.getByLabel("Artikel suchen").fill(itemName);
  await dialog
    .getByRole("button")
    .filter({ hasText: itemName })
    .first()
    .click();
  await dialog.locator('input[id$="-quantity"]').first().fill(String(quantity));
  await selectFromSearchable(
    page,
    dialog.locator('button[id$="-location"]').first(),
    locationName,
  );
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}
