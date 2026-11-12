import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '../../lib/testing/runner/workspace-test-lock';
import {
  openPage,
  revealStreamedContentBeforeEachStep,
  STREAMED_SEGMENT,
} from '../golden/support/streamed-content';

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

/**
 * Resolves when the wait's handler starts on the page: it looks for the
 * streamed segment only while it holds a step.
 */
function handlerRuns(page: Page): Promise<void> {
  const locate = page.locator.bind(page);
  return new Promise((resolve) => {
    page.locator = (selector, options) => {
      if (selector === STREAMED_SEGMENT) resolve();
      return locate(selector, options);
    };
  });
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

test('with the wait, a step is held while both copies exist and passes once React revealed', async ({
  context,
}) => {
  const page = await openPage(context);
  await open(page, { clientRendered: true });
  const holding = handlerRuns(page);
  let passedAt = 0;
  const shown = expect(search(page))
    .toBeVisible()
    .then(() => {
      passedAt = Date.now();
    });
  // Without the wait, the step fails strict mode here instead.
  await Promise.race([holding, shown]);
  const revealedAt = Date.now();
  await reveal(page);
  await shown;
  expect(passedAt).toBeGreaterThanOrEqual(revealedAt);
  await expect(search(page)).toHaveCount(1);
});

test('with the wait, a step started before the client render is held through it until the reveal', async ({
  page,
}) => {
  await revealStreamedContentBeforeEachStep(page);
  // audit:wave-1:a1-kunden first saw the streamed copy alone, hidden, then both.
  await open(page, { clientRendered: false });
  const holding = handlerRuns(page);
  let passedAt = 0;
  const shown = expect(search(page))
    .toBeVisible()
    .then(() => {
      passedAt = Date.now();
    });
  await Promise.race([holding, shown]);
  await renderOnClient(page);
  const revealedAt = Date.now();
  await reveal(page);
  await shown;
  expect(passedAt).toBeGreaterThanOrEqual(revealedAt);
  await expect(search(page)).toHaveCount(1);
});
