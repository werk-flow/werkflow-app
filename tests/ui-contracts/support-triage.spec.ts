import { expect, test, type Locator, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

// Support's triage of a report (docs/features/problem-reports.md, "Triage"
// and "Original"): a save shows its pending state in the first frame, sends
// only the changed fields and confirms only after the server accepted it; a
// refusal and a failed request keep what was typed and say what happened;
// unsaved fields survive the refresh that „Original öffnen“ starts; a
// failed opening shows nothing of the original; and a report shows its
// scrubbed context, or says in words that no text is left.

const ANSWER = 'Behoben, ab morgen live.';
const ORIGINAL = 'Bei Familie Beispiel speichert der Auftrag nicht.';
const REQUEST_FAILED = 'Das hat gerade nicht geklappt. Prüfe deine Verbindung und versuche es erneut.';
const SAVED = 'Gespeichert. Die Person sieht es in „Meine Meldungen“.';

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
    window.uiContractFixture = 'support-triage';
  });
  await page.addScriptTag({ path: bundle });
  await expect(page.getByRole('heading', { name: 'Komponentenverträge' })).toBeVisible();
});

const answerField = (page: Page): Locator =>
  page.getByRole('textbox', { name: 'Antwort an die Person', exact: true });
const saveButton = (page: Page): Locator => page.getByRole('button', { name: 'Speichern', exact: true });
const openOriginalButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Original öffnen', exact: true });
/** The banner that confirms a save; a field's own error is an alert too, so the text decides. */
const savedBanner = (page: Page): Locator => page.getByRole('alert').filter({ hasText: SAVED });

async function answerOpenSave(page: Page, refusal: string | null): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.uiContractWrites.answer !== null)).toBe(true);
  await page.evaluate((code) => window.uiContractWrites.answer?.(code), refusal);
}

test('a save shows its pending state in the first frame, sends only the changed field and confirms after the answer', async ({
  page,
}) => {
  await answerField(page).fill(ANSWER);
  await saveButton(page).click();
  await expect(saveButton(page)).toBeDisabled();
  await expect(answerField(page)).toBeDisabled();
  await expect(savedBanner(page)).toHaveCount(0);

  await answerOpenSave(page, null);
  await expect(savedBanner(page)).toBeVisible();
  await expect(answerField(page)).toBeEnabled();
  await expect(answerField(page)).toHaveValue(ANSWER);
  expect(await page.evaluate(() => window.uiContractWrites.calls)).toEqual([
    {
      kind: 'triage',
      input: { reportId: '33500000-0000-4000-8000-000000000020', changes: { response: ANSWER } },
    },
  ]);
});

test('a refused save keeps what was typed and names the reason', async ({ page }) => {
  await answerField(page).fill(ANSWER);
  await saveButton(page).click();
  await answerOpenSave(page, 'report_not_found');
  await expect(
    page.getByRole('main').getByText('Diese Meldung gibt es nicht mehr. Lade die Liste neu.'),
  ).toBeVisible();
  await expect(answerField(page)).toHaveValue(ANSWER);
  await expect(saveButton(page)).toBeEnabled();
  await expect(savedBanner(page)).toHaveCount(0);
});

test('a save whose request fails keeps what was typed and says so', async ({ page }) => {
  await answerField(page).fill(ANSWER);
  await page.evaluate(() => {
    window.uiContractSupport.failNextRequest = true;
  });
  await saveButton(page).click();
  await expect(page.getByRole('main').getByText(REQUEST_FAILED)).toBeVisible();
  await expect(answerField(page)).toHaveValue(ANSWER);
  await expect(saveButton(page)).toBeEnabled();
  await expect(savedBanner(page)).toHaveCount(0);
});

test('an unsaved answer survives „Original öffnen“ and the refresh it starts', async ({ page }) => {
  await answerField(page).fill(ANSWER);
  await openOriginalButton(page).click();
  await expect(page.getByRole('main').getByText(ORIGINAL)).toBeVisible();
  // The refresh brought the report with the new history entry.
  await expect(page.getByRole('main').getByText('Original geöffnet')).toBeVisible();
  await expect(answerField(page)).toHaveValue(ANSWER);
});

test('an opening whose request fails says so and shows nothing of the original', async ({ page }) => {
  await page.evaluate(() => {
    window.uiContractSupport.failNextRequest = true;
  });
  await openOriginalButton(page).click();
  await expect(page.getByRole('main').getByText(REQUEST_FAILED)).toBeVisible();
  await expect(page.getByRole('main').getByText(ORIGINAL)).toHaveCount(0);
  await expect(openOriginalButton(page)).toBeEnabled();
});

test("a field set back to its loaded value takes a colleague's later change, and a save of another field leaves it", async ({
  page,
}) => {
  const status = page.getByRole('combobox', { name: 'Status', exact: true });
  for (const label of ['Erledigt', 'Eingegangen']) {
    await status.click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect(status).toHaveText(label);
  }
  // A colleague closes the report; the page reads it again.
  await page.evaluate(() => {
    const state = window.uiContractSupport;
    state.report = { ...state.report, status: 'erledigt' };
    window.dispatchEvent(new Event('ui-contract:route-refresh'));
  });
  await expect(status).toHaveText('Erledigt');

  await answerField(page).fill(ANSWER);
  await saveButton(page).click();
  await answerOpenSave(page, null);
  await expect(savedBanner(page)).toBeVisible();
  expect(await page.evaluate(() => window.uiContractWrites.calls.map((call) => call.input))).toEqual([
    { reportId: '33500000-0000-4000-8000-000000000020', changes: { response: ANSWER } },
  ]);
});

test('the page shows the scrubbed context, and a report whose original went before its scrub says that no text is left', async ({
  page,
}) => {
  const main = page.getByRole('main');
  await expect(main.getByText('Bei [Kunde] speichert der Auftrag nicht.')).toBeVisible();
  await expect(main.getByText('bei der Bereinigung entfernt', { exact: true })).toBeVisible();
  await expect(main.getByText('4182 auf /auftraege/[jobNumber]')).toBeVisible();

  await page.evaluate(() => {
    const state = window.uiContractSupport;
    state.report = {
      ...state.report,
      scrubState: 'nicht_bereinigbar',
      scrubbedDescription: null,
      scrubbedContext: null,
      originalsDeleted: true,
    };
    window.dispatchEvent(new Event('ui-contract:route-refresh'));
  });
  await expect(
    main.getByText(
      'Zu dieser Meldung gibt es keinen Text mehr: Er ließ sich nicht rechtzeitig bereinigen, und das Original ist nach seiner Frist gelöscht.',
    ),
  ).toBeVisible();
  await expect(
    main.getByText('Das Original ist nach seiner Frist gelöscht. Es bleibt der Verlauf.'),
  ).toBeVisible();
  await expect(main.getByText('App-Version', { exact: true })).toHaveCount(0);
  await expect(openOriginalButton(page)).toHaveCount(0);
});
