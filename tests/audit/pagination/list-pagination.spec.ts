import { expect, test } from '../support/fixtures';
import {
  assertDocumentAttachableExclusion,
  persistedInventoryItem,
  seedDocumentPages,
  seedInventoryPages,
} from '../support/list-pagination';
import {
  chooseDocumentCategoryFilter,
  documentLibraryFilterToggle,
  documentLibraryPager,
  documentLibrarySearch,
  documentWorkRow,
  documentWorkRowExpandButton,
  documentWorkRowJobLink,
} from '../../golden/support/steps/documents';
import {
  chooseInventoryItemTypeFilter,
  createInventoryItem,
  inventoryItemCreatedMessage,
  inventoryItemPager,
  inventoryItemRow,
  itemSearchField,
  renameInventoryItem,
} from '../../golden/support/steps/inventory';
import { pressKey } from '../../golden/support/steps/interaction';
import { pagerButton, pagerCount, pagerRange, visibleText } from '../../golden/support/steps/shared';

test.describe('Bounded document and inventory pages @AUDIT-PERFORMANCE-PAGINATION', () => {
  test('inventory pages preserve global filters, editing and creation @AUDIT-PERFORMANCE-PAGINATION-INVENTORY', async ({
    adminPage,
    world,
  }) => {
    const seeded = await seedInventoryPages(world);
    await adminPage.goto('/inventar');
    const search = itemSearchField(adminPage);
    const pages = inventoryItemPager(adminPage);
    await search.fill(seeded.prefix);
    await expect(pagerCount(pages)).toHaveText(pagerRange(1, 50, 61));
    await expect(inventoryItemRow(adminPage, seeded.tailName)).toHaveCount(0);
    await pagerButton(pages, 'next').click();
    await expect(pagerCount(pages)).toHaveText(pagerRange(51, 61, 61));
    await expect(inventoryItemRow(adminPage, seeded.tailName)).toBeVisible();
    await pagerButton(pages, 'previous').click();
    await expect(pagerCount(pages)).toHaveText(pagerRange(1, 50, 61));
    await chooseInventoryItemTypeFilter(adminPage, 'tool');
    await expect(pagerCount(pages)).toHaveText(pagerRange(1, 1, 1));
    await expect(inventoryItemRow(adminPage, seeded.tailName)).toBeVisible();
    await search.fill(seeded.tailName);
    const original = await persistedInventoryItem(world, seeded.tailName);
    expect(original?.item_type).toBe('tool');
    const renamed = `${seeded.tailName} geändert`;
    await renameInventoryItem(adminPage, seeded.tailName, renamed);
    await expect(inventoryItemRow(adminPage, renamed)).toBeVisible();
    expect(await persistedInventoryItem(world, renamed)).toEqual({ ...original, name: renamed });

    const createdName = `${seeded.prefix} 062 Neu`;
    await createInventoryItem(adminPage, { name: createdName });
    await expect(inventoryItemCreatedMessage(adminPage)).toBeVisible();
    await itemSearchField(adminPage).fill(createdName);
    await expect(inventoryItemRow(adminPage, createdName)).toBeVisible();
    await expect(pagerCount(pages)).toHaveText(pagerRange(1, 1, 1));
    expect((await persistedInventoryItem(world, createdName))?.name).toBe(createdName);
  });

  test('document work pages hydrate later link targets and filter the whole dataset @AUDIT-PERFORMANCE-PAGINATION-DOCUMENTS', async ({
    adminPage,
    world,
  }) => {
    const seeded = await seedDocumentPages(world);
    await assertDocumentAttachableExclusion(world, seeded);
    await adminPage.goto('/dokumente?view=work');
    const pages = documentLibraryPager(adminPage);
    await expect(pagerCount(pages)).toHaveText(pagerRange(1, 50, 61));
    await expect(documentWorkRow(adminPage, seeded.tailJobTitle)).toHaveCount(0);
    await pagerButton(pages, 'next').click();
    await expect(pagerCount(pages)).toHaveText(pagerRange(51, 61, 61));
    const tailJob = documentWorkRow(adminPage, seeded.tailJobTitle);
    await expect(tailJob).toBeVisible();
    await expect(documentWorkRowJobLink(tailJob)).toHaveAttribute(
      'href',
      `/auftraege/${encodeURIComponent(seeded.tailJobNumber)}`,
    );
    await documentWorkRowExpandButton(tailJob).click();
    await expect(visibleText(adminPage.getByRole('main'), seeded.tailName)).toBeVisible();

    await adminPage.goto('/dokumente?view=all');
    await expect(pagerCount(pages)).toHaveText(pagerRange(1, 50, 61));
    const documentSearch = documentLibrarySearch(adminPage);
    await documentSearch.fill(seeded.tailName);
    await pressKey(adminPage, 'Enter', { into: documentSearch });
    await expect(pagerCount(pages)).toHaveText(pagerRange(1, 1, 1));
    await expect(visibleText(adminPage.getByRole('main'), seeded.tailName)).toBeVisible();
    await documentSearch.fill('');
    await pressKey(adminPage, 'Enter', { into: documentSearch });
    await expect(pagerCount(pages)).toHaveText(pagerRange(1, 50, 61));
    await documentLibraryFilterToggle(adminPage).click();
    await chooseDocumentCategoryFilter(adminPage, 'report');
    await expect(pagerCount(pages)).toHaveText(pagerRange(1, 1, 1));
    await expect(visibleText(adminPage.getByRole('main'), seeded.tailName)).toBeVisible();
  });
});
