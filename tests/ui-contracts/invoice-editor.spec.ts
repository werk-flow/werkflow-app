import { expect, test } from '@playwright/test';
import { textInDom, visibleText } from '../golden/support/steps/shared';
import { answerHeldWrite, expectHeldWrite, openContractFixture, openHydrationFixture } from './open-fixture';

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
  // An unanswered first attempt may have reached the customer, though the retry failed.
  await expect(
    visibleText(page, 'Ein früherer Versuch blieb ohne klare Antwort. Letzter Versuch: Die E-Mail'),
  ).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
});

test('an issued invoice offers sending, a manual record and the retry of a failed send', async ({ page }) => {
  await openContractFixture(page, 'invoice-deliveries-issued');
  await expect(visibleText(page, 'E-Mail an erika.musterfrau@lindenhof.example')).toBeVisible();
  for (const name of ['Per E-Mail senden', 'Als manuell versendet markieren', 'Erneut senden']) {
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
});

// An unanswered first attempt may have reached the customer, though the retry failed: the row
// keeps saying so, so the office asks before it sends a duplicate.
test('an issued invoice keeps a send unclear when an unanswered attempt was followed by a failed retry', async ({
  page,
}) => {
  await openContractFixture(page, 'invoice-deliveries-issued');
  await expect(
    visibleText(
      page,
      'Ob die E-Mail rausging, ist unklar: Ein früherer Versuch blieb ohne klare Antwort. Letzter Versuch: Die E-Mail ist nicht rausgegangen.',
    ),
  ).toBeVisible();
});

// A retry of such a send fails for another reason: its outcome replaces the stored one at once and
// keeps the send unclear, and once the refreshed row shows the new attempt, the row alone says it.
test('a failed retry of a send that may have gone out stays unclear and gives way to the refreshed row', async ({
  page,
}) => {
  await openContractFixture(page, 'invoice-deliveries-retry');
  const unclear = 'Ob die E-Mail rausging, ist unklar';
  const refused = 'Letzter Versuch: Der Mailanbieter hat die E-Mail abgelehnt. Frag beim Kunden nach';
  await expect(textInDom(page, 'Letzter Versuch: Die E-Mail ist nicht rausgegangen.')).toHaveCount(1);
  await page.getByRole('button', { name: 'Erneut senden' }).click();
  await expectHeldWrite(page, 'retryInvoiceDelivery');
  await answerHeldWrite(page, null);
  await expect(visibleText(page, refused)).toBeVisible();
  await expect(textInDom(page, 'Die E-Mail ist nicht rausgegangen.')).toHaveCount(0);
  await expect(textInDom(page, unclear)).toHaveCount(1);
  await page.evaluate(() => window.uiContractDeliveryRefresh?.());
  await expect(visibleText(page, '3 Versuche')).toBeVisible();
  await expect(textInDom(page, refused)).toHaveCount(1);
  await expect(textInDom(page, unclear)).toHaveCount(1);
});

// A retry past its window is refused. While the send is unclear, the refusal asks the office to
// check with the customer before a new email, and it names the 23 hours the window lasts.
test('a retry refused past its window asks about an unclear send before a new email', async ({ page }) => {
  await openContractFixture(page, 'invoice-deliveries-retry');
  await page.getByRole('button', { name: 'Erneut senden' }).click();
  await expectHeldWrite(page, 'retryInvoiceDelivery');
  await answerHeldWrite(page, 'delivery_retry_expired');
  await expect(
    visibleText(page, 'Der Versand ist älter als 23 Stunden und lässt sich nicht mehr wiederholen.'),
  ).toBeVisible();
  await expect(visibleText(page, 'Frag beim Kunden nach, ob sie ankam')).toBeVisible();
  await expect(textInDom(page, 'Sende die Rechnung bei Bedarf neu per E-Mail.')).toHaveCount(0);
});

// A page that predates another session's unanswered attempt shows a known failure. The server's
// answer to its retry says the outcome is unknown, and the message keeps that, not the row's view.
test('a retry from a page older than an unanswered attempt keeps the send unclear', async ({ page }) => {
  await openContractFixture(page, 'invoice-deliveries-stale-retry');
  const unclear = 'Ob die E-Mail rausging, ist unklar';
  await expect(textInDom(page, unclear)).toHaveCount(0);
  await page.getByRole('button', { name: 'Erneut senden' }).click();
  await expectHeldWrite(page, 'retryInvoiceDelivery');
  await answerHeldWrite(page, null);
  await expect(visibleText(page, `${unclear}: Ein früherer Versuch blieb ohne klare Antwort.`)).toBeVisible();
});

// The server renders „Versand“ by its clock, the browser hydrates it by its own. An attempt that
// turns unanswered in between must not make the two renders differ.
test("an issued invoice's send row renders without a clock on the server and turns unanswered after hydration", async ({
  page,
}) => {
  await openHydrationFixture(page, 'invoice-deliveries-hydration');
  await expect(visibleText(page, 'Der Mailanbieter hat nicht geantwortet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Erneut senden' })).toBeVisible();
  expect(await page.evaluate(() => window.uiContractHydrationErrors)).toEqual([]);
});
