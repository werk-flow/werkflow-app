import { type RedrawnPage } from './redraw-page';

// Turns the redrawn clone into a PNG on the device: the clone and the page's
// own CSS go into an SVG foreignObject, which the browser draws onto a canvas.
// An SVG drawn as an image loads nothing from the network, so the image holds
// only what the clone holds. Nothing uploads here.

const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

// A snapshot shows each element at rest: an entry animation would draw its first frame.
const STILL_FRAME_CSS =
  '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

const MAX_PIXEL_RATIO = 2;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(reader.error));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The font rule with each same-origin `url()` inlined; a foreign font is dropped to the fallback. */
async function inlineFontFace(rule: CSSFontFaceRule, base: string, origin: string): Promise<string> {
  let cssText = rule.cssText;
  for (const [match, , path = ''] of cssText.matchAll(/url\((["']?)([^"')]+)\1\)/gu)) {
    const url = new URL(path, base);
    if (url.origin !== origin) return '';
    const response = await fetch(url);
    if (!response.ok) return '';
    cssText = cssText.replace(match, `url("${await readAsDataUrl(await response.blob())}")`);
  }
  return cssText;
}

/** The text of every readable rule of the page's style sheets, fonts inlined. */
async function collectPageCss(document: Document): Promise<string> {
  const origin = document.location.origin;
  const parts: string[] = [];
  const visit = async (sheet: CSSStyleSheet): Promise<void> => {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // best-effort: a cross-origin sheet hides its rules; the app serves none, and a missing rule only changes the look.
      return;
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSImportRule && rule.styleSheet) await visit(rule.styleSheet);
      else if (rule instanceof CSSFontFaceRule)
        parts.push(await inlineFontFace(rule, sheet.href ?? document.baseURI, origin));
      else parts.push(rule.cssText);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) await visit(sheet);
  parts.push(STILL_FRAME_CSS);
  return parts.join('\n');
}

/** The clone as an SVG document: the page's CSS in its head, the viewport as its size. */
function serializePage(page: RedrawnPage, css: string): string {
  const factory = page.root.ownerDocument;
  const head = factory.createElementNS(XHTML_NAMESPACE, 'head');
  const style = factory.createElementNS(XHTML_NAMESPACE, 'style');
  style.textContent = css;
  head.appendChild(style);
  page.root.insertBefore(head, page.root.firstChild);
  const xhtml = new XMLSerializer().serializeToString(page.root);
  const { width, height } = page;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${xhtml}</foreignObject></svg>`
  );
}

/** The color behind the page: the body's, else the root's, else white, as a browser paints it. */
function pageBackground(document: Document): string {
  for (const element of [document.body, document.documentElement]) {
    const color = getComputedStyle(element).backgroundColor;
    if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
  }
  return 'white';
}

/** Draws the redrawn page into a PNG at the device's pixel ratio, at most twice the CSS size. */
export async function rasterizePage(page: RedrawnPage, document: Document): Promise<Blob> {
  const svg = serializePage(page, await collectPageCss(document));
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const scale = Math.min(document.defaultView?.devicePixelRatio ?? 1, MAX_PIXEL_RATIO);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.width * scale);
  canvas.height = Math.round(page.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The device cannot draw the screenshot.');
  context.fillStyle = pageBackground(document);
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The screenshot could not be encoded.'))),
      'image/png',
    ),
  );
}
