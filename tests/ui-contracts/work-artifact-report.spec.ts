import { expect, test, type Page } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// An Arbeitsbericht marks the fields its submit needs. A submit with an empty
// Beginn keeps the button enabled, sends nothing, names the missing Beginn and
// Ende at their fields and focuses the first. A worker who recorded time on
// the job today finds Beginn and Ende prefilled from it, and the submitted
// report shows them (werk-flow/werkflow-planning#67).

async function openNewReport(page: Page) {
  await openContractFixture(page, 'work-artifact-report');
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  await dialog.getByRole('textbox', { name: 'Titel', exact: true }).fill('Wartung Heizung');
  await dialog.getByRole('textbox', { name: 'Ausgeführte Arbeiten', exact: true }).fill('Brenner gereinigt');
  return dialog;
}

test('a submit with an empty Beginn marks Beginn and Ende and focuses Beginn', async ({ page }) => {
  const dialog = await openNewReport(page);
  const start = dialog.getByRole('group', { name: 'Datum des Beginns', exact: true });
  const end = dialog.getByRole('group', { name: 'Datum des Endes', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Titel', exact: true })).toHaveAttribute(
    'aria-required',
    'true',
  );
  await expect(start).toHaveAccessibleDescription('Pflichtfeld');
  await expect(end).toHaveAccessibleDescription('Pflichtfeld');

  const submit = page.getByRole('button', { name: 'Zur Prüfung einreichen', exact: true });
  await submit.click();

  await expect(start).toBeFocused();
  await expect(start).toHaveAccessibleDescription(/Bitte gib den Beginn an\./);
  await expect(end).toHaveAccessibleDescription(/Bitte gib das Ende an\./);
  await expect(
    dialog.getByRole('textbox', { name: 'Ausgeführte Arbeiten', exact: true }),
  ).not.toHaveAttribute('aria-invalid', 'true');
  await expect(submit).toBeEnabled();
  expect(await page.evaluate(() => window.uiContractWorkArtifacts.saves)).toEqual([]);
});

test("Beginn and Ende come from today's recorded time and show on the submitted report", async ({ page }) => {
  await page.addInitScript(() => {
    window.uiContractRecordedVisit = {
      startedAt: '2026-11-02T06:00:00.000Z',
      endedAt: '2026-11-02T11:15:00.000Z',
    };
  });
  await openNewReport(page);
  await page.getByRole('button', { name: 'Zur Prüfung einreichen', exact: true }).click();

  // The saved report's dialog carries its title.
  const report = page.getByRole('dialog', { name: 'Wartung Heizung', exact: true });
  await expect(report.getByText('Beginn', { exact: true })).toBeVisible();
  await expect(report.getByText(/02\.11\.2026.*07:00/)).toBeVisible();
  await expect(report.getByText(/02\.11\.2026.*12:15/)).toBeVisible();
  await expect(report.getByRole('button', { name: 'Verlauf (1 Version, 1 Aktion)' })).toBeVisible();
  const saves = await page.evaluate(() => window.uiContractWorkArtifacts.saves);
  expect(saves.map((save) => [save.submit, save.content.visitStartedAt, save.content.visitEndedAt])).toEqual([
    [true, '2026-11-02T06:00:00.000Z', '2026-11-02T11:15:00.000Z'],
  ]);
});
