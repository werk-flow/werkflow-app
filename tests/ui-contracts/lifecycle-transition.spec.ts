import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';
import { WORK_EXECUTION_LABELS, workTransitionActionLabel } from '@/lib/work-lifecycle/types';

// The status change closes its dialog with the click and shows the new state
// at once. A refusal restores the previous state and names the rule in the
// banner, because no dialog is left to carry it.
test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  const fixtureUrl = 'http://localhost/ui-contracts';
  await page.route(fixtureUrl, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto(fixtureUrl);
  await page.evaluate(() => {
    window.uiContractFixture = 'lifecycle';
  });
  await page.addScriptTag({ path: bundle });
  await expect(page.getByRole('heading', { name: 'Komponentenverträge' })).toBeVisible();
});

test('a refused status change closes the dialog, restores the previous state and reports the rule', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.uiContractLifecycle.rejectTransition = true;
  });
  const section = page.getByRole('region', {
    name: 'Arbeitsstand und Auftragsdetails',
    includeHidden: true,
  });
  const start = section.getByRole('button', {
    name: workTransitionActionLabel('not_started', 'in_progress'),
    exact: true,
  });
  await start.click();
  const dialog = page.getByRole('dialog', {
    name: workTransitionActionLabel('not_started', 'in_progress'),
    exact: true,
  });
  await dialog.getByRole('button', { name: 'Änderung speichern' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('keine Berechtigung');
  await expect(start).toBeEnabled();
  await expect(
    section.getByRole('button', {
      name: workTransitionActionLabel('in_progress', 'execution_complete'),
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(section.getByRole('status', { name: 'Auftragsstatus' })).toHaveText(
    WORK_EXECUTION_LABELS.not_started,
  );
  expect(await page.evaluate(() => window.uiContractServices.navigation)).toEqual([]);
  expect(await page.evaluate(() => window.uiContractLifecycle.transitions)).toBe(0);
});

test('route metadata of a cancelled legacy job shows the work state, not the legacy status', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.uiContractLifecycle.snapshot = {
      ...window.uiContractLifecycle.snapshot,
      executionState: 'cancelled',
    };
    window.dispatchEvent(new Event('ui-contract:route-refresh'));
  });
  const section = page.getByRole('region', { name: 'Arbeitsstand und Auftragsdetails', includeHidden: true });
  await expect(section.getByRole('status', { name: 'Auftragsstatus' })).toHaveText(
    WORK_EXECUTION_LABELS.cancelled,
  );
});
