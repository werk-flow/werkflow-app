import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

// The start page stores the field worker's day for use without signal. When
// its code cannot load, the worker learns it while the signal lasts, with a
// reload as the way out, and the page goes on without an uncaught error.

test('a refresh code that fails to load warns the worker and offers a reload, without throwing', async ({
  page,
}) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));
  await page.route('http://localhost/ui-contracts**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://localhost/ui-contracts');
  await page.evaluate(() => {
    window.uiContractFixture = 'today-refresh';
  });
  await page.addScriptTag({ path: bundle });

  await expect(page.getByRole('alert')).toContainText(
    'Deine Einsätze von heute sind auf diesem Gerät nicht für offline gespeichert.',
  );
  await expect(page.getByRole('alert').getByRole('button', { name: 'Für offline neu laden' })).toBeVisible();
  expect(uncaught).toEqual([]);
});
