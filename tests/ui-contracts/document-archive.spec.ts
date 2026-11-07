import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.clock.install({ time: new Date('2026-11-07T10:00:00Z') });
  const url = 'http://localhost/ui-contracts';
  await page.route(url, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto(url);
  await page.evaluate(() => {
    window.uiContractFixture = 'document-archive';
  });
  await page.addScriptTag({ path: bundle });
});

function documentDate(page: Page) {
  return page.getByRole('group', { name: 'Belegdatum der Datei' });
}

function retentionWrites(page: Page) {
  return page.evaluate(() => window.documentArchiveContract.writes);
}

test('a typed document date stays a draft until it is saved', async ({ page }) => {
  const picker = documentDate(page);
  // A lone day digit, and a year left after a typing pause and a blur.
  await picker.locator('[data-segment="day"]').click();
  await page.keyboard.type('1');
  await picker.locator('[data-segment="year"]').click();
  await page.keyboard.type('20');
  await page.clock.runFor(1000);
  await page.keyboard.type('2');
  await page.keyboard.press('Tab');
  expect(await retentionWrites(page)).toEqual([]);

  await picker.locator('[data-segment="year"]').click();
  await page.keyboard.type('2025');
  expect(await retentionWrites(page)).toEqual([]);
  await page.getByRole('button', { name: 'Belegdatum speichern' }).click();
  expect(await retentionWrites(page)).toEqual([{ documentDate: '2025-03-01', retentionClass: 'ten_years' }]);
  await expect(page.getByRole('button', { name: 'Belegdatum speichern' })).toHaveCount(0);
  await expect(picker).toHaveText(/01\.03\.2025/);
});

test('a refused document date stays typed for a retry', async ({ page }) => {
  const picker = documentDate(page);
  await picker.locator('[data-segment="year"]').click();
  await page.keyboard.type('2025');
  await page.evaluate(() => {
    window.documentArchiveContract.refuseNext = true;
  });
  const save = page.getByRole('button', { name: 'Belegdatum speichern' });
  await save.click();
  await expect(save).toBeVisible();
  await expect(picker).toHaveText(/14\.03\.2025/);

  await save.click();
  expect(await retentionWrites(page)).toEqual([
    { documentDate: '2025-03-14', retentionClass: 'ten_years' },
    { documentDate: '2025-03-14', retentionClass: 'ten_years' },
  ]);
  await expect(save).toHaveCount(0);
  await expect(picker).toHaveText(/14\.03\.2025/);
});

test('a paused partial year is refused at „Speichern“, marked and focused, and never written', async ({
  page,
}) => {
  const picker = documentDate(page);
  // „20“ and a pause: the picker commits the year 20.
  await picker.locator('[data-segment="year"]').click();
  await page.keyboard.type('20');
  await page.clock.runFor(1000);
  await expect(picker).toHaveText(/14\.03\.0020/);

  await page.getByRole('button', { name: 'Belegdatum speichern' }).click();
  expect(await retentionWrites(page)).toEqual([]);
  await expect(picker).toHaveAttribute('data-invalid', 'true');
  await expect(picker).toBeFocused();
  await expect(picker).toHaveAccessibleDescription(
    'Gib ein Belegdatum zwischen dem 01.01.1900 und dem 07.11.2027 ein.',
  );

  // Completing the year clears the mark and saves.
  await picker.locator('[data-segment="year"]').click();
  await page.keyboard.type('2025');
  await expect(picker).not.toHaveAttribute('data-invalid');
  await page.getByRole('button', { name: 'Belegdatum speichern' }).click();
  expect(await retentionWrites(page)).toEqual([{ documentDate: '2025-03-14', retentionClass: 'ten_years' }]);
});

test('„Festschreiben“ with an unsaved document date files nothing and marks and focuses the date', async ({
  page,
}) => {
  const picker = documentDate(page);
  await picker.locator('[data-segment="year"]').click();
  await page.keyboard.type('2025');
  const file = page.getByRole('button', { name: 'Festschreiben' });
  await expect(file).toBeEnabled();
  await file.click();
  expect(await page.evaluate(() => window.documentArchiveContract.filings)).toEqual([]);
  expect(await retentionWrites(page)).toEqual([]);
  await expect(picker).toHaveAttribute('data-invalid', 'true');
  await expect(picker).toBeFocused();
  await expect(picker).toHaveAccessibleDescription(
    'Speichere das Belegdatum oder setz es zurück, bevor du die Datei festschreibst.',
  );

  // Resetting puts the stored date back, and filing then files the date shown.
  await page.getByRole('button', { name: 'Belegdatum zurücksetzen' }).click();
  await expect(picker).toHaveText(/14\.03\.2026/);
  await expect(picker).not.toHaveAttribute('data-invalid');
  await file.click();
  expect(await page.evaluate(() => window.documentArchiveContract.filings)).toEqual(['contract-document']);
});
