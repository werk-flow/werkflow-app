import { type RedrawnPage } from './redraw-page';
import { removeUnsafeDeclarations } from './unsafe-style';

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

/** A build asset of this origin: CSS compiled from the source, never from a record. */
function isBuildStyleSheet(sheet: CSSStyleSheet, origin: string): boolean {
  if (!sheet.href) return false;
  const url = new URL(sheet.href);
  return url.origin === origin && url.pathname.startsWith('/_next/static/');
}

function sanitizeRules(rules: CSSRuleList): void {
  for (const rule of Array.from(rules)) {
    if ('style' in rule && rule.style instanceof CSSStyleDeclaration) removeUnsafeDeclarations(rule.style);
    if ('cssRules' in rule && rule.cssRules instanceof CSSRuleList) sanitizeRules(rule.cssRules);
  }
}

type MediaTest = (media: MediaList) => boolean;

/**
 * Settles every media rule as the live page answers it: `all` when it applies
 * now, `not all` when it does not. The SVG image is a document of its own and
 * may answer a query otherwise, such as `prefers-color-scheme` as light on a
 * page in dark mode; settled, the image shows the page's own answer.
 */
function settleMediaRules(rules: CSSRuleList, appliesNow: MediaTest): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSMediaRule) rule.media.mediaText = appliesNow(rule.media) ? 'all' : 'not all';
    if ('cssRules' in rule && rule.cssRules instanceof CSSRuleList)
      settleMediaRules(rule.cssRules, appliesNow);
  }
}

/**
 * The rules' text from a detached copy, with every media rule settled. A
 * style element or a sheet outside the build may be written at runtime, so
 * its copy also gets the inline-style rule: no generated text, no image, no
 * font. A build sheet's rules stay as compiled. The live sheet never changes.
 */
function copiedRuleText(rules: readonly CSSRule[], appliesNow: MediaTest, sanitize: boolean): string {
  const copy = new CSSStyleSheet();
  copy.replaceSync(
    rules
      .filter((rule) => !(rule instanceof CSSFontFaceRule || rule instanceof CSSImportRule))
      .map((rule) => rule.cssText)
      .join('\n'),
  );
  settleMediaRules(copy.cssRules, appliesNow);
  if (sanitize) sanitizeRules(copy.cssRules);
  return Array.from(copy.cssRules, (rule) => rule.cssText).join('\n');
}

/** The text of every readable rule of the page's style sheets, fonts of the build inlined. */
async function collectPageCss(document: Document): Promise<string> {
  const origin = document.location.origin;
  const parts: string[] = [];
  const view = document.defaultView;
  const appliesNow: MediaTest = (media) =>
    media.length === 0 || !view || view.matchMedia(media.mediaText).matches;
  const visit = async (sheet: CSSStyleSheet): Promise<void> => {
    // A sheet that does not style the live page, disabled or for other media (print), stays out.
    if (sheet.disabled || !appliesNow(sheet.media)) return;
    let rules: CSSRule[];
    try {
      rules = Array.from(sheet.cssRules);
    } catch {
      // best-effort: a cross-origin sheet hides its rules; the app serves none, and a missing rule only changes the look.
      return;
    }
    if (!isBuildStyleSheet(sheet, origin)) {
      parts.push(copiedRuleText(rules, appliesNow, true));
      return;
    }
    for (const rule of rules) {
      // An import's media sits on the rule; Chromium leaves the imported sheet's own list empty.
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet && appliesNow(rule.media)) await visit(rule.styleSheet);
      } else if (rule instanceof CSSFontFaceRule)
        parts.push(await inlineFontFace(rule, sheet.href ?? document.baseURI, origin));
    }
    parts.push(copiedRuleText(rules, appliesNow, false));
  };
  for (const sheet of Array.from(document.styleSheets)) await visit(sheet);
  parts.push(STILL_FRAME_CSS);
  return parts.join('\n');
}

/** The redrawn page as an SVG document: the page's CSS in its head, the viewport as its size. */
export async function pageToSvg(page: RedrawnPage, document: Document): Promise<string> {
  const css = await collectPageCss(document);
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

/** Draws the page's SVG into a PNG at the device's pixel ratio, at most twice the CSS size. */
export async function rasterizeSvg(svg: string, page: RedrawnPage, document: Document): Promise<Blob> {
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
