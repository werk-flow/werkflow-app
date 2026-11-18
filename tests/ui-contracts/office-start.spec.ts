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

  await expect(
    filled.getByRole('link', { name: '2 Wartungen überfällig: Wartungsliste öffnen' }),
  ).toHaveAttribute('href', '/service/wartung?faellig=ueberfaellig');
});

test('with nothing open the office start says so, but only while both reads are current', async ({
  page,
}) => {
  await expect(page.getByTestId('office-start-empty').getByText('Keine offenen Aufgaben.')).toBeVisible();
  for (const name of ['maintenance-unknown', 'attention-stale-empty', 'maintenance-stale-empty'])
    await expect(page.getByTestId(`office-start-${name}`).getByText('Keine offenen Aufgaben.')).toHaveCount(
      0,
    );
});

test('a failed or loading Aufgaben read keeps the überfällige Wartung and its link', async ({ page }) => {
  const failed = page.getByTestId('office-start-attention-failed');
  await expect(
    failed.getByText('Deine offenen Aufgaben konnten nicht geladen werden.', { exact: false }),
  ).toBeVisible();
  await expect(failed.getByRole('button', { name: 'Erneut laden' })).toHaveCount(1);
  await expect(
    failed.getByRole('link', { name: '2 Wartungen überfällig: Wartungsliste öffnen' }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId('office-start-attention-loading')
      .getByRole('link', { name: '2 Wartungen überfällig: Wartungsliste öffnen' }),
  ).toBeVisible();
});

test('a stale maintenance count marks only itself stale; the current task links stay usable', async ({
  page,
}) => {
  const region = page.getByTestId('office-start-maintenance-stale');
  const task = region.getByRole('link', { name: /^Auftrag A-2026-001 / });
  await expect(task).toBeVisible();
  expect(await task.evaluate((element) => element.closest('[inert]') === null)).toBe(true);
  const maintenance = region.getByRole('link', { name: '2 Wartungen überfällig: Wartungsliste öffnen' });
  expect(await maintenance.evaluate((element) => element.closest('[data-stale]') !== null)).toBe(true);
  await expect(region.getByRole('button', { name: 'Erneut laden' })).toHaveCount(1);
});
