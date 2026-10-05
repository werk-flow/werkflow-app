import { expect, test, type Page } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// Linking a service-case evidence version lists the chosen version in the
// first frame while the dialog stays pending. A refusal removes the version
// and shows the reason in the dialog with the choice kept; an acceptance
// closes the dialog, confirms with a banner and keeps the version after the
// live read.
async function submitReportLink(page: Page): Promise<void> {
  await openContractFixture(page, 'service-evidence-link');
  const section = page.getByTestId('service-case-evidence');
  await section.getByRole('button', { name: 'Verknüpfen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis verknüpfen', exact: true });
  await dialog.getByRole('combobox', { name: 'Nachweisversion' }).click();
  await page.getByRole('option', { name: /^Arbeitsbericht Kesseltausch/ }).click();
  await dialog.getByRole('button', { name: 'Verknüpfen', exact: true }).click();
}

test('a refused evidence link removes the version and shows the reason in the dialog', async ({ page }) => {
  await submitReportLink(page);
  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis verknüpfen', exact: true });
  const rows = page.getByTestId('service-case-evidence-row');
  await expect(dialog.getByRole('button', { name: 'Verknüpfen', exact: true })).toBeDisabled();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Arbeitsbericht Kesseltausch');
  await expect(rows.getByRole('status', { name: 'Wird verknüpft', includeHidden: true })).toHaveCount(1);
  await expectHeldWrite(page, 'link-service-case-evidence');
  await expect(page.getByRole('alert')).toHaveCount(0);

  await answerHeldWrite(page, 'service_case_stale_version');
  await expect(rows).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Der Servicefall wurde inzwischen geändert. Prüfe den aktuellen Stand und versuche es erneut.',
  );
  await expect(dialog.getByRole('combobox', { name: 'Nachweisversion' })).toContainText(
    'Arbeitsbericht Kesseltausch',
  );
  await expect(dialog.getByRole('button', { name: 'Verknüpfen', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.uiContractServiceEvidence.evidence)).toEqual([]);
});

test('an accepted evidence link closes the dialog and keeps the version after the live read', async ({
  page,
}) => {
  await submitReportLink(page);
  const rows = page.getByTestId('service-case-evidence-row');
  await expect(rows.getByRole('status', { name: 'Wird verknüpft', includeHidden: true })).toHaveCount(1);
  await expectHeldWrite(page, 'link-service-case-evidence');

  await answerHeldWrite(page, null);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Arbeitsnachweis wurde verknüpft.' })).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Arbeitsbericht Kesseltausch');
  await expect(rows.getByRole('status', { name: 'Wird verknüpft' })).toHaveCount(0);
  expect(await page.evaluate(() => window.uiContractServiceEvidence.reads)).toBe(1);
});
