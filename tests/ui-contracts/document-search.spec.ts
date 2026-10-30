import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.route('http://localhost/ui-contracts**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://localhost/ui-contracts?view=all&q=alt&link=employees');
  await page.evaluate(() => {
    window.uiContractFixture = 'document-search';
  });
  await page.addScriptTag({ path: bundle });
  await expect(searchField(page)).toHaveValue('alt');
});

function searchField(page: Page) {
  return page.getByRole('textbox', { name: 'Dokumente suchen' });
}

async function chooseAllLinks(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Filter/ }).click();
  await page.getByRole('combobox', { name: 'Verknüpfung filtern' }).click();
  await page.getByRole('option', { name: 'Alle Verknüpfungen', exact: true }).click();
}

async function commitRequest(page: Page, index: number): Promise<void> {
  await page.evaluate((requestIndex) => {
    const request = window.listNavigationContract.requests[requestIndex];
    if (!request) throw new Error(`expected recorded library navigation request ${requestIndex}`);
    window.listNavigationContract.commit(request);
  }, index);
}

test('a filter commit that keeps the query does not overwrite the text typed meanwhile', async ({ page }) => {
  await chooseAllLinks(page);
  await searchField(page).fill('neu');
  await commitRequest(page, 0);
  await expect(searchField(page)).toHaveValue('neu');
  await searchField(page).press('Enter');
  expect(await page.evaluate(() => window.listNavigationContract.requests)).toEqual([
    '/dokumente?view=all&q=alt',
    '/dokumente?view=all&q=neu',
  ]);
});

test('a search submitted while a filter change loads keeps that filter change', async ({ page }) => {
  await chooseAllLinks(page);
  await searchField(page).fill('neu');
  await searchField(page).press('Enter');
  expect(await page.evaluate(() => window.listNavigationContract.requests[1])).toBe(
    '/dokumente?view=all&q=neu',
  );
  await commitRequest(page, 0);
  await commitRequest(page, 1);
  await expect(searchField(page)).toHaveValue('neu');
  await expect(page.getByRole('combobox', { name: 'Verknüpfung filtern' })).toHaveText('Alle Verknüpfungen');
});

test('a changed query in the URL replaces the field text', async ({ page }) => {
  await searchField(page).fill('ungesendet');
  await page.evaluate(() => window.listNavigationContract.commit('/dokumente?view=all&q=extern', true));
  await expect(searchField(page)).toHaveValue('extern');
});

test('a search cleared between a URL commit and its passive effects stays requested', async ({ page }) => {
  await searchField(page).fill('neu');
  await searchField(page).press('Enter');
  // Clearing the field lands right after the commit renders, before React
  // flushes that commit's passive effects.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const shownSearch = document.querySelector('output[aria-label="Angezeigte Suche"]');
        const input = document.querySelector('input[aria-label="Dokumente suchen"]');
        const [firstRequest] = window.listNavigationContract.requests;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!shownSearch || !(input instanceof HTMLInputElement) || !firstRequest || !setValue) {
          reject(new Error('expected the search field, the shown search and a recorded request'));
          return;
        }
        new MutationObserver((_, observer) => {
          if (shownSearch.textContent !== 'neu') return;
          observer.disconnect();
          setValue.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          resolve();
        }).observe(shownSearch, { childList: true, characterData: true, subtree: true });
        window.listNavigationContract.commit(firstRequest);
      }),
  );
  await expect(page.getByLabel('Bibliotheksstatus')).toHaveText('Wird geladen');
  await searchField(page).fill('neu');
  await searchField(page).press('Enter');
  expect(await page.evaluate(() => window.listNavigationContract.requests)).toEqual([
    '/dokumente?view=all&q=neu&link=employees',
    '/dokumente?view=all&link=employees',
    '/dokumente?view=all&q=neu&link=employees',
  ]);
});
