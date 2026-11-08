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
    window.uiContractFixture = 'task-sections';
  });
  await page.addScriptTag({ path: bundle });
});

test('the handover backlog shows its three oldest rows and opens the rest on „Alle anzeigen“', async ({
  page,
}) => {
  const section = page.getByTestId('attention-work-handover-tasks');
  const rows = section.getByRole('link');
  // Oldest first: the three preview rows, then the rest behind the toggle.
  await expect(rows).toContainText(['A-2026-001', 'A-2026-002', 'A-2026-003']);
  await expect(rows).toHaveCount(3);
  await expect(section.getByText('Die 3 ältesten von 5')).toBeVisible();

  const toggle = section.getByRole('button', { name: 'Alle anzeigen' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(rows).toContainText(['A-2026-001', 'A-2026-002', 'A-2026-003', 'A-2026-004', 'A-2026-005']);
  await expect(rows).toHaveCount(5);
  const collapse = section.getByRole('button', { name: 'Weniger anzeigen' });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');

  await collapse.click();
  await expect(rows).toHaveCount(3);
  await expect(section.getByRole('button', { name: 'Alle anzeigen' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});
