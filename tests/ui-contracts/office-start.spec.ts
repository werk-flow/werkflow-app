import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  const url = 'http://localhost/ui-contracts';
  await page.route(url, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto(url);
  await page.evaluate(() => {
    window.uiContractFixture = 'office-start';
  });
  await page.addScriptTag({ path: bundle });
  // The app's stylesheet, so a placeholder's skeletons take their rendered size.
  const css = process.env.WERKFLOW_UI_CONTRACT_CSS;
  if (!css) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.addStyleTag({ path: css });
});

test('the office start shows each Aufgaben section with its count, its first three items and the way into Aufgaben, never personnel approvals', async ({
  page,
}) => {
  const filled = page.getByTestId('office-start-filled');
  await expect(filled.getByRole('heading', { name: 'Zeitfreigaben' })).toHaveCount(0);
  await expect(filled.getByRole('heading', { name: 'Urlaubsanträge' })).toHaveCount(0);
  await expect(filled.getByText('Max Mustermann')).toHaveCount(0);

  const overdue = filled.getByTestId('office-start-attention-overdue-job-tasks');
  await expect(overdue.getByRole('heading', { name: /^Überfällige Aufträge\s*\(5\)$/ })).toBeVisible();
  const rows = overdue.getByRole('link', { name: /^Auftrag / });
  await expect(rows).toHaveCount(3);
  await expect(rows).toContainText(['A-2026-001', 'A-2026-002', 'A-2026-003']);
  await expect(overdue.getByRole('link', { name: /^Auftrag A-2026-001 / })).toHaveAttribute(
    'href',
    '/auftraege/A-2026-001',
  );
  await expect(
    overdue.getByRole('link', { name: 'Überfällige Aufträge: alle 5 in Aufgaben' }),
  ).toHaveAttribute('href', '/aufgaben#aufgaben-overdueJob');

  const maintenance = filled.getByTestId('office-start-attention-due-maintenance-tasks');
  await expect(maintenance.getByRole('heading', { name: /^Fällige Wartungen\s*\(4\)$/ })).toBeVisible();
  const due = maintenance.getByRole('link', { name: /^Wartung / });
  await expect(due).toHaveCount(3);
  await expect(due).toContainText([
    'fällig seit 02.11.2026 · Heizzentrale Lindenhof',
    'fällig seit 12.11.2026',
    'fällig am 30.11.2026 · Heizzentrale Lindenhof',
  ]);
  await expect(
    maintenance.getByRole('link', {
      name: 'Wartung Gasbrennwertkessel, Speicher öffnen, fällig seit 02.11.2026',
    }),
  ).toHaveAttribute('href', '/service/wartung?q=WPL-2026-0000');
  await expect(
    maintenance.getByRole('link', { name: 'Fällige Wartungen: alle 4 in Aufgaben' }),
  ).toHaveAttribute('href', '/aufgaben#aufgaben-dueMaintenance');
});

test('the due maintenance follows the jobs past their last visit, as in Aufgaben', async ({ page }) => {
  const headings = page.getByTestId('office-start-filled').getByRole('heading', { level: 3 });
  await expect(headings).toHaveText([/^Überfällige Aufträge/, /^Fällige Wartungen/]);
});

test('with nothing open the office start says so, but only while its read is current', async ({ page }) => {
  await expect(page.getByTestId('office-start-empty').getByText('Keine offenen Aufgaben.')).toBeVisible();
  await expect(
    page.getByTestId('office-start-attention-stale-empty').getByText('Keine offenen Aufgaben.'),
  ).toHaveCount(0);
});

test('a failed Aufgaben read shows its retry; a loading one its placeholder', async ({ page }) => {
  const failed = page.getByTestId('office-start-attention-failed');
  await expect(
    failed.getByText('Deine offenen Aufgaben konnten nicht geladen werden.', { exact: false }),
  ).toBeVisible();
  await expect(failed.getByRole('button', { name: 'Erneut laden' })).toHaveCount(1);
  const loading = page.getByTestId('office-start-attention-loading');
  await expect(loading.locator('[data-slot="skeleton"]')).not.toHaveCount(0);
  await expect(loading.getByText('Keine offenen Aufgaben.')).toHaveCount(0);
});

test('a stale read keeps its last tasks, due maintenance included, marked stale with one retry', async ({
  page,
}) => {
  const region = page.getByTestId('office-start-attention-stale');
  const due = region.getByRole('link', { name: /^Wartung Gasbrennwertkessel, Speicher / });
  await expect(due).toBeVisible();
  expect(await due.evaluate((element) => element.closest('[data-stale]') !== null)).toBe(true);
  await expect(region.getByRole('button', { name: 'Erneut laden' })).toHaveCount(1);
});
