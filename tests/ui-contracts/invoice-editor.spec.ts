import { expect, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// The invoice page (docs/features/commercial-and-finance.md, "Invoice drafts" and "Issuing"): an
// issued invoice shows what it says, so a catalog line whose price read answers after another
// session issued the invoice adds nothing to it.
test('a catalog line that answers after the invoice was issued adds no line to the issued invoice', async ({
  page,
}) => {
  await openContractFixture(page, 'invoice-editor');
  const names = page.getByRole('textbox', { name: 'Bezeichnung' });
  await expect(names).toHaveCount(1);

  await page.getByRole('combobox', { name: 'Leistung übernehmen' }).click();
  await expect.poll(() => page.evaluate(() => window.optionContract.requests.length)).toBe(1);
  await page.evaluate(() =>
    window.optionContract.resolve(0, [
      { value: '97000000-0000-4000-8000-000000000007', label: 'L-7 · Monteurstunde' },
    ]),
  );
  await page.getByRole('option', { name: 'L-7 · Monteurstunde' }).click();
  await expectHeldWrite(page, 'readInvoiceLineSource');

  await page.evaluate(() => window.uiContractInvoiceIssuedElsewhere?.());
  await expect(page.getByRole('combobox', { name: 'Leistung übernehmen' })).toHaveCount(0);
  await answerHeldWrite(page, null);

  await expect(names).toHaveCount(1);
  await expect(names.first()).toHaveValue('Heizkörper tauschen');
  await expect(page.getByText('Monteurstunde')).toHaveCount(0);
});

// Einstellungen → Rechnungen ("Invoice settings"): a year-based series restarts at 1 each Berlin
// year. A form read before New Year's midnight shows the new year's read after a refresh, so
// last year's next number never saves into the new year.
test('a settings read in a new Berlin year replaces the text read in the old one', async ({ page }) => {
  await openContractFixture(page, 'invoice-settings');
  const nextNumber = page.getByRole('textbox', { name: 'Nächste Nummer' });
  await expect(nextNumber).toHaveValue('57');
  await nextNumber.fill('58');

  await page.evaluate(() => window.uiContractInvoiceSettingsNewYear?.());
  await expect(page.getByText('RE-2038-001')).toBeVisible();
  await expect(nextNumber).toHaveValue('1');

  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByText('Es gibt keine Änderungen zu speichern.')).toBeVisible();
  expect(await page.evaluate(() => window.uiContractWrites.calls.length)).toBe(0);
});
