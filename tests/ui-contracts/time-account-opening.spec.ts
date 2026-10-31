import { expect, type Page, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// The opening date correction shows its pending state in the first frame and
// keeps the row's values while the write is open. A refusal stays at the row
// with its reason; an accepted correction confirms with the banner and the
// re-rendered row shows the new date and the history line with the reason.
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'time-account-opening');
});

async function submitCorrection(page: Page) {
  const row = page.getByRole('row').filter({ hasText: 'Kevin Kontrakt' });
  await row
    .getByRole('textbox', { name: 'Korrekturgrund des Eröffnungsdatums für Kevin Kontrakt', exact: true })
    .fill('Konto ab September führen');
  const submit = row.getByRole('button', { name: 'Datum korrigieren' });
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await expectHeldWrite(page, 'correct-opening-date');
  await expect(page.getByRole('alert')).toHaveCount(0);
  return { row, submit };
}

test('a locked opening date stays at the row with its reason', async ({ page }) => {
  const { row, submit } = await submitCorrection(page);
  await answerHeldWrite(page, 'opening_date_locked');
  await expect(page.getByRole('alert')).toContainText('Ein abgeschlossener Monat hängt von diesem Datum ab.');
  await expect(
    row.getByRole('textbox', { name: 'Korrekturgrund des Eröffnungsdatums für Kevin Kontrakt', exact: true }),
  ).toHaveValue('Konto ab September führen');
  await expect(submit).toBeEnabled();
  await expect(row).toContainText('Eröffnet am 29.10.2026');
});

test('an accepted correction shows the new date and the history line', async ({ page }) => {
  const { row } = await submitCorrection(page);
  await answerHeldWrite(page, null);
  await expect(page.getByRole('alert')).toContainText(
    'Das Eröffnungsdatum ist korrigiert. Bereite betroffene Monate neu vor.',
  );
  await expect(row).toContainText('Eröffnet am 01.09.2026');
  await expect(row).toContainText('Korrigiert von 29.10.2026 auf 01.09.2026 · Konto ab September führen');
  await expect(row.getByRole('button', { name: 'Datum korrigieren' })).toBeEnabled();
});
