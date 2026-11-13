import { expect, test, type Locator, type Page } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// The report dialog (docs/features/problem-reports.md) over stub actions:
// the real launcher, recorder, context builder, redaction and upload client.

type StoredPut = { kind: string; body: Buffer };

async function openReportFixture(page: Page): Promise<StoredPut[]> {
  const puts: StoredPut[] = [];
  await page.route('http://localhost/storage/**', async (route) => {
    const kind = new URL(route.request().url()).pathname.split('/')[2] ?? '';
    puts.push({ kind, body: route.request().postDataBuffer() ?? Buffer.alloc(0) });
    await route.fulfill({ status: 200, body: '' });
  });
  await openContractFixture(page, 'problem-report');
  // The app's styles, as the dialog renders for a person: its open animation and the preview's
  // pulsing placeholder draw frames. Unstyled, a headless page draws none after the click, and
  // the screenshot's encode waits about a second for an idle period.
  const css = process.env.WERKFLOW_UI_CONTRACT_CSS;
  if (!css) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.addStyleTag({ path: css });
  return puts;
}

async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'Problem melden', exact: true }).click();
  return expectDialogReady(page);
}

/** The open report dialog once its screenshot preview is drawn. */
async function expectDialogReady(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Problem melden', exact: true });
  await expect(
    dialog.getByRole('img', { name: 'Vorschau des Screenshots mit deinen Schwärzungen' }),
  ).toBeVisible();
  return dialog;
}

type StoredScreenshot = { width: number; height: number; pixels: number[][] };

/** The stored screenshot's size, and its colour at each point, given as fractions of its width and height. */
async function storedScreenshot(
  page: Page,
  puts: StoredPut[],
  points: [number, number][],
): Promise<StoredScreenshot> {
  const screenshot = puts.find((put) => put.kind === 'screenshot');
  if (!screenshot) throw new Error('No screenshot reached storage.');
  return page.evaluate(
    async ({ bytes, points }) => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No 2D context.');
      context.drawImage(image, 0, 0);
      return {
        width: image.width,
        height: image.height,
        pixels: points.map(([x, y]) => [
          ...context
            .getImageData(Math.floor(image.width * x), Math.floor(image.height * y), 1, 1)
            .data.slice(0, 3),
        ]),
      };
    },
    { bytes: [...screenshot.body], points },
  );
}

async function storedScreenshotPixels(
  page: Page,
  puts: StoredPut[],
  points: [number, number][],
): Promise<number[][]> {
  return (await storedScreenshot(page, puts, points)).pixels;
}

type Rgb = [number, number, number];

/** The cover's two colours as the page's tokens give them, read the way the canvas reads them. */
function coverColors(page: Page): Promise<{ base: Rgb; stripe: Rgb }> {
  return page.evaluate(() => {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('No 2D context.');
    const style = getComputedStyle(document.documentElement);
    const rgb = (name: string): [number, number, number] => {
      context.fillStyle = style.getPropertyValue(name).trim();
      const hex = String(context.fillStyle);
      const channel = (start: number) => Number.parseInt(hex.slice(start, start + 2), 16);
      return [channel(1), channel(3), channel(5)];
    };
    return { base: rgb('--brand-purple-deep'), stripe: rgb('--brand-purple-light') };
  });
}

/**
 * Whether a pixel is one of the cover's colours or a mix of only those two, as
 * a stripe's smoothed edge draws it: it lies on the line between them, within
 * the PNG's rounding.
 */
function isCoverPixel(pixel: readonly number[], { base, stripe }: { base: Rgb; stripe: Rgb }): boolean {
  const channels = base.map((from, index) => ({
    from,
    span: (stripe[index] ?? 0) - from,
    value: pixel[index] ?? Number.NaN,
  }));
  const length = channels.reduce((sum, { span }) => sum + span * span, 0);
  const projected = channels.reduce((sum, { from, span, value }) => sum + (value - from) * span, 0) / length;
  const share = Math.min(Math.max(projected, 0), 1);
  return channels.every(({ from, span, value }) => Math.abs(from + share * span - value) <= 3);
}

/** Drags with the mouse across a canvas, between two points given as fractions of its drawn box. */
async function dragAcross(page: Page, canvas: Locator, from: [number, number], to: [number, number]) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The canvas has no box.');
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 4 });
  await page.mouse.up();
}

/** Opens the large view from the dialog's „Vergrößern“. */
async function openLargeView(page: Page, dialog: Locator) {
  await dialog.getByRole('button', { name: 'Vergrößern', exact: true }).click();
  const view = page.getByRole('dialog', { name: 'Screenshot schwärzen', exact: true });
  const canvas = view.getByRole('img', { name: 'Großer Screenshot mit deinen Schwärzungen', exact: true });
  await expect(canvas).toBeVisible();
  return { view, canvas };
}

async function sendWithDescription(page: Page, dialog: Locator, description: string) {
  await dialog.getByRole('textbox', { name: 'Was ist passiert?', exact: true }).fill(description);
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(
    page.getByRole('alert').getByText('Danke! Deine Meldung Nr. 7 ist eingegangen.'),
  ).toBeVisible();
}

function boundary(page: Page) {
  return page.evaluate(() => ({
    submissions: window.uiContractProblemReport.submissions,
    tickets: window.uiContractProblemReport.tickets,
    registered: window.uiContractProblemReport.registered,
  }));
}

test('an empty description marks the field, focuses it and sends nothing', async ({ page }) => {
  await openReportFixture(page);
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  const description = dialog.getByRole('textbox', { name: 'Was ist passiert?', exact: true });
  await expect(description).toBeFocused();
  await expect(description).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByText('Beschreibe kurz, was passiert ist.')).toBeVisible();
  expect((await boundary(page)).submissions).toEqual([]);
});

test('a text-only report sends no screenshot', async ({ page }) => {
  const puts = await openReportFixture(page);
  const dialog = await openDialog(page);
  await dialog.getByRole('checkbox', { name: 'Screenshot mitsenden' }).click();
  await expect(
    dialog.getByRole('img', { name: 'Vorschau des Screenshots mit deinen Schwärzungen' }),
  ).toBeHidden();
  await dialog
    .getByRole('textbox', { name: 'Was ist passiert?', exact: true })
    .fill('Die Liste bleibt leer.');
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(
    page.getByRole('alert').getByText('Danke! Deine Meldung Nr. 7 ist eingegangen.'),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  const state = await boundary(page);
  expect(state.submissions.map((submission) => submission.description)).toEqual(['Die Liste bleibt leer.']);
  expect(state.tickets).toEqual([]);
  expect(puts).toEqual([]);
});

test('a redaction box is burned into the uploaded image', async ({ page }) => {
  const puts = await openReportFixture(page);
  const dialog = await openDialog(page);
  const preview = dialog.getByRole('img', { name: 'Vorschau des Screenshots mit deinen Schwärzungen' });
  // From a quarter to three quarters of the width, and from a quarter to half the height.
  await dragAcross(page, preview, [0.25, 0.25], [0.75, 0.5]);
  await sendWithDescription(page, dialog, 'Der Knopf reagiert nicht.');

  expect((await boundary(page)).registered).toEqual(['screenshot']);
  const [inside, outside] = await storedScreenshotPixels(page, puts, [
    [0.5, 0.375],
    [0.5, 0.75],
  ]);
  expect(isCoverPixel(inside ?? [], await coverColors(page))).toBe(true);
  expect(outside).toEqual([255, 255, 255]);
});

for (const viewport of [
  { name: 'a laptop', width: 1280, height: 800 },
  { name: 'a phone', width: 375, height: 667 },
]) {
  test(`a box drawn on the large view covers exactly that area of the full-size upload, on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const puts = await openReportFixture(page);
    const dialog = await openDialog(page);
    const { view, canvas } = await openLargeView(page, dialog);
    // The view shows the image scaled, so a pointer read as image pixels would miss the area.
    const shown = await canvas.boundingBox();
    expect(shown && Math.abs(shown.width - viewport.width)).toBeGreaterThan(20);
    await dragAcross(page, canvas, [0.3, 0.3], [0.7, 0.6]);
    await view.getByRole('button', { name: 'Fertig', exact: true }).click();
    await expect(view).toBeHidden();
    await sendWithDescription(page, dialog, 'Die Adresse soll niemand sehen.');

    const inside: [number, number][] = [
      [0.31, 0.31],
      [0.69, 0.59],
      [0.5, 0.45],
    ];
    const outside: [number, number][] = [
      [0.29, 0.45],
      [0.71, 0.45],
      [0.5, 0.29],
      [0.5, 0.61],
    ];
    const stored = await storedScreenshot(page, puts, [...inside, ...outside]);
    // The redraw's full size: one image pixel per CSS pixel of the window.
    expect({ width: stored.width, height: stored.height }).toEqual({
      width: viewport.width,
      height: viewport.height,
    });
    const colors = await coverColors(page);
    expect(stored.pixels.slice(0, inside.length).map((pixel) => isCoverPixel(pixel, colors))).toEqual(
      inside.map(() => true),
    );
    expect(stored.pixels.slice(inside.length)).toEqual(outside.map(() => [255, 255, 255]));
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the cover lets nothing of the page through, only its own two colours, in ${colorScheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    const puts = await openReportFixture(page);
    // A probe colour no cover colour mixes into: anything of it inside the box came from the page.
    await page.evaluate(() => {
      window.uiContractProblemReport.pageColor = 'lime';
    });
    const dialog = await openDialog(page);
    const { view, canvas } = await openLargeView(page, dialog);
    await dragAcross(page, canvas, [0.2, 0.2], [0.8, 0.8]);
    await view.getByRole('button', { name: 'Fertig', exact: true }).click();
    await sendWithDescription(page, dialog, 'Hier steht ein Name.');

    const screenshot = puts.find((put) => put.kind === 'screenshot');
    if (!screenshot) throw new Error('No screenshot reached storage.');
    // Every pixel well inside the drawn box, and the probe just outside it.
    const { inner, probe } = await page.evaluate(
      async (bytes) => {
        const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No 2D context.');
        context.drawImage(image, 0, 0);
        const left = Math.ceil(image.width * 0.21);
        const top = Math.ceil(image.height * 0.21);
        const data = context.getImageData(
          left,
          top,
          Math.floor(image.width * 0.58),
          Math.floor(image.height * 0.58),
        ).data;
        const inner: number[][] = [];
        for (let index = 0; index < data.length; index += 4)
          inner.push([data[index] ?? -1, data[index + 1] ?? -1, data[index + 2] ?? -1]);
        return { inner, probe: [...context.getImageData(2, 2, 1, 1).data.slice(0, 3)] };
      },
      [...screenshot.body],
    );
    expect(probe).toEqual([0, 255, 0]);
    const colors = await coverColors(page);
    const leaks = inner.filter((pixel) => !isCoverPixel(pixel, colors));
    expect(leaks.slice(0, 5)).toEqual([]);
    // Both colours show: the pattern is drawn, not one flat fill.
    expect(inner.some((pixel) => pixel.every((value, index) => value === colors.base[index]))).toBe(true);
    expect(inner.some((pixel) => pixel.every((value, index) => value === colors.stripe[index]))).toBe(true);
  });
}

test('a cover colour that is not opaque gives way to black, so the page still never shows through', async ({
  page,
}) => {
  const puts = await openReportFixture(page);
  await page.evaluate(() => {
    window.uiContractProblemReport.pageColor = 'lime';
    document.documentElement.style.setProperty('--brand-purple-deep', 'rgb(62 54 89 / 40%)');
  });
  const dialog = await openDialog(page);
  const { view, canvas } = await openLargeView(page, dialog);
  await dragAcross(page, canvas, [0.2, 0.2], [0.8, 0.8]);
  await view.getByRole('button', { name: 'Fertig', exact: true }).click();
  await sendWithDescription(page, dialog, 'Hier steht eine Telefonnummer.');

  const { stripe } = await coverColors(page);
  const { pixels } = await storedScreenshot(page, puts, [
    [0.3, 0.3],
    [0.4, 0.5],
    [0.5, 0.5],
    [0.6, 0.7],
  ]);
  expect(pixels.filter((pixel) => !isCoverPixel(pixel, { base: [0, 0, 0], stripe }))).toEqual([]);
});

test('the large view opens from the keyboard, and Escape closes only it and returns to its button', async ({
  page,
}) => {
  await openReportFixture(page);
  const dialog = await openDialog(page);
  const enlarge = dialog.getByRole('button', { name: 'Vergrößern', exact: true });
  await enlarge.focus();
  await page.keyboard.press('Enter');
  const view = page.getByRole('dialog', { name: 'Screenshot schwärzen', exact: true });
  await expect(view.getByRole('img', { name: 'Großer Screenshot mit deinen Schwärzungen' })).toBeVisible();
  // Focus starts on the view, not on a button one Enter would act on.
  await expect(view).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(view).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(enlarge).toBeFocused();
});

test('on a phone, boxes drawn by touch on the large view reach the upload, and „Rückgängig“ takes back only the last', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const puts = await openReportFixture(page);
  const dialog = await openDialog(page);
  const { view, canvas } = await openLargeView(page, dialog);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The canvas has no box.');
  const touch = await page.context().newCDPSession(page);
  const swipe = async (from: [number, number], to: [number, number]) => {
    const at = ([x, y]: [number, number]) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(from)] });
    for (const step of [0.25, 0.5, 0.75, 1]) {
      const point: [number, number] = [
        from[0] + (to[0] - from[0]) * step,
        from[1] + (to[1] - from[1]) * step,
      ];
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(point)] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe([0.1, 0.1], [0.4, 0.3]);
  await swipe([0.6, 0.7], [0.9, 0.9]);
  await view.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await view.getByRole('button', { name: 'Fertig', exact: true }).click();
  await sendWithDescription(page, dialog, 'Zwei Stellen, eine bleibt.');

  const [kept, removed] = await storedScreenshotPixels(page, puts, [
    [0.25, 0.2],
    [0.75, 0.8],
  ]);
  expect(isCoverPixel(kept ?? [], await coverColors(page))).toBe(true);
  expect(removed).toEqual([255, 255, 255]);
});

test('the report row in the phone menu closes the menu first, so the screenshot shows the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const puts = await openReportFixture(page);
  await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click();
  const menu = page.getByRole('complementary');
  await menu.getByRole('button', { name: 'Problem melden', exact: true }).click();
  const dialog = await expectDialogReady(page);
  await dialog.getByRole('textbox', { name: 'Was ist passiert?', exact: true }).fill('Das Menü hängt.');
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(
    page.getByRole('alert').getByText('Danke! Deine Meldung Nr. 7 ist eingegangen.'),
  ).toBeVisible();
  // Read once the dialog is gone: while it is open, it hides the rest of the page from roles.
  await expect(menu).toHaveCount(0);
  // The stub redraw draws an open menu as a black box over the page's left side.
  const [underMenu] = await storedScreenshotPixels(page, puts, [[0.25, 0.5]]);
  expect(underMenu).toEqual([255, 255, 255]);
});

test('the context keeps a control label only when the app names it, and routes only as templates', async ({
  page,
}) => {
  await openReportFixture(page);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Musterbau Nord GmbH', exact: true }).click();
  const dialog = await openDialog(page);
  await dialog.getByRole('checkbox', { name: 'Screenshot mitsenden' }).click();
  await dialog.getByRole('textbox', { name: 'Was ist passiert?', exact: true }).fill('Speichern geht nicht.');
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(
    page.getByRole('alert').getByText('Danke! Deine Meldung Nr. 7 ist eingegangen.'),
  ).toBeVisible();

  const [submission] = (await boundary(page)).submissions;
  expect(submission?.context.routeTemplate).toBe('/auftraege/[jobNumber]');
  expect(submission?.context.recentActions).toEqual([
    { routeTemplate: '/auftraege/[jobNumber]', controlLabel: null },
    { routeTemplate: '/auftraege/[jobNumber]', controlLabel: 'Speichern' },
    { routeTemplate: '/auftraege/[jobNumber]', controlLabel: null },
    { routeTemplate: '/auftraege/[jobNumber]', controlLabel: 'Problem melden' },
  ]);
  // The build's commit, shortened to twelve characters.
  expect(submission?.context.appVersion).toBe('contract-bui');
  expect(JSON.stringify(submission?.context)).not.toContain('Musterbau');
});

test('the send shows its pending state in the first frame, and neither cancel, the list link nor the attachments change until the answer', async ({
  page,
}) => {
  await openReportFixture(page);
  await page.evaluate(() => {
    window.uiContractProblemReport.holdSubmission = true;
  });
  const dialog = await openDialog(page);
  await dialog.getByRole('checkbox', { name: 'Screenshot mitsenden' }).click();
  await dialog.getByRole('textbox', { name: 'Was ist passiert?', exact: true }).fill('Es lädt ewig.');
  const send = dialog.getByRole('button', { name: 'Senden', exact: true });
  await send.click();
  await expect(send).toHaveAttribute('aria-busy', 'true');
  // Neither control leaves the dialog while its answer is out, and the attachments it sends stay as they are.
  await expect(dialog.getByRole('button', { name: 'Abbrechen', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Anhänge' })).toBeDisabled();
  await dialog.getByRole('link', { name: 'Meine Meldungen' }).click();
  await expect(dialog).toBeVisible();
  // The held submission has reached the boundary: releasing it before then would do nothing.
  await expect
    .poll(() => page.evaluate(() => window.uiContractProblemReport.releaseSubmission !== null))
    .toBe(true);
  await page.evaluate(() => {
    const release = window.uiContractProblemReport.releaseSubmission;
    if (!release) throw new Error('No submission is held.');
    release();
  });
  await expect(
    page.getByRole('alert').getByText('Danke! Deine Meldung Nr. 7 ist eingegangen.'),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
});

test('F2 opens the report dialog from the keyboard, and Escape returns to where the person was', async ({
  page,
}) => {
  await openReportFixture(page);
  const working = page.getByRole('button', { name: 'Speichern', exact: true });
  await working.focus();
  await page.keyboard.press('F2');
  const dialog = await expectDialogReady(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(working).toBeFocused();
});

async function chooseAttachment(
  page: Page,
  dialog: ReturnType<Page['getByRole']>,
  name: string,
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Anhänge' }).click();
  await (
    await chooser
  ).setFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 vertrag') });
  await expect(dialog.getByText(name, { exact: true })).toBeVisible();
}

test('a failed attachment keeps the saved report and its sent screenshot, and the retry sends only the attachment', async ({
  page,
}) => {
  const puts = await openReportFixture(page);
  await page.unroute('http://localhost/storage/**');
  let attachmentPuts = 0;
  await page.route('http://localhost/storage/**', async (route) => {
    const kind = new URL(route.request().url()).pathname.split('/')[2] ?? '';
    puts.push({ kind, body: Buffer.alloc(0) });
    if (kind === 'anhang' && (attachmentPuts += 1) === 1) await route.fulfill({ status: 503, body: '' });
    else await route.fulfill({ status: 200, body: '' });
  });
  const dialog = await openDialog(page);
  await chooseAttachment(page, dialog, 'aufmass.pdf');
  await dialog.getByRole('textbox', { name: 'Was ist passiert?', exact: true }).fill('Der Plan fehlt.');
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(
    dialog.getByText('Deine Meldung Nr. 7 ist gespeichert, aber „aufmass.pdf“ fehlt noch.', { exact: false }),
  ).toBeVisible();
  // The sent screenshot no longer changes: no switch, no box can change what storage holds.
  await expect(dialog.getByRole('checkbox', { name: 'Screenshot mitsenden' })).toBeDisabled();
  await expect(dialog.getByRole('textbox', { name: 'Was ist passiert?', exact: true })).toHaveAttribute(
    'readonly',
    '',
  );

  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(
    page.getByRole('alert').getByText('Danke! Deine Meldung Nr. 7 ist eingegangen.'),
  ).toBeVisible();
  const state = await boundary(page);
  expect(state.submissions).toHaveLength(1);
  expect(state.tickets).toEqual(['screenshot', 'anhang', 'anhang']);
  expect(state.registered).toEqual(['screenshot', 'anhang']);
});

test('a registration whose answer got lost counts once on the retry, under the same file', async ({
  page,
}) => {
  await openReportFixture(page);
  await page.evaluate(() => {
    window.uiContractProblemReport.loseFinalizeAnswer = ['screenshot'];
  });
  const dialog = await openDialog(page);
  await dialog
    .getByRole('textbox', { name: 'Was ist passiert?', exact: true })
    .fill('Das Bild kam nicht an.');
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(
    dialog.getByText('Deine Meldung Nr. 7 ist gespeichert, aber der Screenshot fehlt noch.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Screenshot mitsenden' })).toBeDisabled();
  // Its bytes left the device, so the preview takes no new box that storage would lack.
  const preview = dialog.getByRole('img', { name: 'Vorschau des Screenshots mit deinen Schwärzungen' });
  const pixels = () =>
    preview.evaluate((canvas) => (canvas instanceof HTMLCanvasElement ? canvas.toDataURL() : ''));
  const before = await pixels();
  const box = await preview.boundingBox();
  if (!box) throw new Error('The preview has no box.');
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 4 });
  await page.mouse.up();
  expect(await pixels()).toBe(before);
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(
    page.getByRole('alert').getByText('Danke! Deine Meldung Nr. 7 ist eingegangen.'),
  ).toBeVisible();
  const state = await boundary(page);
  expect(state.tickets).toEqual(['screenshot']);
  expect(state.registered).toEqual(['screenshot']);
});

test('a save whose outcome is unknown keeps the description frozen through a failed retry, and the report saves once', async ({
  page,
}) => {
  await openReportFixture(page);
  await page.evaluate(() => {
    window.uiContractProblemReport.submitAnswers = ['lost', 'refused'];
  });
  const dialog = await openDialog(page);
  await dialog.getByRole('checkbox', { name: 'Screenshot mitsenden' }).click();
  const description = dialog.getByRole('textbox', { name: 'Was ist passiert?', exact: true });
  await description.fill('Keine Verbindung.');
  const send = dialog.getByRole('button', { name: 'Senden', exact: true });
  const maybeSaved = dialog.getByText(
    'Deine Meldung kam vielleicht nicht an. Prüfe deine Verbindung und tippe noch einmal auf „Senden“. Die Beschreibung bleibt dafür, wie sie ist.',
  );
  // A lost answer, then a server failure: either save may have stored the description.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await send.click();
    await expect(maybeSaved).toBeVisible();
    await expect(description).toHaveAttribute('readonly', '');
    await expect(send).toBeEnabled();
  }
  await send.click();
  await expect(
    page.getByRole('alert').getByText('Danke! Deine Meldung Nr. 7 ist eingegangen.'),
  ).toBeVisible();
  const { submissions } = await boundary(page);
  expect(submissions).toHaveLength(3);
  expect(new Set(submissions.map((submission) => submission.reportId)).size).toBe(1);
});

test('a screenshot over its size limit says to send without it, and the report then saves without one', async ({
  page,
}) => {
  await openReportFixture(page);
  await page.evaluate(() => {
    window.uiContractProblemReport.refuseTicketOnce = { screenshot: 'file_too_large' };
  });
  const dialog = await openDialog(page);
  await dialog.getByRole('textbox', { name: 'Was ist passiert?', exact: true }).fill('Das Bild ist riesig.');
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(
    dialog.getByText(
      'Deine Meldung Nr. 7 ist gespeichert, aber der Screenshot fehlt noch. Der Screenshot ist zu groß. Entferne den Haken bei „Screenshot mitsenden“ und sende noch einmal.',
    ),
  ).toBeVisible();
  // Nothing of the refused screenshot stayed stored, so its switch still follows the advice.
  const include = dialog.getByRole('checkbox', { name: 'Screenshot mitsenden' });
  await expect(include).toBeEnabled();
  await include.click();
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(
    page.getByRole('alert').getByText('Danke! Deine Meldung Nr. 7 ist eingegangen.'),
  ).toBeVisible();
  const state = await boundary(page);
  expect(state.submissions).toHaveLength(1);
  expect(state.registered).toEqual([]);
});

test('a screenshot whose first registration commits while its retry uploads anew counts as sent', async ({
  page,
}) => {
  await openReportFixture(page);
  // The first finalize registers, but its answer is lost; the retry then finds the staging key
  // gone, uploads again under a new id, and that registration meets the first screenshot.
  await page.evaluate(() => {
    window.uiContractProblemReport.loseFinalizeAnswer = ['screenshot'];
    window.uiContractProblemReport.finalizeMissingOnce = ['screenshot'];
  });
  const dialog = await openDialog(page);
  await dialog.getByRole('textbox', { name: 'Was ist passiert?', exact: true }).fill('Doppelt gesendet.');
  const send = dialog.getByRole('button', { name: 'Senden', exact: true });
  await send.click();
  await expect(
    dialog.getByText('Deine Meldung Nr. 7 ist gespeichert, aber der Screenshot fehlt noch.', {
      exact: false,
    }),
  ).toBeVisible();
  await send.click();
  await expect(
    page.getByRole('alert').getByText('Danke! Deine Meldung Nr. 7 ist eingegangen.'),
  ).toBeVisible();
  const state = await boundary(page);
  expect(state.tickets).toEqual(['screenshot', 'screenshot']);
  expect(state.registered).toEqual(['screenshot']);
});
