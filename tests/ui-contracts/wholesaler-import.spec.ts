import { expect, test, type Locator, type Page } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// werk-flow/werkflow-planning#375: the office imports a wholesaler delivery
// into the supplier's catalog with a preview. The browser reads the files
// through the reader seam (a fake here) and sends only parsed lines, in parts
// that each fit one call. A unit text the office leaves unmapped rejects its
// articles, the counts follow the choice, a delivery taken over before waits
// for the office's decision, nothing is confirmed before „Übernehmen“, and
// leaving the preview drops it. Made-up data only.

test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'wholesaler-import');
  const css = process.env.WERKFLOW_UI_CONTRACT_CSS;
  if (!css) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.addStyleTag({ path: css });
});

const contract = (page: Page) => page.evaluate(() => window.uiContractWholesalerImport);

async function openDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Großhandel importieren', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Großhandel importieren', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Chooses the supplier and two synthetic files, then asks for the preview. */
async function openPreview(page: Page): Promise<Locator> {
  const dialog = await openDialog(page);
  await dialog.getByRole('combobox', { name: /Großhändler/ }).click();
  await page.getByRole('option', { name: 'Großhandel Nordrohr', exact: true }).click();
  for (const name of ['nordrohr-artikel.dat', 'nordrohr-preise.dat']) {
    await dialog.locator('input[type="file"]').setInputFiles({
      name,
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('synthetische Lieferung'),
    });
  }
  await dialog.getByRole('button', { name: 'Vorschau anzeigen', exact: true }).click();
  await expect(dialog.getByText('Vorschau der Lieferung. Noch ist nichts übernommen.')).toBeVisible();
  return dialog;
}

function count(dialog: Locator, label: string): Locator {
  return dialog.getByRole('region', { name: 'Summen' }).getByText(label, { exact: true }).locator('xpath=..');
}

test('an unmapped unit text rejects its articles until the office picks a unit, and the confirm sends that choice', async ({
  page,
}) => {
  const dialog = await openPreview(page);
  await expect(dialog.getByText('Absender laut Lieferung')).toBeVisible();
  await expect(dialog.getByText('Großhandel Nordrohr GmbH, Bremen')).toBeVisible();
  await expect(count(dialog, 'Neue Artikel')).toContainText('120');
  // 2 unreadable lines, 5 articles of „Rolle 50m“, 1 price of an article the catalog lacks.
  await expect(count(dialog, 'Abgelehnte Zeilen')).toContainText('8');
  await expect(dialog.getByText('Nicht zugeordnet: Diese Artikel werden abgelehnt.')).toHaveCount(1);
  await expect(dialog.getByText('Der Artikel hat keine Artikelnummer.')).toBeVisible();

  await dialog.getByRole('combobox', { name: /„Rolle 50m“ · 5 Artikel/ }).click();
  await page.getByRole('option', { name: 'Rolle', exact: true }).click();
  await expect(count(dialog, 'Neue Artikel')).toContainText('125');
  await expect(count(dialog, 'Abgelehnte Zeilen')).toContainText('3');
  expect((await contract(page)).confirmations).toEqual([]);

  await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(dialog.getByText('Die Lieferung ist im Katalog des Großhändlers.')).toBeVisible();
  expect((await contract(page)).confirmations).toEqual([
    { importId: 'import-1', unitMapping: { Meter: 'meter', 'Rolle 50m': 'roll', Stück: 'piece' } },
  ]);
});

test('a submit without supplier or file marks both and focuses the supplier', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Vorschau anzeigen', exact: true }).click();
  await expect(dialog.getByText('Wähle den Großhändler, von dem die Lieferung stammt.')).toBeVisible();
  await expect(dialog.getByText('Wähle mindestens eine Datei der Lieferung.')).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: /Großhändler/ })).toBeFocused();
});

test('a delivery taken over before waits for „Trotzdem übernehmen“', async ({ page }) => {
  await page.evaluate(() => {
    window.uiContractWholesalerImport.repeat = {
      confirmedAt: '2037-11-03T09:30:00.000Z',
      confirmedBy: 'Bernd Buchung',
    };
  });
  const dialog = await openPreview(page);
  await expect(dialog.getByText(/von Bernd Buchung übernommen/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Trotzdem übernehmen', exact: true })).toBeFocused();
  await expect(dialog.getByText('Entscheide, ob du diese Lieferung noch einmal übernimmst.')).toBeVisible();
  expect((await contract(page)).confirmations).toEqual([]);

  await dialog.getByRole('button', { name: 'Trotzdem übernehmen', exact: true }).click();
  await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(dialog.getByText('Die Lieferung ist im Katalog des Großhändlers.')).toBeVisible();
  expect((await contract(page)).confirmations).toHaveLength(1);
});

test('the browser reads the files and sends only their parsed lines, each part small enough for one call', async ({
  page,
}) => {
  // 2 600 „Meter“ articles make more lines than one part carries.
  await page.evaluate(() => {
    window.uiContractWholesalerImport.meterArticles = 2600;
  });
  await openPreview(page);
  const { read, opened, staged } = await contract(page);
  expect(read).toEqual(['nordrohr-artikel.dat', 'nordrohr-preise.dat']);
  expect(opened).toHaveLength(1);
  expect(opened[0]?.fileNames).toEqual(['nordrohr-artikel.dat', 'nordrohr-preise.dat']);
  expect(opened[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  expect(opened[0]?.rebateGroups).toHaveLength(3);
  // 2 645 articles, the one without a number and the reader's refused line, in delivery order.
  expect(staged.length).toBeGreaterThan(1);
  const ordinals = staged.flat().map((line) => line.ordinal);
  expect(ordinals).toEqual(Array.from({ length: 2647 }, (_, ordinal) => ordinal));
  for (const part of staged) {
    expect(part.length).toBeLessThanOrEqual(2000);
    expect(JSON.stringify(part).length).toBeLessThan(450_000);
  }
});

test('a delivery the browser cannot read says why and sends nothing', async ({ page }) => {
  const dialog = await failPreview(page);
  await expect(dialog.getByRole('button', { name: 'Vorschau anzeigen', exact: true })).toBeEnabled();
  const { opened, staged, confirmations } = await contract(page);
  expect({ opened, staged, confirmations }).toEqual({ opened: [], staged: [], confirmations: [] });
});

test('a part the server refuses drops the batch and shows no preview', async ({ page }) => {
  await page.evaluate(() => {
    window.uiContractWholesalerImport.stageError = 'save_failed';
  });
  const dialog = await openDialog(page);
  await dialog.getByRole('combobox', { name: /Großhändler/ }).click();
  await page.getByRole('option', { name: 'Großhandel Nordrohr', exact: true }).click();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'nordrohr-artikel.dat',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('synthetisch'),
  });
  await dialog.getByRole('button', { name: 'Vorschau anzeigen', exact: true }).click();
  await expect(dialog.getByText(/Es wurde nichts übernommen/)).toBeVisible();
  await expect(dialog.getByText('Vorschau der Lieferung. Noch ist nichts übernommen.')).toHaveCount(0);
  await expect.poll(async () => (await contract(page)).abandoned).toEqual(['import-1']);
});

test('closing the preview drops it on the server', async ({ page }) => {
  const dialog = await openPreview(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await contract(page)).abandoned).toEqual(['import-1']);
});

/** Chooses supplier and one file and asks for a preview of a delivery the reader cannot read. */
async function failPreview(page: Page): Promise<Locator> {
  await page.evaluate(() => {
    window.uiContractWholesalerImport.readerFails = true;
  });
  const dialog = await openDialog(page);
  await dialog.getByRole('combobox', { name: /Großhändler/ }).click();
  await page.getByRole('option', { name: 'Großhandel Nordrohr', exact: true }).click();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'nordrohr-artikel.dat',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('synthetisch'),
  });
  await dialog.getByRole('button', { name: 'Vorschau anzeigen', exact: true }).click();
  await expect(dialog.getByText(/Die Lieferung konnte nicht gelesen werden/)).toBeVisible();
  return dialog;
}

const CAPTURES: ReadonlyArray<readonly [string, (page: Page) => Promise<unknown>]> = [
  ['auswahl-leer', openDialog],
  ['vorschau-einheit-abgelehnt', openPreview],
  [
    'ergebnis',
    async (page) => {
      const dialog = await openPreview(page);
      await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).click();
      await expect(dialog.getByText('Die Lieferung ist im Katalog des Großhändlers.')).toBeVisible();
    },
  ],
  ['fehler', failPreview],
  [
    'uebertragen',
    async (page) => {
      await page.evaluate(() => {
        window.uiContractWholesalerImport.stageHeld = true;
      });
      const dialog = await openDialog(page);
      await dialog.getByRole('combobox', { name: /Großhändler/ }).click();
      await page.getByRole('option', { name: 'Großhandel Nordrohr', exact: true }).click();
      await dialog.locator('input[type="file"]').setInputFiles({
        name: 'nordrohr-artikel.dat',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('synthetisch'),
      });
      await dialog.getByRole('button', { name: 'Vorschau anzeigen', exact: true }).click();
      await expect(dialog.getByRole('status')).toHaveText('Die Zeilen werden übertragen … 0 von 167');
    },
  ],
];

for (const [name, reach] of CAPTURES) {
  for (const width of [1280, 375]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      test(`capture ${name} at ${width} px, ${colorScheme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme });
        await reach(page);
        await page.screenshot({
          path: test.info().outputPath(`${name}-${width}-${colorScheme}.png`),
          fullPage: true,
        });
      });
    }
  }
}
