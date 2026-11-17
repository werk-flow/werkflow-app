import { expect, test, type Locator, type Page } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// werk-flow/werkflow-planning#375: the office imports a wholesaler delivery
// into the supplier's catalog with a preview. The browser reads the files
// through the reader seam (a fake here) and sends only parsed lines, in parts
// that each fit one call. A unit text the office leaves unmapped rejects its
// articles, the counts follow the choice, a delivery taken over before waits
// for the office's decision, nothing is confirmed before „Übernehmen“, and
// leaving the preview drops it. werk-flow/werkflow-planning#477: the preview
// lists each own article's price change for the office's unit choice and
// rebates, and the confirm sends only rebates the shown prices were computed
// with. Made-up data only.

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
    {
      importId: 'import-1',
      unitMapping: { Meter: 'meter', 'Rolle 50m': 'roll', Stück: 'piece' },
      rebates: { AR1: null, CU1: 3000 },
      priceFingerprint: (3000).toString(16).padStart(32, '0'),
    },
  ]);
});

test('the unit choice is locked while the confirm runs, so the preview never shows a choice it did not send', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.uiContractWholesalerImport.confirmHeld = true;
  });
  const dialog = await openPreview(page);
  const unit = dialog.getByRole('combobox', { name: /„Rolle 50m“ · 5 Artikel/ });
  await expect(unit).toBeEnabled();
  await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect
    .poll(async () => (await contract(page)).confirmations)
    .toEqual([
      {
        importId: 'import-1',
        unitMapping: { Meter: 'meter', 'Rolle 50m': null, Stück: 'piece' },
        rebates: { AR1: null, CU1: 3000 },
        priceFingerprint: (3000).toString(16).padStart(32, '0'),
      },
    ]);
  await expect(unit).toBeDisabled();
  await expect(dialog.getByRole('textbox', { name: /Rabatt in % für „CU1“/ })).toBeDisabled();
});

function prices(dialog: Locator): Locator {
  return dialog.getByRole('region', { name: 'Preise eigener Artikel' });
}

test('the preview lists each own price change with its old and new price, and the unit choice decides which apply', async ({
  page,
}) => {
  const dialog = await openPreview(page);
  expect((await contract(page)).pricings).toEqual([{ importId: 'import-1', rebates: null }]);
  await expect(prices(dialog).getByText('Verkaufspreis: 5,00 € je m → 610,00 € je 100 m')).toBeVisible();
  await expect(
    prices(dialog).getByText('Einkaufspreis: 4,00 € je m → 427,00 € je 100 m (Listenpreis minus 30 %)'),
  ).toBeVisible();
  await expect(prices(dialog).getByText('Einkaufspreis: 12,50 € je Stk → 13,00 € je Stk')).toBeVisible();
  await expect(prices(dialog).getByText(/ab 17\.11\.2037/)).toBeVisible();
  // The roll's article line has a unit text the office has not mapped yet.
  await expect(prices(dialog).getByText('Mehrschichtverbundrohr 16 mm')).toHaveCount(0);
  await expect(count(dialog, 'Preise eigener Artikel')).toContainText('3');

  await dialog.getByRole('combobox', { name: /„Rolle 50m“ · 5 Artikel/ }).click();
  await page.getByRole('option', { name: 'Rolle', exact: true }).click();
  await expect(prices(dialog).getByText('Verkaufspreis: bisher keiner → 99,00 € je Rolle')).toBeVisible();
  await expect(count(dialog, 'Preise eigener Artikel')).toContainText('4');

  // Mapped to another unit than the article's, the price is named as not taken.
  await dialog.getByRole('combobox', { name: /„Meter“ · 120 Artikel/ }).click();
  await page.getByRole('option', { name: 'Stange', exact: true }).click();
  await expect(count(dialog, 'Preise eigener Artikel')).toContainText('2');
  await expect(prices(dialog).getByText(/^2 Preise werden nicht übernommen/)).toBeVisible();
  expect((await contract(page)).confirmations).toEqual([]);
});

test('a changed rebate prices the own articles again, and the confirm sends that rebate', async ({
  page,
}) => {
  const dialog = await openPreview(page);
  const rebate = dialog.getByRole('textbox', { name: /Rabatt in % für „CU1“/ });
  await expect(rebate).toHaveValue('30');
  await expect(dialog.getByText('Vorschlag laut Lieferung: 30 %')).toBeVisible();
  await rebate.fill('25');
  await rebate.blur();
  await expect(
    prices(dialog).getByText('Einkaufspreis: 4,00 € je m → 457,50 € je 100 m (Listenpreis minus 25 %)'),
  ).toBeVisible();
  expect((await contract(page)).pricings.at(-1)).toEqual({
    importId: 'import-1',
    rebates: { AR1: null, CU1: 2500 },
  });

  await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(dialog.getByText('Die Lieferung ist im Katalog des Großhändlers.')).toBeVisible();
  // The confirm names the prices it shows: those of the 25 % pricing.
  expect(
    (await contract(page)).confirmations.map(({ rebates, priceFingerprint }) => ({
      rebates,
      priceFingerprint,
    })),
  ).toEqual([{ rebates: { AR1: null, CU1: 2500 }, priceFingerprint: (2500).toString(16).padStart(32, '0') }]);
});

test('prices changed since the price preview are shown again before anything is confirmed', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.uiContractWholesalerImport.confirmError = 'prices_changed';
  });
  const dialog = await openPreview(page);
  await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(dialog.getByText(/haben sich seit der Vorschau geändert/)).toBeVisible();
  await expect(dialog.getByText('Vorschau der Lieferung. Noch ist nichts übernommen.')).toBeVisible();
  expect((await contract(page)).pricings).toHaveLength(2);

  await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(dialog.getByText('Die Lieferung ist im Katalog des Großhändlers.')).toBeVisible();
  expect((await contract(page)).confirmations).toHaveLength(2);
});

test('a cleared rebate drops the purchase price from the list price', async ({ page }) => {
  const dialog = await openPreview(page);
  const rebate = dialog.getByRole('textbox', { name: /Rabatt in % für „CU1“/ });
  await rebate.fill('');
  await rebate.blur();
  await expect(prices(dialog).getByText(/Listenpreis minus/)).toHaveCount(0);
  await expect(count(dialog, 'Preise eigener Artikel')).toContainText('2');
});

test('a rebate that is no percentage marks its field and focuses it, and nothing is confirmed', async ({
  page,
}) => {
  const dialog = await openPreview(page);
  const rebate = dialog.getByRole('textbox', { name: /Rabatt in % für „AR1“/ });
  await rebate.fill('120');
  await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(
    dialog.getByText('Gib einen Rabatt von 0 bis 100 % mit höchstens zwei Nachkommastellen ein.'),
  ).toBeVisible();
  await expect(rebate).toBeFocused();
  const { confirmations, pricings } = await contract(page);
  expect({ confirmations, pricings: pricings.length }).toEqual({ confirmations: [], pricings: 1 });
});

test('a price preview that fails drops the batch and shows no preview', async ({ page }) => {
  await page.evaluate(() => {
    window.uiContractWholesalerImport.pricingError = 'save_failed';
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
    // One staging call's body in UTF-8 bytes stays below the 1 MB a Server Action takes.
    expect(Buffer.byteLength(JSON.stringify([{ importId: 'import-1', lines: part }]))).toBeLessThan(
      1024 * 1024,
    );
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
    'vorschau-preise',
    async (page) => {
      const dialog = await openPreview(page);
      await dialog.getByRole('combobox', { name: /„Rolle 50m“ · 5 Artikel/ }).click();
      await page.getByRole('option', { name: 'Rolle', exact: true }).click();
      await prices(dialog).scrollIntoViewIfNeeded();
    },
  ],
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
