import { expect, test, type Page } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// The office opens the handover of an execution-complete job for the first
// time. The review must not look like a dead end until a draft exists: it
// shows the closing checks, the Übergabevermerk and the release at once, and
// the first preview saves the selection as the draft by itself.

async function openHandover(page: Page, withoutSources: boolean): Promise<void> {
  await page.addInitScript((empty) => {
    window.uiContractHandoverWithoutSources = empty;
  }, withoutSources);
  await openContractFixture(page, 'work-handover');
}

test('a first-opened handover shows the checks, the Übergabevermerk and the release before any draft exists', async ({
  page,
}) => {
  await openHandover(page, false);
  const main = page.getByRole('main');
  await expect(main.getByText('Harte Prüfung')).toBeVisible();
  await expect(main.getByLabel('Übergabevermerk')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Freigeben und übergeben' })).toBeVisible();
  await expect(main.getByText('Wähle oben mindestens einen Inhalt aus.', { exact: false })).toBeVisible();
});

test('the first preview saves the selection as the draft, then previews that draft', async ({ page }) => {
  await openHandover(page, false);
  const main = page.getByRole('main');
  await main.getByLabel('Arbeitsbericht Thermostat').check();
  const popup = page.waitForEvent('popup');
  await main.getByRole('button', { name: 'Vorschau öffnen' }).click();
  await popup;

  await expectHeldWrite(page, 'save-draft');
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toMatchObject({
    expectedPackageVersion: 0,
    selectedSourceKeys: ['artifact:9a000000-0000-4000-8000-000000000165'],
  });
  await answerHeldWrite(page, null);

  await expect
    .poll(() => page.evaluate(() => window.uiContractWrites.calls.map((call) => call.kind)))
    .toEqual(['save-draft', 'preview']);
  expect(await page.evaluate(() => window.uiContractWrites.calls[1]?.input)).toMatchObject({
    expectedPackageVersion: 1,
  });
  await answerHeldWrite(page, null);

  await expect(main.getByRole('button', { name: 'Freigeben und übergeben' })).toBeEnabled();
});

test('a handover with nothing to hand over names the next step and links to the job', async ({ page }) => {
  await openHandover(page, true);
  const main = page.getByRole('main');
  await expect(main.getByText('Noch nichts zum Übergeben.', { exact: false })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Auftrag' })).toHaveAttribute(
    'href',
    '/auftraege/AUF-2026-163',
  );
  await expect(main.getByRole('button', { name: 'Entwurf speichern' })).toHaveCount(0);
  await expect(main.getByLabel('Übergabevermerk')).toBeVisible();
});
