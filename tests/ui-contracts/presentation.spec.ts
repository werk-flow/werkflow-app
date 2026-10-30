import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';
import { expectDialogFits } from '../audit/support/layout-measure';

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  const css = process.env.WERKFLOW_UI_CONTRACT_CSS;
  if (!bundle || !css) throw new Error('Run the styled contracts through test:ui.');
  await page.route('http://localhost/ui-contracts', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://localhost/ui-contracts');
  await page.addStyleTag({ path: css });
  await page.evaluate(() => {
    window.uiContractFixture = 'presentation';
  });
  await page.addScriptTag({ path: bundle });
});

test('phone page headings keep their word intact and actions wrap below', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const header = page.getByRole('region', { name: 'Seitenkopf' });
  const title = header.getByRole('heading', { name: 'Mitarbeiter' });
  const titleBox = await title.boundingBox();
  const actionBox = await header.getByRole('button', { name: 'Hinzufügen' }).boundingBox();
  if (!titleBox || !actionBox) throw new Error('Missing header geometry');
  expect(titleBox.height).toBeLessThan(32);
  expect(actionBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
  expect(await header.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
});

for (const propsFirst of [false, true]) {
  test(`location reconciliation suppresses the confirmed placeholder, props first: ${propsFirst}`, async ({
    page,
  }) => {
    const region = page.getByRole('region', { name: 'Lagerabgleich' });
    await region.getByRole('button', { name: 'Anlegen beginnen' }).click();
    await expect(region.getByRole('status', { name: 'Lager wird angelegt', exact: true })).toBeVisible();
    for (const action of propsFirst
      ? ['Serverliste erhalten', 'Antwort erhalten']
      : ['Antwort erhalten', 'Serverliste erhalten']) {
      await region.getByRole('button', { name: action }).click();
    }
    await expect(region.getByRole('heading', { name: 'Servicefahrzeug' })).toHaveCount(1);
    await expect(region.getByRole('status', { name: 'Lager wird angelegt', exact: true })).toHaveCount(0);
  });
}

test('replacements animate with only one live actionable banner; stale dismissal cannot remove the new one', async ({
  page,
}) => {
  await page.clock.install();
  await page.getByRole('button', { name: 'Erster Hinweis', exact: true }).click();
  await page.getByRole('button', { name: 'Ausblenden', exact: true }).click();
  await page.getByRole('button', { name: 'Zweiter Hinweis', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText('Zweiter Hinweis');
  await page.clock.fastForward(200);
  await expect(page.getByRole('button', { name: 'Hinweis schließen' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await page.clock.fastForward(200);
  await expect(page.getByRole('alert')).toContainText('Aktion abgeschlossen');
});

for (const width of [375, 1280]) {
  test(`dialog actions stay separated at viewport width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.getByRole('button', { name: 'Formular öffnen' }).click();
    const dialog = page.getByRole('dialog');
    const cancel = await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).boundingBox();
    const save = await dialog.getByRole('button', { name: 'Speichern', exact: true }).boundingBox();
    if (!cancel || !save) throw new Error('Missing dialog action geometry');
    if (width < 640) {
      expect(cancel.y - save.y - save.height).toBeGreaterThanOrEqual(8);
      expect(cancel.height).toBeGreaterThanOrEqual(44);
      expect(save.height).toBeGreaterThanOrEqual(44);
    } else {
      expect(save.x - cancel.x - cancel.width).toBeGreaterThanOrEqual(8);
    }
  });
}

test('tabbed dialogs keep their frame and footer while long content scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'Formular öffnen' }).click();
  const dialog = page.getByRole('dialog');
  const before = await dialog.boundingBox();
  const footerBefore = await page.getByRole('button', { name: 'Speichern' }).boundingBox();
  expect(footerBefore?.height).toBeGreaterThanOrEqual(44);
  expect(
    (await dialog.getByRole('button', { name: 'Schließen', exact: true }).boundingBox())?.height,
  ).toBeGreaterThanOrEqual(44);
  await page.getByRole('tab', { name: 'Lang', exact: true }).click();
  expect(await dialog.boundingBox()).toEqual(before);
  expect(await page.getByRole('button', { name: 'Speichern' }).boundingBox()).toEqual(footerBefore);
  await expect(page.getByLabel('Zeile 20', { exact: true })).toBeAttached();
  await page.getByLabel('Zeile 20', { exact: true }).focus();
  await expect(page.getByLabel('Zeile 20', { exact: true })).toBeInViewport();
});

for (const width of [375, 1280]) {
  test(`a long confirmation without a scroll body keeps its footer actions in reach at width ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.getByRole('button', { name: 'Lange Bestätigung öffnen' }).click();
    const confirmation = page.getByRole('alertdialog', { name: 'Organisation „Probe“ löschen?' });
    // The content is taller than the layer, so the layer itself scrolls.
    expect(await confirmation.evaluate((layer) => layer.scrollHeight > layer.clientHeight)).toBe(true);
    await expect(confirmation.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
    await expectDialogFits(confirmation, `long confirmation at ${width}`);
    // Focusing the action scrolls the footer into view by itself; the sticky footer must also hold at the top and midway.
    for (const position of [0, 0.5]) {
      await confirmation.evaluate((layer, ratio) => {
        layer.scrollTop = (layer.scrollHeight - layer.clientHeight) * ratio;
      }, position);
      await expectDialogFits(confirmation, `long confirmation at ${width}, scrolled to ${position * 100} %`);
    }
  });
}

test('focus remains visible without adding an orange border or shifting the field', async ({ page }) => {
  const input = page.getByLabel('Bezeichnung');
  const before = await input.evaluate((element) => ({
    border: getComputedStyle(element).borderColor,
    width: element.getBoundingClientRect().width,
  }));
  await input.focus();
  const after = await input.evaluate((element) => ({
    border: getComputedStyle(element).borderColor,
    width: element.getBoundingClientRect().width,
    shadow: getComputedStyle(element).boxShadow,
  }));
  expect(after.border).toBe(before.border);
  expect(after.width).toBe(before.width);
  expect(after.shadow).not.toBe('none');
});

test('a scrolling page body becomes a tab stop while its only reachable control is disabled', async ({
  page,
}) => {
  const section = page.getByRole('region', { name: 'Seitenkörper' });
  const bodyRegion = section.getByRole('region', { name: 'Seiteninhalt' });
  await expect(section.getByRole('button', { name: 'Einziger Knopf' })).toBeEnabled();
  // The enabled button is the keyboard's way in, so the body adds no tab stop of its own.
  await expect(bodyRegion).toHaveCount(0);
  await section.getByRole('button', { name: 'Knopf umschalten' }).click();
  await expect(section.getByRole('button', { name: 'Einziger Knopf' })).toBeDisabled();
  // The button inside the hidden subtree cannot take focus either, so the body must.
  await expect(bodyRegion).toHaveAttribute('tabindex', '0');
  await section.getByRole('button', { name: 'Knopf umschalten' }).click();
  await expect(bodyRegion).toHaveCount(0);
});

test('a two-minute activity has a readable label and opens from its center', async ({ page }) => {
  const block = page.getByRole('region', { name: 'Kurze Fahrt' }).getByRole('button');
  const box = await block.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(72);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await expect(block).toContainText('Fahrt');
  await expect(block).toContainText('2');
  await block.click();
  await expect(page.getByLabel('Zeitblock geöffnet')).toHaveText('Ja');
});
