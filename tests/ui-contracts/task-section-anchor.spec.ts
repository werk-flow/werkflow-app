import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

test('„Alle in Aufgaben“ lands on its section although the tasks arrive after the page', async ({ page }) => {
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
  await page.goto(`${url}#aufgaben-handover`);
  await page.evaluate(() => {
    window.uiContractFixture = 'task-sections-anchor';
  });
  await page.addScriptTag({ path: bundle });

  const section = page.getByTestId('attention-work-handover-tasks');
  await expect(section.getByRole('link')).toHaveCount(3);
  await expect(section).toBeInViewport();
});
