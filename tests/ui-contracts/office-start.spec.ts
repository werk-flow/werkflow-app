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

test('with nothing open the office start says so, but not while the maintenance count is unknown', async ({
  page,
}) => {
  await expect(page.getByTestId('office-start-empty')).toHaveText(
    'Keine offenen Aufgaben. Nichts offen. Neue Aufgaben erscheinen hier sofort.',
  );
  await expect(page.getByTestId('office-start-maintenance-unknown')).toBeEmpty();
});
