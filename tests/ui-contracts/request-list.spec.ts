import { expect, test } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// The URL owns the request list. A tab change shows the chosen tab and the
// loading state in the first frame, keeps the current rows until the new URL
// commits, and then shows the server page for that URL.
test('a status tab echoes at once and the list follows the committed URL', async ({ page }) => {
  await openContractFixture(page, 'request-list');
  const table = page.getByRole('table');
  const pager = page.getByRole('navigation', { name: 'Anfragen', exact: true });
  const closedTab = page.getByRole('tab', { name: 'Geschlossen', exact: true });
  await expect(table.getByRole('link', { name: 'Heizung fällt aus', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Aktiv', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await closedTab.click();
  await expect(closedTab).toHaveAttribute('aria-selected', 'true');
  await expect(pager.getByRole('status', { name: 'Liste wird geladen', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.listNavigationContract.requests)).toEqual([
    '/ui-contracts?status=geschlossen&page=1',
  ]);
  // The rows stay those of the committed URL until the server page arrives.
  await expect(table.getByRole('link', { name: 'Heizung fällt aus', exact: true })).toBeVisible();

  await page.evaluate(() => {
    const [request] = window.listNavigationContract.requests;
    if (!request) throw new Error('expected a recorded list navigation request');
    window.listNavigationContract.commit(request);
  });
  await expect(pager.getByRole('status', { name: 'Liste wird geladen', exact: true })).toHaveCount(0);
  await expect(closedTab).toHaveAttribute('aria-selected', 'true');
  await expect(table.getByRole('link', { name: 'Rückruf zur Abrechnung', exact: true })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Heizung fällt aus', exact: true })).toHaveCount(0);
});

// An open request whose promised callback has passed says so in its list row,
// and a callback that passes while the page is open turns the row and the
// detail overdue on the minute tick, without a database event or a reload.
// A closed request never shows it.
test('an overdue callback shows „Rückruf überfällig“ in the list and the detail', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T11:58:00.000Z') });
  await openContractFixture(page, 'request-list');
  const overdueRow = page.getByRole('row', { name: /Heizung fällt aus/ });
  const dueRow = page.getByRole('row', { name: /Wartung bestätigen/ });
  const details = page.getByRole('region', { name: 'Anfragedetails', exact: true });
  await expect(overdueRow.getByText('Rückruf überfällig', { exact: true })).toBeVisible();
  await expect(dueRow).toBeVisible();
  await expect(dueRow.getByText('Rückruf überfällig', { exact: true })).toHaveCount(0);
  await expect(details.getByText('Rückruf überfällig', { exact: true })).toHaveCount(0);

  await page.clock.fastForward('03:00');
  await expect(dueRow.getByText('Rückruf überfällig', { exact: true })).toBeVisible();
  await expect(details.getByText('Rückruf überfällig', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Geschlossen', exact: true }).click();
  await page.evaluate(() => {
    const [request] = window.listNavigationContract.requests;
    if (!request) throw new Error('expected a recorded list navigation request');
    window.listNavigationContract.commit(request);
  });
  const closedRow = page.getByRole('row', { name: /Rückruf zur Abrechnung/ });
  await expect(closedRow).toBeVisible();
  await expect(closedRow.getByText('Rückruf überfällig', { exact: true })).toHaveCount(0);
});
