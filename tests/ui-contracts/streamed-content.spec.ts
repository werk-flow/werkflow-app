import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '../../lib/testing/runner/workspace-test-lock';
import { openPage, revealStreamedContentAfterEachLoad } from '../golden/support/streamed-content';

// The document right after a load, as two failed runs left it. React keeps a
// Suspense boundary's streamed content in `<div hidden id="S:…">` at the end
// of `<body>` until its batched reveal. An update made React render the same
// content on the client first, so the document holds a shown and a hidden
// copy until the reveal removes the streamed one. `audit:wave-1:a1-kunden`
// failed on this state: `getByLabel('Kunden durchsuchen') resolved to 2
// elements`. The fixture page never reveals by itself; the test does, as
// React's reveal would.
const searchField = '<input type="text" aria-label="Kunden durchsuchen">';
const fixtureUrl = 'http://localhost/kunden';
const nextUrl = 'http://localhost/kunden-weiter';

function documentAfterLoad(options: { clientRendered: boolean }): string {
  return `<!doctype html><html lang="de"><body>
    <main>${options.clientRendered ? searchField : '<p>Kunden werden geladen …</p>'}<a href="${nextUrl}">Weiter</a></main>
    <div hidden id="S:2"><h2>Kundenliste</h2>${searchField}</div>
  </body></html>`;
}

async function serve(page: Page, options: { clientRendered: boolean }): Promise<void> {
  await page.route(fixtureUrl, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: documentAfterLoad(options) }),
  );
  await page.route(nextUrl, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="de"><body><main>${searchField}</main></body></html>`,
    }),
  );
}

function search(page: Page) {
  return page.getByLabel('Kunden durchsuchen');
}

/** What React does at the client render: the shown copy replaces the boundary's fallback. */
async function renderOnClient(page: Page): Promise<void> {
  await page.evaluate((field) => {
    const main = document.querySelector('main');
    if (main) main.insertAdjacentHTML('afterbegin', field);
  }, searchField);
}

/** What React's batched reveal does once the client rendered the boundary: the streamed copy goes. */
async function reveal(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById('S:2')?.remove());
}

test.beforeEach(() => {
  assertWorkspaceTestLock();
});

test('without the wait, a step after the load meets the streamed copy and fails strict mode', async ({
  page,
}) => {
  await serve(page, { clientRendered: true });
  await page.goto(fixtureUrl);
  await expect(expect(search(page)).toBeVisible()).rejects.toThrow(/strict mode violation/);
});

test('goto returns only after React revealed what it streamed, while both copies exist', async ({
  context,
}) => {
  const page = await openPage(context);
  await serve(page, { clientRendered: true });
  const loaded = page.waitForEvent('load');
  let returnedAt = 0;
  const going = page.goto(fixtureUrl).then(() => {
    returnedAt = Date.now();
  });
  await loaded;
  // The document loaded with both copies; the fixture page reveals nothing by itself.
  await expect(search(page)).toHaveCount(2);
  const revealedAt = Date.now();
  await reveal(page);
  await going;
  expect(returnedAt).toBeGreaterThanOrEqual(revealedAt);
  await expect(search(page)).toBeVisible();
});

test('goto waits through the client render to the reveal when the streamed copy came first', async ({
  context,
}) => {
  const page = await openPage(context);
  // audit:wave-1:a1-kunden first saw the streamed copy alone, hidden, then both.
  await serve(page, { clientRendered: false });
  const loaded = page.waitForEvent('load');
  let returnedAt = 0;
  const going = page.goto(fixtureUrl).then(() => {
    returnedAt = Date.now();
  });
  await loaded;
  await expect(search(page)).toHaveCount(1);
  await renderOnClient(page);
  await expect(search(page)).toHaveCount(2);
  const revealedAt = Date.now();
  await reveal(page);
  await going;
  expect(returnedAt).toBeGreaterThanOrEqual(revealedAt);
  await expect(search(page)).toBeVisible();
});

test('a navigation under the wait moves it to the new document instead of failing it', async ({
  context,
}) => {
  const page = await openPage(context);
  await serve(page, { clientRendered: true });
  const loaded = page.waitForEvent('load');
  const going = page.goto(fixtureUrl);
  await loaded;
  // A redirect after the load: the old document and its pending reveal are gone.
  await page.getByRole('link', { name: 'Weiter' }).click();
  await going;
  await expect(page).toHaveURL(nextUrl);
  await expect(search(page)).toBeVisible();
});

test('a streamed container that never reveals fails goto, naming the container and its text', async ({
  context,
}) => {
  const page = await openPage(context);
  await serve(page, { clientRendered: true });
  await expect(page.goto(fixtureUrl)).rejects.toThrow(/still hidden: S:2 "Kundenliste"/);
});

test('a streamed container that never reveals fails reload the same way', async ({ page }) => {
  await serve(page, { clientRendered: true });
  await page.goto(fixtureUrl);
  revealStreamedContentAfterEachLoad(page);
  await expect(page.reload()).rejects.toThrow(/still hidden: S:2 "Kundenliste"/);
});

test('a client-side redirect during the wait has happened when goto returns', async ({ context }) => {
  const page = await openPage(context);
  await serve(page, { clientRendered: true });
  const loaded = page.waitForEvent('load');
  const going = page.goto(fixtureUrl);
  await loaded;
  // The page redirects after hydration, as a redirect from inside a streamed boundary does (/einstellungen).
  await page.evaluate(() => history.replaceState(null, '', '/kunden/profil'));
  await reveal(page);
  await going;
  // The step after goto sees the page the app ended on, not the URL it asked for.
  await expect(page).toHaveURL('http://localhost/kunden/profil');
});
