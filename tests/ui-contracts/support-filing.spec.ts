import { expect, test, type Locator, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

// Support files a report for a member who phoned (docs/features/problem-reports.md,
// "Filed for a caller"): after a completed filing the page that Next.js keeps
// hidden comes back as a fresh form that files a new report, also when the
// filing completed while the page was out of view, and a member
// chosen under one organization is never filed under another one the address
// changed to.

const ORGANIZATION_A = '33500000-0000-4000-8000-0000000000a1';
const ORGANIZATION_B = '33500000-0000-4000-8000-0000000000b1';
const DESCRIPTION = 'Am Telefon: Die Zeiterfassung startet nicht.';
/** support-filing-boundaries.tsx hides and shows the page on this event. */
const PAGE_VISIBILITY_EVENT = 'ui-contract:support-filing-visibility';

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
    window.uiContractFixture = 'support-filing';
  });
  await page.addScriptTag({ path: bundle });
  await expect(page.getByRole('heading', { name: 'Komponentenverträge' })).toBeVisible();
});

const memberField = (page: Page): Locator =>
  page.getByRole('combobox', { name: 'Wer hat angerufen?', exact: true });
const descriptionField = (page: Page): Locator =>
  page.getByRole('textbox', { name: 'Was hat die Person gemeldet?', exact: true });
const submitButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Meldung aufnehmen', exact: true });

/** The address names the organization, as after a choice or a step through the history. */
async function showOrganization(
  page: Page,
  organizationId: string,
  historyNavigation = false,
): Promise<void> {
  await page.evaluate(
    ([id, history]) => window.listNavigationContract.commit(`/ui-contracts?organisation=${id}`, history),
    [organizationId, historyNavigation] as const,
  );
}

async function chooseMember(page: Page, name: string): Promise<void> {
  await memberField(page).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(memberField(page)).toHaveText(name);
}

/** Answers the held filing: `null` saves it, a code refuses it. */
async function answerFiling(page: Page, refusal: string | null): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.uiContractWrites.answer !== null)).toBe(true);
  await page.evaluate((code) => window.uiContractWrites.answer?.(code), refusal);
}

async function setPageHidden(page: Page, hidden: boolean, event: string): Promise<void> {
  await page.evaluate(
    ([isHidden, name]) => {
      window.uiContractSupportFilingHidden = isHidden;
      window.dispatchEvent(new Event(name));
    },
    [hidden, event] as const,
  );
}

test('after a completed filing the page comes back as a fresh form that files a new report', async ({
  page,
}) => {
  await showOrganization(page, ORGANIZATION_A);
  await chooseMember(page, 'Rita Melder');
  await descriptionField(page).fill(DESCRIPTION);
  await submitButton(page).click();
  await answerFiling(page, null);
  await expect
    .poll(() => page.evaluate(() => window.listNavigationContract.requests))
    .toEqual([expect.stringMatching(/^\/support\/meldungen\//u)]);

  // The router leaves for the report's page and keeps this one hidden; support comes back.
  await setPageHidden(page, true, PAGE_VISIBILITY_EVENT);
  await expect(submitButton(page)).toBeHidden();
  await setPageHidden(page, false, PAGE_VISIBILITY_EVENT);

  await expect(submitButton(page)).toBeEnabled();
  await expect(descriptionField(page)).toHaveValue('');
  await expect(descriptionField(page)).toBeEnabled();
  await expect(memberField(page)).toHaveText('Person auswählen');

  await chooseMember(page, 'Ben Beispiel');
  await descriptionField(page).fill(`${DESCRIPTION} Zweiter Anruf.`);
  await submitButton(page).click();
  await answerFiling(page, null);
  await expect.poll(() => page.evaluate(() => window.uiContractSupportFilings.length)).toBe(2);
  const [first, second] = await page.evaluate(() => window.uiContractSupportFilings);
  expect(second?.reportId).not.toBe(first?.reportId);
  expect(second?.reporterId).toBe('33500000-0000-4000-8000-000000000102');
});

test('a filing that completes while the page is out of view leaves a fresh form for the return', async ({
  page,
}) => {
  await showOrganization(page, ORGANIZATION_A);
  await chooseMember(page, 'Rita Melder');
  await descriptionField(page).fill(DESCRIPTION);
  await submitButton(page).click();
  await expect(submitButton(page)).toBeDisabled();
  // Support leaves while the save runs; it completes on the hidden page.
  await setPageHidden(page, true, PAGE_VISIBILITY_EVENT);
  await expect(submitButton(page)).toBeHidden();
  await answerFiling(page, null);
  await expect.poll(() => page.evaluate(() => window.uiContractSupportFilings.length)).toBe(1);
  await setPageHidden(page, false, PAGE_VISIBILITY_EVENT);

  await expect(submitButton(page)).toBeEnabled();
  await expect(descriptionField(page)).toHaveValue('');
  await expect(memberField(page)).toHaveText('Person auswählen');
});

test('a member chosen under one organization is not filed under the next one the address names', async ({
  page,
}) => {
  await showOrganization(page, ORGANIZATION_A);
  await chooseMember(page, 'Rita Melder');
  // Back in the browser's history: the address names the second organization, where Rita is a member too.
  await showOrganization(page, ORGANIZATION_B, true);

  await expect(memberField(page)).toHaveText('Person auswählen');
  await descriptionField(page).fill(DESCRIPTION);
  await submitButton(page).click();
  await expect(page.getByRole('main').getByText('Wähle aus, wer angerufen hat.')).toBeVisible();
  await expect(memberField(page)).toBeFocused();
  expect(await page.evaluate(() => window.uiContractSupportFilings)).toEqual([]);
});
