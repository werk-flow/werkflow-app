import { expect, test, type Page } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// The organization export acknowledges each step in its first frame: the
// start button shows its pending state while the start is open, and the part
// being built shows its spinner while its build is open. A refused part keeps
// its reason on its row, the next part still builds, and the banner names the
// failed part (werk-flow/werkflow-planning#287).
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'organization-export');
});

/** Waits until the surface has issued these writes, in order, and holds the last open. */
async function expectHeldWrites(page: Page, writes: readonly (readonly [string, unknown])[]): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        calls: window.uiContractWrites.calls.map((call) => [call.kind, call.input]),
        open: window.uiContractWrites.answer !== null,
      })),
    )
    .toEqual({ calls: writes, open: true });
}

test('a refused part keeps its reason while the next part builds and the banner names it', async ({
  page,
}) => {
  const start = page.getByRole('button', { name: /Export starten/ });
  await start.click();
  await expect(page.getByRole('status', { name: 'Export wird erstellt', exact: true })).toBeVisible();
  await expect(start).toBeDisabled();
  await expectHeldWrite(page, 'start-export');
  await answerHeldWrite(page, null);

  const rows = page.getByTestId('organization-export').getByRole('listitem');
  const dataRow = rows.filter({ hasText: 'Teil 1: Daten und Dokumentenverzeichnis' });
  const fileRow = rows.filter({ hasText: 'Teil 2: 2 Dateien' });
  await expectHeldWrites(page, [
    ['start-export', null],
    ['build-part', 'contract-part-data'],
  ]);
  await expect(dataRow.getByRole('status', { name: 'Teil 1 wird erstellt', exact: true })).toBeVisible();
  await expect(dataRow).toContainText('Wird erstellt');
  await expect(fileRow).toContainText('Ausstehend');
  await answerHeldWrite(page, 'export_part_failed');

  await expectHeldWrites(page, [
    ['start-export', null],
    ['build-part', 'contract-part-data'],
    ['build-part', 'contract-part-files'],
  ]);
  await expect(dataRow.getByRole('status')).toHaveCount(0);
  await expect(dataRow).toContainText('Der Teil konnte nicht erstellt werden. Versuche es erneut.');
  await expect(fileRow.getByRole('status', { name: 'Teil 2 wird erstellt', exact: true })).toBeVisible();
  await answerHeldWrite(page, null);

  await expect(
    page.getByRole('alert').filter({ hasText: 'Ein Teil konnte nicht erstellt werden.' }),
  ).toBeVisible();
  await expect(start).toBeEnabled();
});

test('a refused start keeps the reason at the button', async ({ page }) => {
  const start = page.getByRole('button', { name: /Export starten/ });
  await start.click();
  await expectHeldWrite(page, 'start-export');
  await answerHeldWrite(page, 'export_plan_stale');
  await expect(
    page.getByRole('alert').filter({
      hasText: 'Während des Starts haben sich Dokumente geändert. Starte den Export noch einmal.',
    }),
  ).toBeVisible();
  await expect(start).toBeEnabled();
});
