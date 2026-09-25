import { expect, test } from "../support/fixtures";
import { assertDocumentAttachableExclusion, documentWorkRow, inventoryItemRow, persistedInventoryItem, renameInventoryItem, seedDocumentPages, seedInventoryPages } from "../support/list-pagination";
import { createInventoryItem } from "../../golden/support/steps/inventory";
import { visibleText } from "../../golden/support/steps/shared";

test.describe("Bounded document and inventory pages @AUDIT-PERFORMANCE-PAGINATION", () => {
  test("inventory pages preserve global filters, editing and creation @AUDIT-PERFORMANCE-PAGINATION-INVENTORY", async ({ adminPage, world }) => {
    const seeded = await seedInventoryPages(world);
    await adminPage.goto("/inventar");
    const search = adminPage.getByRole("textbox", { name: "Artikel suchen", exact: true });
    const pages = adminPage.getByRole("navigation", { name: "Artikelseiten", exact: true });
    await search.fill(seeded.prefix);
    await expect(pages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toHaveText("1–50 von 61");
    await expect(inventoryItemRow(adminPage, seeded.tailName)).toHaveCount(0);
    await pages.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect(pages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toHaveText("51–61 von 61");
    await expect(inventoryItemRow(adminPage, seeded.tailName)).toBeVisible();
    await pages.getByRole("button", { name: "Zurück", exact: true }).click();
    await expect(pages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toHaveText("1–50 von 61");
    await adminPage.getByRole("combobox", { name: "Nach Typ filtern", exact: true }).click();
    await adminPage.getByRole("option", { name: "Werkzeug", exact: true }).click();
    await expect(pages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toHaveText("1–1 von 1");
    await expect(inventoryItemRow(adminPage, seeded.tailName)).toBeVisible();
    await search.fill(seeded.tailName);
    const original = await persistedInventoryItem(world, seeded.tailName);
    expect(original?.item_type).toBe("tool");
    const renamed = `${seeded.tailName} geändert`;
    await renameInventoryItem(adminPage, seeded.tailName, renamed);
    await expect(inventoryItemRow(adminPage, renamed)).toBeVisible();
    expect(await persistedInventoryItem(world, renamed)).toEqual({ ...original, name: renamed });

    const createdName = `${seeded.prefix} 062 Neu`;
    await createInventoryItem(adminPage, { name: createdName });
    await expect(visibleText(adminPage, "Der Artikel wurde angelegt.")).toBeVisible();
    await adminPage.getByRole("textbox", { name: "Artikel suchen", exact: true }).fill(createdName);
    await expect(inventoryItemRow(adminPage, createdName)).toBeVisible();
    await expect(pages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toHaveText("1–1 von 1");
    expect((await persistedInventoryItem(world, createdName))?.name).toBe(createdName);
  });

  test("document work pages hydrate later link targets and filter the whole dataset @AUDIT-PERFORMANCE-PAGINATION-DOCUMENTS", async ({ adminPage, world }) => {
    const seeded = await seedDocumentPages(world);
    await assertDocumentAttachableExclusion(world, seeded);
    await adminPage.goto("/dokumente?view=work");
    const pages = adminPage.getByRole("navigation", { name: "Dokumente", exact: true });
    await expect(pages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toHaveText("1–50 von 61");
    await expect(documentWorkRow(adminPage, seeded.tailJobTitle)).toHaveCount(0);
    await pages.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect(pages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toHaveText("51–61 von 61");
    const tailJob = documentWorkRow(adminPage, seeded.tailJobTitle);
    await expect(tailJob).toBeVisible();
    await expect(tailJob.getByRole("link", { name: "Zum Auftrag", exact: true })).toHaveAttribute("href", `/auftraege/${encodeURIComponent(seeded.tailJobNumber)}`);
    await tailJob.getByRole("button", { name: "Auftrag aufklappen", exact: true }).click();
    await expect(visibleText(adminPage.getByRole("main"), seeded.tailName)).toBeVisible();

    await adminPage.goto("/dokumente?view=all");
    await expect(pages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toHaveText("1–50 von 61");
    const documentSearch = adminPage.getByPlaceholder("Dokumente suchen...");
    await documentSearch.fill(seeded.tailName);
    await documentSearch.press("Enter");
    await expect(pages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toHaveText("1–1 von 1");
    await expect(visibleText(adminPage.getByRole("main"), seeded.tailName)).toBeVisible();
    await documentSearch.fill("");
    await documentSearch.press("Enter");
    await expect(pages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toHaveText("1–50 von 61");
    await adminPage.getByRole("button", { name: "Filter", exact: true }).click();
    await adminPage.getByRole("combobox", { name: "Kategorie filtern", exact: true }).click();
    await adminPage.getByRole("option", { name: "Berichte", exact: true }).click();
    await expect(pages.getByRole("status", { name: "Eintragsanzahl", exact: true })).toHaveText("1–1 von 1");
    await expect(visibleText(adminPage.getByRole("main"), seeded.tailName)).toBeVisible();
  });
});
