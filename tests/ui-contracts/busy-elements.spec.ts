import { expect, test } from '@playwright/test';
import { busyElements } from '../golden/support/busy-elements';

// What a failed settle prints comes from facts `busyElements` collects in the
// page (tests/golden/support/busy-elements.ts). The page is plain markup
// with each busy signal the registry sets, so the proof runs the real
// collection without a product screen.

const PAGE = `<!doctype html><html lang="de" data-route-refresh><body>
<main>
  <section aria-labelledby="dokumente-titel">
    <span id="dokumente-titel">Dokumente</span>
    <div data-slot="skeleton" style="height:8px"></div>
    <div data-slot="skeleton" style="height:8px"></div>
  </section>
  <div data-slot="skeleton" style="height:8px"></div>
  <div data-slot="skeleton" style="height:8px"></div>
  <div data-slot="skeleton" style="height:8px"></div>
  <div role="status" aria-busy="true" aria-label="Termine werden geladen">
    <span data-slot="spinner" style="display:inline-block;width:8px;height:8px"></span>
  </div>
  <div hidden><div data-slot="skeleton" style="height:8px"></div></div>
  <div data-calendar-state="loading" data-testid="kalender"></div>
  <div data-calendar-state="ready"></div>
</main>
<nav><button aria-busy="true" data-unconfirmed>Speichern</button></nav>
<div role="dialog" aria-label="Kunde anlegen" data-pending="true" style="height:8px"></div>
<div data-slot="skeleton" style="height:8px"></div>
</body></html>`;

test('busyElements names each busy element by its signals, name and nearest region, and counts repeats once', async ({
  page,
}) => {
  await page.setContent(PAGE);
  expect(await busyElements(page)).toEqual([
    'route refresh queued or running',
    'calendar in state loading',
    '2× skeleton <div> in section "Dokumente"',
    '3× skeleton <div> in main',
    'aria-busy <div role="status"> "Termine werden geladen" in main',
    'spinner <span> in status "Termine werden geladen"',
    'aria-busy + unconfirmed <button> "Speichern" in nav',
    'pending dialog <div role="dialog"> "Kunde anlegen"',
    'skeleton <div>',
  ]);
});

test('busyElements of a scope reads the scope itself and its contents only', async ({ page }) => {
  await page.setContent(PAGE);
  expect(await busyElements(page.getByRole('status'))).toEqual([
    'route refresh queued or running',
    'aria-busy <div role="status"> "Termine werden geladen" in main',
    'spinner <span> in status "Termine werden geladen"',
  ]);
});

test('busyElements of a scope that is a loading calendar reports the calendar', async ({ page }) => {
  await page.setContent(PAGE);
  expect(await busyElements(page.getByTestId('kalender'))).toEqual([
    'route refresh queued or running',
    'calendar in state loading',
  ]);
});

test('busyElements is empty on a settled page', async ({ page }) => {
  await page.setContent(
    '<!doctype html><html lang="de"><body><main><div data-calendar-state="ready">Fertig</div></main></body></html>',
  );
  expect(await busyElements(page)).toEqual([]);
});
