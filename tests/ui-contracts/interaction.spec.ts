import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '../../lib/testing/runner/workspace-test-lock';
import { dismissDialog, pressKey, settled } from '../golden/support/steps/interaction';

// The settle primitive of the browser suite against the busy signals the
// registry dialogs render (components/ui/dialog.tsx): a pending dialog carries
// aria-busy and data-pending and refuses Escape until its request answers.
const fixtureUrl = 'http://localhost/interaction';
const fixture = `<html lang="de"><body><main>
  <label>Suche <input id="search"></label>
  <button id="outside">Außen</button>
  <div role="dialog" aria-label="Formular" id="dialog" aria-busy="true" data-pending="true">
    <button id="inside">Speichern</button>
  </div>
  <script>
    const dialog = document.getElementById('dialog');
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && dialog.getAttribute('data-pending') !== 'true') dialog.hidden = true;
      if (event.key === 'j') document.querySelector('main').dataset.shortcut = 'j';
    });
  </script>
</main></body></html>`;

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  await page.route(`${fixtureUrl}**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture }),
  );
  await page.goto(fixtureUrl);
});

test('settled waits for a pending dialog to answer and names the busy element when it never does', async ({
  page,
}) => {
  const dialog = page.getByRole('dialog', { name: 'Formular' });
  let settledAt = 0;
  const settling = settled(dialog).then(() => {
    settledAt = Date.now();
  });
  await expect(dialog).toHaveAttribute('data-pending', 'true');
  const answeredAt = Date.now();
  await page.evaluate(() => {
    const element = document.getElementById('dialog');
    element?.removeAttribute('aria-busy');
    element?.removeAttribute('data-pending');
  });
  await settling;
  expect(settledAt).toBeGreaterThanOrEqual(answeredAt);

  await page.evaluate(() => document.getElementById('dialog')?.setAttribute('aria-busy', 'true'));
  await expect(settled(page, { timeout: 500 })).rejects.toThrow(/Formular|Speichern/);
});

test('dismissDialog waits for the request instead of pressing Escape into a pending dialog', async ({
  page,
}) => {
  const dialog = page.getByRole('dialog', { name: 'Formular' });
  const dismissing = dismissDialog(dialog);
  await page.evaluate(() => {
    const element = document.getElementById('dialog');
    element?.removeAttribute('aria-busy');
    element?.removeAttribute('data-pending');
  });
  await dismissing;
  await expect(dialog).toBeHidden();
});

test('pressKey refuses a shortcut while focus sits in a text field and presses it elsewhere', async ({
  page,
}) => {
  await page.evaluate(() => {
    const element = document.getElementById('dialog');
    element?.removeAttribute('aria-busy');
    element?.removeAttribute('data-pending');
  });
  const search = page.getByRole('textbox', { name: 'Suche' });
  await search.focus();
  await expect(pressKey(page, 'j')).rejects.toThrow('focus is in a textbox');
  await expect(search).toHaveValue('');

  await page.getByRole('button', { name: 'Außen' }).focus();
  await pressKey(page, 'j');
  await expect(page.getByRole('main')).toHaveAttribute('data-shortcut', 'j');

  await pressKey(page, 'x', { into: search });
  await expect(search).toHaveValue('x');
});
