import { expect, test, type Locator, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '../../lib/testing/runner/workspace-test-lock';
import { holidayRegionSelect, setHolidayRegionViaSettings } from '../golden/support/steps/personnel';

// The document a step can meet right after a load: React streamed a Suspense
// boundary's content into `<div hidden id="S:…">` at the end of `<body>`, an
// update made React render the same content on the client, and the batched
// reveal has not removed the streamed copy yet. A run of audit:wave-1:a4
// failed on exactly this page: `#holiday-region` resolved to two elements.
// The copy never leaves this fixture, so every lookup of the step meets it.
const settingsCard = `
  <label for="holiday-region">Bundesland</label>
  <button type="button" role="combobox" id="holiday-region" aria-expanded="false" aria-haspopup="listbox">Bitte wählen</button>
  <button type="button" data-save>Feiertagskalender speichern</button>
  <p data-saved>Der Feiertagskalender wurde gespeichert.</p>`;
const fixture = `<!doctype html><html lang="de"><body>
  <div><main>${settingsCard}</main></div>
  <div hidden id="S:2">${settingsCard}</div>
  <script>
    const shown = document.querySelector('main');
    const trigger = shown.querySelector('[role="combobox"]');
    const saved = shown.querySelector('[data-saved]');
    saved.hidden = true;
    trigger.addEventListener('click', () => {
      const popover = document.createElement('div');
      popover.innerHTML =
        '<input type="text" aria-label="Bundesland suchen …"><div role="listbox"><div role="option">Bayern</div><div role="option">Hessen</div></div>';
      popover.querySelector('[role="listbox"]').addEventListener('click', (event) => {
        trigger.textContent = event.target.textContent;
        popover.remove();
      });
      document.body.append(popover);
    });
    shown.querySelector('[data-save]').addEventListener('click', () => {
      saved.hidden = false;
    });
  </script>
</body></html>`;

test.use({ baseURL: 'http://localhost' });

/** The broken case: the whole-page lookup by id that the failed run made. */
function lookupById(page: Page): Locator {
  // eslint-disable-next-line playwright-spec/no-unscoped-page-selectors -- the broken case needs the whole-page selector
  return page.locator('#holiday-region');
}

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  await page.route('http://localhost/einstellungen/zeiterfassung', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture }),
  );
});

test('a lookup by id on the whole page meets the streamed hidden copy and fails strict mode', async ({
  page,
}) => {
  await page.goto('/einstellungen/zeiterfassung');
  await expect(lookupById(page)).toHaveCount(2);
  await expect(expect(lookupById(page)).toBeVisible()).rejects.toThrow(/strict mode violation/);
});

test('the holiday-region step selects and saves on the shown card beside its hidden copy', async ({
  page,
}) => {
  await setHolidayRegionViaSettings(page, 'Bayern');
  await expect(holidayRegionSelect(page)).toHaveText('Bayern');
  // The copy stayed for every lookup of the step.
  await expect(lookupById(page)).toHaveCount(2);
});
