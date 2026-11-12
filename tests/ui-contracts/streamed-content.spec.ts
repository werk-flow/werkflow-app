import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '../../lib/testing/runner/workspace-test-lock';
import { openPage, revealStreamedContentBeforeEachStep } from '../golden/support/streamed-content';

// The document right after a load, as two failed runs left it. React keeps a
// Suspense boundary's streamed content in `<div hidden id="S:…">` at the end
// of `<body>` until its batched reveal. An update made React render the same
// content on the client first, so the document holds a shown and a hidden
// copy until the reveal removes the streamed one. `audit:wave-1:a1-kunden`
// failed on this state: `getByLabel('Kunden durchsuchen')` resolved to 2
// elements. The fixture page never reveals by itself; the test does, as
// React's reveal would.
const searchField = '<input type="text" aria-label="Kunden durchsuchen">';
const fixtureUrl = 'http://localhost/kunden';

function documentAfterLoad(options: { clientRendered: boolean }): string {
  return `<!doctype html><html lang="de"><body>
    <main>${options.clientRendered ? searchField : '<p>Kunden werden geladen …</p>'}</main>
    <div hidden id="S:2">${searchField}</div>
  </body></html>`;
}

async function open(page: Page, options: { clientRendered: boolean }): Promise<void> {
  await page.route(fixtureUrl, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: documentAfterLoad(options) }),
  );
  await page.goto(fixtureUrl);
}

function search(page: Page) {
  return page.getByLabel('Kunden durchsuchen');
}

/** What React does at the client render: the shown copy replaces the boundary's fallback. */
async function renderOnClient(page: Page): Promise<void> {
  await page.evaluate((field) => {
    const main = document.querySelector('main');
    if (main) main.innerHTML = field;
  }, searchField);
}

/** What React's batched reveal does once the client rendered the boundary: the streamed copy goes. */
async function reveal(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById('S:2')?.remove());
}

test.beforeEach(() => {
  assertWorkspaceTestLock();
});

test('without the wait, a step on the page meets the streamed copy and fails strict mode', async ({
  page,
}) => {
  await open(page, { clientRendered: true });
  await expect(expect(search(page)).toBeVisible()).rejects.toThrow(/strict mode violation/);
});

test('with the wait, a step is held while the streamed copy is left, not failed', async ({ context }) => {
  const page = await openPage(context);
  await open(page, { clientRendered: true });
  const held = await expect(search(page))
    .toBeVisible()
    .then(
      () => 'passed',
      (error: unknown) => String(error),
    );
  expect(held).not.toMatch(/strict mode violation/);
  // The handler's own check or the call log that names its interception: either proves the hold.
  expect(held).toMatch(
    /React reveals the content it streamed after the load|intercepting action to run the handler/,
  );
});

test('with the wait, a step passes once React revealed the streamed content', async ({ page }) => {
  await revealStreamedContentBeforeEachStep(page);
  await open(page, { clientRendered: true });
  const shown = expect(search(page)).toBeVisible();
  await reveal(page);
  await shown;
  await expect(search(page)).toHaveCount(1);
});

test('with the wait, a step started before the client render passes after the reveal', async ({ page }) => {
  await revealStreamedContentBeforeEachStep(page);
  // audit:wave-1:a1-kunden first saw the streamed copy alone, hidden, then both.
  await open(page, { clientRendered: false });
  const shown = expect(search(page)).toBeVisible();
  await renderOnClient(page);
  await reveal(page);
  await shown;
  await expect(search(page)).toHaveCount(1);
});
