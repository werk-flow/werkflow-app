import { expect, test, type Page } from '@playwright/test';
import type { burnRedactions } from '@/lib/problem-reports/redaction';
import type { loadUiStringCatalog } from '@/lib/problem-reports/screenshot/load-ui-string-catalog';
import type { redrawPage } from '@/lib/problem-reports/screenshot/redraw-page';
import type { pageToSvg, rasterizeSvg } from '@/lib/problem-reports/screenshot/rasterize';
import type { redrawScreenshot } from '@/lib/problem-reports/screenshot/redraw-screenshot';
import { buildRedrawForBrowserTest } from '@/lib/problem-reports/screenshot/browser-test-bundle';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

type RedrawPageModule = { redrawPage: typeof redrawPage };
type CatalogModule = { loadUiStringCatalog: typeof loadUiStringCatalog };
type ScreenshotModule = { redrawScreenshot: typeof redrawScreenshot };
type RasterizeModule = { pageToSvg: typeof pageToSvg };
type RasterizeSvgModule = { rasterizeSvg: typeof rasterizeSvg };
type RedactionModule = { burnRedactions: typeof burnRedactions };

// Rule tests of the screenshot redraw (docs/technical/problem-report-scrubbing.md),
// one per rule, on a synthetic page of a made-up company. Each test reads the
// detached clone the redraw builds; the class names stay verbatim, so they
// locate an element in the clone.

const ORIGIN = 'http://localhost';
const SEEDED = {
  company: 'Musterbau Nord GmbH',
  person: 'Erika Musterfrau',
  street: 'Lindenallee 17',
  place: '24999 Musterhafen',
  phone: '+49 4321 987654',
  email: 'erika@musterbau-nord.example',
  note: 'Heizung im Keller tropft seit Montag',
  typed: 'Jonas Beispielmann',
} as const;
const SEEDED_SOURCES = [
  '/photos/erika-musterfrau.jpg',
  '/photos/heizraum.webp',
  '/photos/heizraum.jpg',
  '/photos/baustelle-poster.jpg',
  '/videos/baustelle.mp4',
  '/maps/lindenallee.png',
  '/photos/avatar-erika.png',
  '/maps/embed',
] as const;

const PAGE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
body{font-family:sans-serif;margin:0;padding:16px} .block{width:40px;height:30px}
</style>
<style>.css-record::before{content:"${SEEDED.person}"} .css-image{background-image:url("data:image/png;base64,iVBORw0KGgo=")} .css-var{--seeded:"${SEEDED.street}"} .css-escape{--photo:\\75rl(data:image/gif;base64,R0lGODlhRUNTSEVFVA==);background-image:var(--photo)}</style>
<style media="print">.print-only{color:rgb(9, 8, 7)}</style>
<style id="switched-off">.disabled-only{color:rgb(7, 6, 5)}</style>
<link rel="stylesheet" href="/_next/static/css/app.css"><link rel="stylesheet" href="/dynamic/record.css">
</head><body><main>
<h1 class="ui-heading">Aufträge</h1>
<p class="record-text">${SEEDED.company}</p>
<p class="lone-city">Hamburg</p>
<p class="lone-surname">Mustermann</p>
<p class="record-sentence">Speichern bei ${SEEDED.person}</p>
<address class="record-address">${SEEDED.street}, ${SEEDED.place}</address>
<a class="record-phone" href="tel:${SEEDED.phone}">${SEEDED.phone}</a>
<a class="record-email" href="mailto:${SEEDED.email}">${SEEDED.email}</a>
<button class="ui-button" title="${SEEDED.person} anrufen" aria-label="Speichern">Speichern</button>
<span class="record-data" data-customer="${SEEDED.company}" aria-description="${SEEDED.street}">x</span>
<input class="ui-placeholder" placeholder="Abbrechen"><input class="record-placeholder" placeholder="${SEEDED.person}">
<img class="block photo" alt="Foto ${SEEDED.person}" src="/photos/erika-musterfrau.jpg">
<picture class="picture"><source srcset="/photos/heizraum.webp"><img class="block" src="/photos/heizraum.jpg" alt="Heizraum"></picture>
<canvas class="block signature" role="img" aria-label="Unterschrift" width="40" height="30"></canvas>
<video class="block video" poster="/photos/baustelle-poster.jpg" src="/videos/baustelle.mp4"></video>
<svg class="svg-text" width="40" height="30"><text x="0" y="20">${SEEDED.street}</text></svg>
<svg class="svg-image" width="40" height="30"><image href="/maps/lindenallee.png" width="40" height="30"/></svg>
<svg class="icon" width="24" height="24" viewBox="0 0 24 24"><path d="M4 4L20 20" stroke="currentColor"/></svg>
<div class="escaped" style="--avatar:\\75rl(data:image/gif;base64,R0lGODlhSU5MSU5F);background-image:var(--avatar)">x</div>
<div class="background" style="background-image:url('/photos/avatar-erika.png');color:rgb(1, 2, 3)">Abbrechen</div>
<iframe class="map" src="/maps/embed?q=${SEEDED.street}" title="Karte ${SEEDED.street}"></iframe>
<form>
<input class="ui-value" value="Speichern">
<input class="typed-value" aria-label="Eingabe">
<textarea class="note">${SEEDED.note}</textarea>
<select class="choice"><option>${SEEDED.company}</option><option selected>Abbrechen</option></select>
<div class="editable" contenteditable="true">Abbrechen</div>
<div class="editable-upper" contenteditable="TRUE">Speichern</div>
<select class="labelled"><option label="Speichern" value="Abbrechen">x</option></select>
<input class="hidden-value" type="hidden" value="${SEEDED.person}">
<input class="ticked" type="checkbox" checked>
</form>
<div class="scroller" style="height:40px;width:200px;overflow:auto"><div class="scroll-child" style="height:200px;width:2000px">Abbrechen</div><div class="scroll-moved" style="translate:5px 6px;height:10px">x</div></div>
<div class="spacer" style="height:2000px"></div>
<div class="pixel-probe" style="position:fixed;left:0;top:0;width:24px;height:24px;background-color:rgb(10, 200, 30)"></div>
<div class="theme-probe" style="position:fixed;left:32px;top:0;width:24px;height:24px"></div>
</main></body></html>`;

// A build asset keeps its CSS verbatim; a sheet outside the build gets the style rule.
const SERVED: Record<string, { contentType: string; body: string }> = {
  '/redraw-page': { contentType: 'text/html', body: PAGE },
  '/_next/static/css/app.css': {
    contentType: 'text/css',
    // The app's theme: tokens on the root, flipped for dark mode by a media rule, as app/globals.css does.
    // The probe's own variant nests its media rule in a style rule, as a compiled `dark:` class may.
    body:
      '@import url("/_next/static/css/print.css") print;\n.brand{font-family:"Geist Probe"}\n' +
      ':root{--theme-surface:rgb(240, 240, 240)}\n' +
      '@media (prefers-color-scheme: dark){:root{--theme-surface:rgb(20, 20, 30)}}\n' +
      'body{background-color:var(--theme-surface)}\n' +
      '.theme-probe{background-color:rgb(240, 240, 240);@media (prefers-color-scheme: dark){background-color:rgb(20, 20, 30)}}',
  },
  '/_next/static/css/print.css': { contentType: 'text/css', body: '.imported-print{color:rgb(6, 5, 4)}' },
  '/dynamic/record.css': {
    contentType: 'text/css',
    body: `.linked-record::after{content:"${SEEDED.company}"}`,
  },
};

let modules: ReadonlyMap<string, string> = new Map();

test.beforeAll(() => {
  modules = buildRedrawForBrowserTest();
});

async function openSyntheticPage(page: Page): Promise<void> {
  assertWorkspaceTestLock();
  await page.route(`${ORIGIN}/redraw/**`, (route) => {
    const name = new URL(route.request().url()).pathname.replace('/redraw/', '');
    const code = modules.get(name);
    return code
      ? route.fulfill({ contentType: 'text/javascript', body: code })
      : route.fulfill({ status: 404, body: '' });
  });
  // Every other request fails: a seeded source the redraw fetched would show up as a request.
  await page.route(`${ORIGIN}/**`, (route) => {
    const served = SERVED[new URL(route.request().url()).pathname];
    return served ? route.fulfill(served) : route.fallback();
  });
  await page.goto(`${ORIGIN}/redraw-page`);
  await page.getByRole('textbox', { name: 'Eingabe' }).fill(SEEDED.typed);
}

/** Redraws the page and returns the clone serialized, plus the text and attributes of each located element. */
async function redraw(page: Page): Promise<{ markup: string; texts: Record<string, string> }> {
  return page.evaluate(async () => {
    const isPageModule = (value: unknown): value is RedrawPageModule =>
      typeof value === 'object' && value !== null && 'redrawPage' in value;
    const isCatalogModule = (value: unknown): value is CatalogModule =>
      typeof value === 'object' && value !== null && 'loadUiStringCatalog' in value;
    const paths = ['/redraw/redraw-page.js', '/redraw/load-ui-string-catalog.js'];
    const loaded: unknown[] = await Promise.all(paths.map((path) => import(path)));
    const [pageModule, catalogModule] = loaded;
    if (!isPageModule(pageModule) || !isCatalogModule(catalogModule))
      throw new Error('The redraw bundle is incomplete.');
    const clone = pageModule.redrawPage(document, catalogModule.loadUiStringCatalog(), Math.random).root;
    const texts: Record<string, string> = {};
    for (const element of Array.from(clone.querySelectorAll('[class]'))) {
      texts[element.getAttribute('class') ?? ''] = element.textContent ?? '';
    }
    return { markup: new XMLSerializer().serializeToString(clone), texts };
  });
}

function shapeOf(text: string): string {
  return text.replace(/\p{L}/gu, 'a').replace(/\p{Nd}/gu, '9');
}

test('text rule: a text that is not a UI string becomes a fake of the same shape', async ({ page }) => {
  await openSyntheticPage(page);
  const { texts } = await redraw(page);
  expect(texts['ui-heading'], 'a UI string stays readable').toBe('Aufträge');
  expect(texts['ui-button']).toBe('Speichern');
  for (const [element, original] of [
    ['record-text', SEEDED.company],
    ['record-address', `${SEEDED.street}, ${SEEDED.place}`],
    ['record-phone', SEEDED.phone],
  ] as const) {
    const fake = texts[element] ?? '';
    expect(fake, `${element} is faked`).not.toBe(original);
    expect(shapeOf(fake), `${element} keeps its shape`).toBe(shapeOf(original));
    [...original].forEach((character, index) => {
      if (/\p{Nd}/u.test(character))
        expect(fake[index], `digit ${index} of ${element} changes`).not.toBe(character);
    });
  }
});

test('catalog rule: a lone city and a lone example surname are faked', async ({ page }) => {
  await openSyntheticPage(page);
  const { texts } = await redraw(page);
  expect(texts['lone-city'], 'a federal state name from a data list is no UI string').not.toBe('Hamburg');
  expect(texts['lone-surname'], 'a placeholder example name is no UI string').not.toBe('Mustermann');
  expect(shapeOf(texts['lone-surname'] ?? '')).toBe(shapeOf('Mustermann'));
});

test('whole-node match: a UI string inside a longer record text is still faked', async ({ page }) => {
  await openSyntheticPage(page);
  const { texts } = await redraw(page);
  const fake = texts['record-sentence'] ?? '';
  expect(fake).not.toContain('Speichern');
  expect(shapeOf(fake)).toBe(shapeOf(`Speichern bei ${SEEDED.person}`));
});

test('form value rule: every form value is faked, whatever its text', async ({ page }) => {
  await openSyntheticPage(page);
  const { markup, texts } = await redraw(page);
  expect(markup, 'a UI string as an input value is faked').not.toMatch(/value="Speichern"/u);
  expect(markup, 'a typed value is faked').not.toContain(SEEDED.typed);
  expect(markup).toMatch(/class="typed-value"[^>]* value="[^"]+"/u);
  expect(texts.note, 'a textarea is faked').not.toBe(SEEDED.note);
  expect(shapeOf(texts.note ?? '')).toBe(shapeOf(SEEDED.note));
  expect(texts.choice, 'select options are faked').not.toContain('Abbrechen');
  expect(texts.editable, 'contenteditable text is faked').not.toBe('Abbrechen');
  expect(texts['editable-upper'], 'an upper-case contenteditable value is a form value').not.toBe(
    'Speichern',
  );
  expect(markup, 'an option label is faked').not.toMatch(/<option label="Speichern"|value="Abbrechen"/u);
  expect(markup, 'a hidden input is dropped').not.toContain('hidden-value');
  expect(markup, 'a checked box stays checked').toMatch(/class="ticked" type="checkbox" checked=""/u);
});

test('attribute rule: text attributes follow the text rule and links are dropped', async ({ page }) => {
  await openSyntheticPage(page);
  const { markup } = await redraw(page);
  expect(markup, 'a UI string attribute stays').toContain('aria-label="Speichern"');
  expect(markup).toContain('placeholder="Abbrechen"');
  expect(markup, 'a title with record data is faked').not.toContain(`${SEEDED.person} anrufen`);
  expect(markup, 'a data attribute is faked').not.toContain(`data-customer="${SEEDED.company}"`);
  expect(markup).not.toContain(`placeholder="${SEEDED.person}"`);
  expect(markup, 'links are dropped').not.toMatch(/href=|tel:|mailto:/u);
});

test('media rule: images, canvas, video and SVG text become neutral blocks', async ({ page }) => {
  await openSyntheticPage(page);
  await page.getByRole('img', { name: 'Unterschrift' }).evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('The signature is not a canvas.');
    canvas.getContext('2d')?.fillText('Erika', 0, 20);
  });
  const { markup } = await redraw(page);
  expect(markup).not.toMatch(/<(img|picture|source|canvas|video|text|image)\b/u);
  for (const element of ['block photo', 'picture', 'block signature', 'block video', 'svg-text', 'svg-image'])
    expect(markup, `${element} is a neutral block`).toContain(`class="${element}" data-redrawn="blocked"`);
  expect(markup, 'an icon of shapes stays').toMatch(/<svg[^>]*class="icon"[^>]*><path /u);
  expect(markup, 'a background image is dropped').not.toContain('url(');
  expect(markup, 'the rest of an inline style stays').toContain('color: rgb(1, 2, 3)');
  for (const source of SEEDED_SOURCES) expect(markup).not.toContain(source);
});

test('style rule: CSS outside the build loses generated text and images, build CSS stays', async ({
  page,
}) => {
  await openSyntheticPage(page);
  const svg = await page.evaluate(async () => {
    const isPageModule = (value: unknown): value is RedrawPageModule =>
      typeof value === 'object' && value !== null && 'redrawPage' in value;
    const isCatalogModule = (value: unknown): value is CatalogModule =>
      typeof value === 'object' && value !== null && 'loadUiStringCatalog' in value;
    const isRasterizeModule = (value: unknown): value is RasterizeModule =>
      typeof value === 'object' && value !== null && 'pageToSvg' in value;
    const paths = ['/redraw/redraw-page.js', '/redraw/load-ui-string-catalog.js', '/redraw/rasterize.js'];
    const loaded: unknown[] = await Promise.all(paths.map((path) => import(path)));
    const [pageModule, catalogModule, rasterizeModule] = loaded;
    if (!isPageModule(pageModule) || !isCatalogModule(catalogModule) || !isRasterizeModule(rasterizeModule))
      throw new Error('The redraw bundle is incomplete.');
    const redrawn = pageModule.redrawPage(document, catalogModule.loadUiStringCatalog(), Math.random);
    return rasterizeModule.pageToSvg(redrawn, document);
  });
  for (const value of [SEEDED.person, SEEDED.street, SEEDED.company])
    expect(svg, `generated text "${value}" is dropped`).not.toContain(value);
  expect(svg, 'an image in a style element is dropped').not.toContain('data:image/png');
  expect(svg, 'an escaped url() in a style element is dropped').not.toContain('R0lGODlhRUNTSEVFVA');
  expect(svg, 'an escaped url() in an inline style is dropped').not.toContain('R0lGODlhSU5MSU5F');
  expect(svg, 'no escape survives').not.toContain('75rl');
  expect(svg, 'a safe rule of a style element stays').toContain('font-family: sans-serif');
  expect(svg, 'a build style sheet stays verbatim').toContain('font-family: "Geist Probe"');
});

test('style rule: a disabled sheet and a sheet for other media stay out of the image', async ({ page }) => {
  await openSyntheticPage(page);
  const svg = await page.evaluate(async () => {
    const isPageModule = (value: unknown): value is RedrawPageModule =>
      typeof value === 'object' && value !== null && 'redrawPage' in value;
    const isCatalogModule = (value: unknown): value is CatalogModule =>
      typeof value === 'object' && value !== null && 'loadUiStringCatalog' in value;
    const isRasterizeModule = (value: unknown): value is RasterizeModule =>
      typeof value === 'object' && value !== null && 'pageToSvg' in value;
    const switchedOff = document.getElementById('switched-off');
    if (!(switchedOff instanceof HTMLStyleElement) || !switchedOff.sheet)
      throw new Error('The test sheet is missing.');
    switchedOff.sheet.disabled = true;
    const paths = ['/redraw/redraw-page.js', '/redraw/load-ui-string-catalog.js', '/redraw/rasterize.js'];
    const loaded: unknown[] = await Promise.all(paths.map((path) => import(path)));
    const [pageModule, catalogModule, rasterizeModule] = loaded;
    if (!isPageModule(pageModule) || !isCatalogModule(catalogModule) || !isRasterizeModule(rasterizeModule))
      throw new Error('The redraw bundle is incomplete.');
    const redrawn = pageModule.redrawPage(document, catalogModule.loadUiStringCatalog(), Math.random);
    return rasterizeModule.pageToSvg(redrawn, document);
  });
  expect(svg, 'a print sheet does not style the screenshot').not.toContain('rgb(9, 8, 7)');
  expect(svg, 'a disabled sheet does not style the screenshot').not.toContain('rgb(7, 6, 5)');
  expect(svg, 'a build sheet imported for print does not style the screenshot').not.toContain('rgb(6, 5, 4)');
  expect(svg, 'an applying sheet still does').toContain('font-family: sans-serif');
});

test('scroll rule: a scrolled container and the scrolled page shift their children in the clone', async ({
  page,
}) => {
  await openSyntheticPage(page);
  const shifts = await page.evaluate(async () => {
    const isPageModule = (value: unknown): value is RedrawPageModule =>
      typeof value === 'object' && value !== null && 'redrawPage' in value;
    const isCatalogModule = (value: unknown): value is CatalogModule =>
      typeof value === 'object' && value !== null && 'loadUiStringCatalog' in value;
    const scroller = document.querySelector('.scroller');
    if (!scroller) throw new Error('The scroller is missing.');
    scroller.scrollTop = 30;
    scroller.scrollLeft = 20;
    window.scrollTo(0, 50);
    const paths = ['/redraw/redraw-page.js', '/redraw/load-ui-string-catalog.js'];
    const loaded: unknown[] = await Promise.all(paths.map((path) => import(path)));
    const [pageModule, catalogModule] = loaded;
    if (!isPageModule(pageModule) || !isCatalogModule(catalogModule))
      throw new Error('The redraw bundle is incomplete.');
    const clone = pageModule.redrawPage(document, catalogModule.loadUiStringCatalog(), Math.random).root;
    const translateOf = (selector: string): string => {
      const element = clone.querySelector(selector);
      return element instanceof HTMLElement ? element.style.translate : '';
    };
    return {
      child: translateOf('.scroll-child'),
      moved: translateOf('.scroll-moved'),
      body: translateOf('body'),
    };
  });
  expect(shifts.child, 'a child moves by the container scroll').toMatch(/-20px.*-30px/u);
  expect(shifts.moved, 'an own translate adds to the scroll shift').toMatch(/-15px.*-24px/u);
  expect(shifts.body, 'the body moves by the page scroll').toMatch(/-50px/u);
});

test('frame rule: iframes are dropped', async ({ page }) => {
  await openSyntheticPage(page);
  const { markup } = await redraw(page);
  expect(markup).not.toMatch(/<iframe|class="map"/u);
});

test('no seeded personal string remains in the clone, and the live page never changes', async ({ page }) => {
  await openSyntheticPage(page);
  const before = await page.evaluate(() => document.documentElement.outerHTML);
  const { markup } = await redraw(page);
  for (const value of Object.values(SEEDED)) expect(markup, value).not.toContain(value);
  for (const source of SEEDED_SOURCES) expect(markup, source).not.toContain(source);
  expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(before);
  await expect(page.getByRole('textbox', { name: 'Eingabe' })).toHaveValue(SEEDED.typed);
});

test('the redraw draws a PNG of the viewport and loads nothing', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await openSyntheticPage(page);
  const loadedBefore = requests.length;
  const image = await page.evaluate(async () => {
    const isScreenshotModule = (value: unknown): value is ScreenshotModule =>
      typeof value === 'object' && value !== null && 'redrawScreenshot' in value;
    const path = '/redraw/redraw-screenshot.js';
    const screenshotModule: unknown = await import(path);
    if (!isScreenshotModule(screenshotModule)) throw new Error('The redraw bundle is incomplete.');
    const blob = await screenshotModule.redrawScreenshot();
    const bitmap = await createImageBitmap(blob);
    // The probe is a fixed 24 px block in the top-left corner; sample its centre.
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The test cannot read the image.');
    context.drawImage(bitmap, 0, 0);
    const probe = Array.from(context.getImageData(12 * devicePixelRatio, 12 * devicePixelRatio, 1, 1).data);
    return { type: blob.type, width: bitmap.width, height: bitmap.height, ratio: devicePixelRatio, probe };
  });
  expect(image.type).toBe('image/png');
  expect(image.width).toBe(900 * image.ratio);
  expect(image.height).toBe(900 * image.ratio);
  expect(image.probe, 'the image shows the page, not a blank canvas').toEqual([10, 200, 30, 255]);
  const loaded = requests.slice(loadedBefore).filter((path) => !path.startsWith('/redraw/'));
  expect(loaded, 'the redraw fetches no seeded source').toEqual([]);
});

/** Redraws the page into its PNG and reads the colour at each point, given in CSS pixels. */
async function redrawnPixels(page: Page, points: readonly [number, number][]): Promise<number[][]> {
  return page.evaluate(async (points) => {
    const isScreenshotModule = (value: unknown): value is ScreenshotModule =>
      typeof value === 'object' && value !== null && 'redrawScreenshot' in value;
    const path = '/redraw/redraw-screenshot.js';
    const screenshotModule: unknown = await import(path);
    if (!isScreenshotModule(screenshotModule)) throw new Error('The redraw bundle is incomplete.');
    const bitmap = await createImageBitmap(await screenshotModule.redrawScreenshot());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The test cannot read the image.');
    context.drawImage(bitmap, 0, 0);
    return points.map(([x, y]) =>
      Array.from(context.getImageData(x * devicePixelRatio, y * devicePixelRatio, 1, 1).data),
    );
  }, points);
}

const SURFACE = { light: [240, 240, 240, 255], dark: [20, 20, 30, 255] } as const;

for (const colorScheme of ['light', 'dark'] as const) {
  test(`theme rule: a page in ${colorScheme} mode is redrawn in ${colorScheme} mode, and loads nothing`, async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(new URL(request.url()).pathname));
    await page.emulateMedia({ colorScheme });
    await openSyntheticPage(page);
    const loadedBefore = requests.length;
    // The theme probe is a fixed 24 px block beside the pixel probe; sample its centre.
    const [probe] = await redrawnPixels(page, [[44, 12]]);
    expect(probe, `the redraw paints the page's ${colorScheme} tokens`).toEqual([...SURFACE[colorScheme]]);
    const loaded = requests.slice(loadedBefore).filter((path) => !path.startsWith('/redraw/'));
    expect(loaded, 'the redraw fetches no seeded source in this theme').toEqual([]);
    const { markup } = await redraw(page);
    for (const value of Object.values(SEEDED)) expect(markup, value).not.toContain(value);
  });
}

/** The page's SVG as the redraw builds it, with the page's size. */
async function redrawnSvg(page: Page): Promise<{ svg: string; width: number; height: number }> {
  return page.evaluate(async () => {
    const isPageModule = (value: unknown): value is RedrawPageModule =>
      typeof value === 'object' && value !== null && 'redrawPage' in value;
    const isCatalogModule = (value: unknown): value is CatalogModule =>
      typeof value === 'object' && value !== null && 'loadUiStringCatalog' in value;
    const isRasterizeModule = (value: unknown): value is RasterizeModule =>
      typeof value === 'object' && value !== null && 'pageToSvg' in value;
    const paths = ['/redraw/redraw-page.js', '/redraw/load-ui-string-catalog.js', '/redraw/rasterize.js'];
    const loaded: unknown[] = await Promise.all(paths.map((path) => import(path)));
    const [pageModule, catalogModule, rasterizeModule] = loaded;
    if (!isPageModule(pageModule) || !isCatalogModule(catalogModule) || !isRasterizeModule(rasterizeModule))
      throw new Error('The redraw bundle is incomplete.');
    const redrawn = pageModule.redrawPage(document, catalogModule.loadUiStringCatalog(), Math.random);
    return {
      svg: await rasterizeModule.pageToSvg(redrawn, document),
      width: redrawn.width,
      height: redrawn.height,
    };
  });
}

test('theme rule: the image shows the page’s theme even where the image itself would answer light', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openSyntheticPage(page);
  const { svg, width, height } = await redrawnSvg(page);
  // An SVG image is a document of its own. A browser may answer its media queries otherwise than
  // the page, as one that draws it light on a page in dark mode: drawn here under a light answer.
  await page.emulateMedia({ colorScheme: 'light' });
  const probe = await page.evaluate(
    async ({ svg, width, height }) => {
      const isRasterizeModule = (value: unknown): value is RasterizeSvgModule =>
        typeof value === 'object' && value !== null && 'rasterizeSvg' in value;
      const path = '/redraw/rasterize.js';
      const rasterizeModule: unknown = await import(path);
      if (!isRasterizeModule(rasterizeModule)) throw new Error('The redraw bundle is incomplete.');
      const blob = await rasterizeModule.rasterizeSvg(
        svg,
        { root: document.documentElement, width, height },
        document,
      );
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('The test cannot read the image.');
      context.drawImage(bitmap, 0, 0);
      return Array.from(context.getImageData(44 * devicePixelRatio, 12 * devicePixelRatio, 1, 1).data);
    },
    { svg, width, height },
  );
  expect(probe, 'the dark tokens the page used reach the image').toEqual([...SURFACE.dark]);
  expect(svg, 'no media rule is left for the image to answer').not.toContain('prefers-color-scheme');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`a reporter's box is burned opaque into the redrawn image, and stands out from the page, in ${colorScheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openSyntheticPage(page);
    const result = await page.evaluate(async () => {
      const isScreenshotModule = (value: unknown): value is ScreenshotModule =>
        typeof value === 'object' && value !== null && 'redrawScreenshot' in value;
      const isRedactionModule = (value: unknown): value is RedactionModule =>
        typeof value === 'object' && value !== null && 'burnRedactions' in value;
      const paths = ['/redraw/redraw-screenshot.js', '/redraw/redaction.js'];
      const loaded: unknown[] = await Promise.all(paths.map((path) => import(path)));
      const [screenshotModule, redactionModule] = loaded;
      if (!isScreenshotModule(screenshotModule) || !isRedactionModule(redactionModule))
        throw new Error('The redraw bundle is incomplete.');
      const redrawn = await createImageBitmap(await screenshotModule.redrawScreenshot());
      // The same box over a plain image of the same size: an opaque cover gives the same pixels.
      const plain = new OffscreenCanvas(redrawn.width, redrawn.height);
      const plainContext = plain.getContext('2d');
      if (!plainContext) throw new Error('The test cannot draw.');
      plainContext.fillStyle = 'lime';
      plainContext.fillRect(0, 0, plain.width, plain.height);
      // Over the theme probe, from its left edge to well past it.
      const box = { x: 32 / 900, y: 0, width: 120 / 900, height: 60 / 900 };
      const read = async (source: ImageBitmap | OffscreenCanvas) => {
        const bitmap = await createImageBitmap(await redactionModule.burnRedactions(source, [box]));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('The test cannot read the image.');
        context.drawImage(bitmap, 0, 0);
        const ratio = devicePixelRatio;
        return {
          box: Array.from(context.getImageData(34 * ratio, 2 * ratio, 110 * ratio, 50 * ratio).data),
          // In the body's top padding, beside the box: the page's own surface.
          page: Array.from(context.getImageData(600 * ratio, 8 * ratio, 1, 1).data),
          size: [bitmap.width, bitmap.height],
        };
      };
      const burned = await read(redrawn);
      const reference = await read(plain);
      return { burned, reference, redrawnSize: [redrawn.width, redrawn.height] };
    });
    expect(result.burned.size, 'the upload keeps the redraw’s full size').toEqual(result.redrawnSize);
    expect(result.burned.box, 'nothing of the page shows inside the box').toEqual(result.reference.box);
    expect(result.burned.page, 'the page keeps its theme around the box').toEqual([...SURFACE[colorScheme]]);
    expect(result.burned.box.slice(0, 4), 'the box stands out from the page').not.toEqual(result.burned.page);
  });
}
