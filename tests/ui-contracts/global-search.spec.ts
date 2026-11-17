import { expect, test } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// The header search shows each kind's failure with its own retry beside the
// kinds that answered; the retry reads only the failed source for the same
// query. A failed search as a whole is a failure with a retry, never „Keine
// Treffer“ (docs/features/customers-and-crm.md, Search).
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'global-search');
  await page.getByRole('button', { name: 'Suche öffnen', exact: true }).click();
});

test('a failed kind retries alone while the other kinds stay', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Suchen', exact: true });
  await dialog.getByRole('textbox', { name: 'Suchbegriff', exact: true }).fill('Lindenhof');
  const customers = dialog.getByRole('region', { name: 'Kunden', exact: true });
  await expect(customers.getByRole('link', { name: /Hausverwaltung Lindenhof GmbH/ })).toBeVisible();
  const failure = dialog.getByRole('alert').filter({ hasText: 'Dokumente' });
  await expect(failure).toContainText('Die Suche konnte nicht geladen werden.');

  await failure.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  const documents = dialog.getByRole('region', { name: 'Dokumente', exact: true });
  await expect(documents.getByRole('link', { name: /Wartungsvertrag Lindenhof/ })).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(customers.getByRole('link', { name: /Hausverwaltung Lindenhof GmbH/ })).toBeVisible();
  expect(await page.evaluate(() => window.uiContractSearchReads)).toEqual([
    { query: 'Lindenhof', sources: null },
    { query: 'Lindenhof', sources: ['dokumente'] },
  ]);
});

test('a failed search shows its failure with a retry, never an empty result', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Suchen', exact: true });
  await dialog.getByRole('textbox', { name: 'Suchbegriff', exact: true }).fill('Störung');
  const failure = dialog.getByRole('alert');
  await expect(failure).toContainText('Die Suche konnte nicht geladen werden.');
  await expect(failure.getByRole('button', { name: 'Erneut laden', exact: true })).toBeVisible();
  await expect(dialog.getByText('Keine Treffer gefunden')).toHaveCount(0);
});

test('a search without a hit says so', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Suchen', exact: true });
  await dialog.getByRole('textbox', { name: 'Suchbegriff', exact: true }).fill('Nichts');
  await expect(dialog.getByText('Keine Treffer gefunden')).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('a retried kind without a hit leaves „Keine Treffer“ when nothing else matched', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Suchen', exact: true });
  await dialog.getByRole('textbox', { name: 'Suchbegriff', exact: true }).fill('Leer');
  const failure = dialog.getByRole('alert').filter({ hasText: 'Dokumente' });
  await failure.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await expect(dialog.getByText('Keine Treffer gefunden')).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('two failed kinds recover one after the other and each retry reads only its own', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Suchen', exact: true });
  await dialog.getByRole('textbox', { name: 'Suchbegriff', exact: true }).fill('Zwei');
  const retry = (kind: string) =>
    dialog
      .getByRole('alert')
      .filter({ hasText: kind })
      .getByRole('button', { name: 'Erneut laden', exact: true });
  await retry('Kunden').click();
  const customer = dialog
    .getByRole('region', { name: 'Kunden', exact: true })
    .getByRole('link', { name: /Hausverwaltung Lindenhof GmbH/ });
  await expect(customer).toBeVisible();
  await retry('Dokumente').click();
  await expect(
    dialog
      .getByRole('region', { name: 'Dokumente', exact: true })
      .getByRole('link', { name: /Wartungsvertrag Lindenhof/ }),
  ).toBeVisible();
  await expect(customer).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.uiContractSearchReads)).toEqual([
    { query: 'Zwei', sources: null },
    { query: 'Zwei', sources: ['kunden'] },
    { query: 'Zwei', sources: ['dokumente'] },
  ]);
});

test('a kind without a list names how many hits it shows instead of „Alle anzeigen“', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Suchen', exact: true });
  await dialog.getByRole('textbox', { name: 'Suchbegriff', exact: true }).fill('Therme');
  const equipment = dialog.getByRole('region', { name: 'Anlagen', exact: true });
  await expect(equipment.getByRole('listitem')).toHaveCount(5);
  await expect(equipment.getByText('5 von 7', { exact: true })).toBeVisible();
  await expect(equipment.getByRole('link', { name: /anzeigen/ })).toHaveCount(0);
  const work = dialog.getByRole('region', { name: 'Aufträge und Projekte', exact: true });
  await expect(
    work.getByRole('link', { name: 'Alle anzeigen: Aufträge und Projekte', exact: true }),
  ).toBeVisible();
});
