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
    window.uiContractFixture = 'owner-start';
  });
  await page.addScriptTag({ path: bundle });
  const css = process.env.WERKFLOW_UI_CONTRACT_CSS;
  if (!css) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.addStyleTag({ path: css });
});

test('the owner start shows only the exceptions, each with its count, first items, who resolves it and where', async ({
  page,
}) => {
  const filled = page.getByTestId('owner-start-filled');
  await expect(filled.getByRole('heading', { name: 'Braucht deine Entscheidung' })).toBeVisible();

  const callbacks = filled.getByTestId('owner-start-attention-callback-tasks');
  await expect(callbacks.getByRole('heading', { name: /^Rückruf überfällig\s*\(1\)$/ })).toBeVisible();
  await expect(callbacks.getByText('Seit mehr als 2 Werktagen überfällig')).toBeVisible();
  await expect(callbacks.getByRole('link', { name: 'Rückruf zur Anfrage AN-2026-101 öffnen' })).toContainText(
    'Zuständig: Erika Musterfrau',
  );
  await expect(callbacks.getByText('AN-2026-102', { exact: false })).toHaveCount(0);
  await expect(
    callbacks.getByRole('link', { name: 'Rückruf überfällig: in Aufgaben öffnen' }),
  ).toHaveAttribute('href', '/aufgaben#aufgaben-callback');

  const handovers = filled.getByTestId('owner-start-attention-work-handover-tasks');
  await expect(handovers.getByRole('heading', { name: /^Übergaben prüfen\s*\(4\)$/ })).toBeVisible();
  await expect(handovers.getByRole('link', { name: /^Übergabe für / })).toHaveCount(3);

  const blockers = filled.getByTestId('owner-start-attention-parking-review-tasks');
  await expect(blockers.getByRole('link', { name: /^Wiedervorlage für A-2026-401/ })).toContainText(
    'Zuständig: Erika Musterfrau',
  );
  await expect(
    filled.getByTestId('owner-start-attention-dispatch-challenge-tasks').getByRole('heading'),
  ).toHaveText(/Offene Rückfragen\s*\(1\)/);

  const maintenance = filled.getByTestId('owner-start-attention-due-maintenance-tasks');
  await expect(maintenance.getByRole('heading', { name: /^Fällige Wartungen\s*\(1\)$/ })).toBeVisible();
  await expect(maintenance.getByText('Überfällig und noch ohne Wartungsbesuch')).toBeVisible();
  await expect(
    maintenance.getByRole('link', {
      name: 'Wartung Gasbrennwertkessel in Heizzentrale Lindenhof öffnen, fällig seit 12.11.2026',
    }),
  ).toHaveAttribute('href', '/service/wartung?q=WPL-2026-0007');
  // Due next week, it is the office's task, not an exception.
  await expect(maintenance.getByText('fällig am', { exact: false })).toHaveCount(0);
});

test('approvals show only how many wait for Admin, never a name or a date', async ({ page }) => {
  const filled = page.getByTestId('owner-start-filled');
  await expect(
    filled.getByRole('link', { name: '2 Zeitkorrekturen warten auf deine Freigabe: in Aufgaben öffnen' }),
  ).toHaveAttribute('href', '/aufgaben#aufgaben-time');
  await expect(
    filled.getByRole('link', { name: '1 Urlaubsantrag wartet auf deine Freigabe: in Aufgaben öffnen' }),
  ).toHaveAttribute('href', '/aufgaben#aufgaben-vacation');
  await expect(filled.getByText('Max Mustermann', { exact: false })).toHaveCount(1);
  // The one name is the dispatch question's field worker; no approval row names a person or a day.
  await expect(
    filled.getByTestId('owner-start-attention-time-tasks').getByText('Max Mustermann'),
  ).toHaveCount(0);
  await expect(filled.getByText('21.12.2026', { exact: false })).toHaveCount(0);
});

test('with no exception the owner start says so, but only while its read is current', async ({ page }) => {
  await expect(
    page.getByTestId('owner-start-empty').getByText('Keine offenen Entscheidungen.'),
  ).toBeVisible();
  await expect(
    page.getByTestId('owner-start-attention-stale-empty').getByText('Keine offenen Entscheidungen.'),
  ).toHaveCount(0);
});

test('a failed or loading read shows its own state with a retry', async ({ page }) => {
  const failed = page.getByTestId('owner-start-attention-failed');
  await expect(
    failed.getByText('Was deine Entscheidung braucht, konnte nicht geladen werden.', { exact: false }),
  ).toBeVisible();
  await expect(failed.getByRole('button', { name: 'Erneut laden' })).toHaveCount(1);
  const loading = page.getByTestId('owner-start-attention-loading');
  await expect(loading.locator('[data-slot="skeleton"]')).not.toHaveCount(0);
  await expect(loading.getByText('Keine offenen Entscheidungen.')).toHaveCount(0);
});
