import { expect, test } from '@playwright/test';
import { textInDom, visibleText } from '../golden/support/steps/shared';
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
  await expect(names).toHaveValue('Heizkörper tauschen');
  await expect(textInDom(page, 'Monteurstunde')).toHaveCount(0);
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
  await expect(visibleText(page, 'RE-2038-001')).toBeVisible();
  await expect(nextNumber).toHaveValue('1');

  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(visibleText(page, 'Es gibt keine Änderungen zu speichern.')).toBeVisible();
  expect(await page.evaluate(() => window.uiContractWrites.calls.length)).toBe(0);
});

// „Versand“ on the invoice page ("Sending invoices"): a cancelled invoice keeps the history of how
// it went out, read-only, since the database refuses every further send of it.
test('a cancelled invoice lists its earlier sends and offers no send, retry or manual record', async ({
  page,
}) => {
  await openContractFixture(page, 'invoice-deliveries-cancelled');
  await expect(page.getByRole('heading', { name: 'Versand' })).toBeVisible();
  await expect(visibleText(page, 'E-Mail an erika.musterfrau@lindenhof.example')).toBeVisible();
  await expect(visibleText(page, 'E-Mail an buchhaltung@lindenhof.example')).toBeVisible();
  await expect(visibleText(page, 'Die E-Mail ist nicht rausgegangen.')).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
});

test('an issued invoice offers sending, a manual record and the retry of a failed send', async ({ page }) => {
  await openContractFixture(page, 'invoice-deliveries-issued');
  await expect(visibleText(page, 'E-Mail an erika.musterfrau@lindenhof.example')).toBeVisible();
  for (const name of ['Per E-Mail senden', 'Als manuell versendet markieren', 'Erneut senden']) {
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
});
