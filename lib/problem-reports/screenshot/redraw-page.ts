import { fakeText, type RandomSource } from './fake-text';
import { isUiString, type UiStringCatalog } from './ui-string-catalog';

// The default-deny redraw of the visible page. It reads the live page and
// builds a detached clone in a separate document; the live page never
// changes. Only the app's own UI strings stay readable. Every other text,
// every form value, every image and every unknown attribute is faked,
// blocked or dropped. docs/technical/problem-report-scrubbing.md owns the rules.

/** The redrawn page: a detached `<html>` clone and the viewport it shows. */
export type RedrawnPage = { root: HTMLElement; width: number; height: number };

type RedrawContext = { catalog: UiStringCatalog; random: RandomSource; factory: Document };

// Rendered nothing, or embeds another document: dropped.
const DROPPED_ELEMENTS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'base',
  'noscript',
  'template',
  'iframe',
  'frame',
  'frameset',
  'portal',
  'slot',
]);

// Shows pixels the app does not own: a neutral block of the same size.
const BLOCKED_ELEMENTS = new Set(['img', 'picture', 'video', 'audio', 'canvas', 'object', 'embed', 'map']);

// SVG that draws only shapes, as an icon does, stays. Any other SVG element
// (text, an embedded image, a foreign object, a reference) blocks the whole SVG.
const SHAPE_SVG_ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect',
  'defs',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
]);

// Layout, state and SVG geometry: never a user's text, kept verbatim.
const KEPT_ATTRIBUTES = new Set([
  'class',
  'role',
  'type',
  'dir',
  'lang',
  'hidden',
  'disabled',
  'checked',
  'selected',
  'open',
  'readonly',
  'required',
  'multiple',
  'colspan',
  'rowspan',
  'tabindex',
  'inert',
  'xmlns',
  'viewBox',
  'd',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'fill-opacity',
  'fill-rule',
  'clip-rule',
  'opacity',
  'transform',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'points',
  'width',
  'height',
  'preserveAspectRatio',
  'offset',
  'stop-color',
  'stop-opacity',
]);

// Load or link to a resource: dropped, so the clone fetches and names nothing.
const DROPPED_ATTRIBUTES = new Set([
  'href',
  'xlink:href',
  'src',
  'srcset',
  'srcdoc',
  'sizes',
  'poster',
  'action',
  'formaction',
  'background',
  'ping',
  'cite',
  'data',
  'longdesc',
  'usemap',
  'manifest',
  'itemid',
]);

// A declaration that can load or carry a text: dropped from inline styles.
const UNSAFE_STYLE_VALUE = /url\(|image-set\(|image\(|element\(|["']/iu;

const TEXT_INPUT_EXEMPT = new Set(['checkbox', 'radio']);

function textRule(text: string, context: RedrawContext): string {
  return isUiString(context.catalog, text) ? text : fakeText(text, context.random);
}

function copyStyle(live: Element, clone: Element & ElementCSSInlineStyle): void {
  const value = live.getAttribute('style');
  if (!value) return;
  clone.setAttribute('style', value);
  for (const property of Array.from(clone.style)) {
    if (UNSAFE_STYLE_VALUE.test(clone.style.getPropertyValue(property))) clone.style.removeProperty(property);
  }
  if (clone.style.length === 0) clone.removeAttribute('style');
}

/** Copies each attribute by its rule: kept, dropped, or text that is kept only as a UI string. */
function copyAttributes(live: Element, clone: Element & ElementCSSInlineStyle, context: RedrawContext): void {
  for (const { name, value } of Array.from(live.attributes)) {
    if (name === 'style') copyStyle(live, clone);
    else if (KEPT_ATTRIBUTES.has(name)) clone.setAttribute(name, value);
    else if (!DROPPED_ATTRIBUTES.has(name) && !name.startsWith('on'))
      clone.setAttribute(name, textRule(value, context));
  }
}

function isShapeOnlySvg(svg: Element): boolean {
  return Array.from(svg.querySelectorAll('*')).every((element) => SHAPE_SVG_ELEMENTS.has(element.localName));
}

/** A neutral block with the element's box, in place of pixels the app does not own. */
function neutralBlock(live: Element, context: RedrawContext): HTMLElement {
  const box = live.getBoundingClientRect();
  const display = getComputedStyle(live).display;
  const block = context.factory.createElement('span');
  const className = live.getAttribute('class');
  if (className) block.setAttribute('class', className);
  block.setAttribute('data-redrawn', 'blocked');
  block.style.display = display === 'inline' ? 'inline-block' : display;
  block.style.width = `${box.width}px`;
  block.style.height = `${box.height}px`;
  block.style.backgroundColor = 'var(--color-muted, GrayText)';
  return block;
}

type ElementPair = readonly [live: Element, clone: Element];

/** The computed `translate` of an element as an x and a y length. */
function translateOf(element: Element): [string, string] {
  const value = getComputedStyle(element).translate;
  if (!value || value === 'none') return ['0px', '0px'];
  const [x = '0px', y = '0px'] = value.split(' ');
  return [x, y];
}

/** Shifts the children of a scrolled element, so the clone shows what the user saw. */
function applyScroll(live: Element, children: readonly ElementPair[]): void {
  const { scrollTop, scrollLeft } = live;
  if (scrollTop === 0 && scrollLeft === 0) return;
  for (const [liveChild, clone] of children) {
    if (!(clone instanceof HTMLElement || clone instanceof SVGElement)) continue;
    const [x, y] = translateOf(liveChild);
    clone.style.translate = `calc(${x} - ${scrollLeft}px) calc(${y} - ${scrollTop}px)`;
  }
}

/** Writes the live form value into the clone, faked whatever its text. */
function copyFormValue(live: Element, clone: Element, context: RedrawContext): void {
  if (live instanceof HTMLInputElement) {
    clone.removeAttribute('value');
    if (TEXT_INPUT_EXEMPT.has(live.type)) {
      if (live.checked) clone.setAttribute('checked', '');
      else clone.removeAttribute('checked');
    } else if (live.value) {
      clone.setAttribute('value', fakeText(live.value, context.random));
    }
  } else if (live instanceof HTMLTextAreaElement) {
    clone.replaceChildren(context.factory.createTextNode(fakeText(live.value, context.random)));
  } else if (live instanceof HTMLOptionElement) {
    if (live.selected) clone.setAttribute('selected', '');
    else clone.removeAttribute('selected');
  }
}

function isFormValueRoot(live: Element): boolean {
  return (
    live instanceof HTMLSelectElement ||
    live instanceof HTMLDataListElement ||
    live.getAttribute('contenteditable') === '' ||
    live.getAttribute('contenteditable') === 'true' ||
    live.getAttribute('contenteditable') === 'plaintext-only'
  );
}

/** Redraws the children into `clone` and returns the element pairs, for the scroll shift. */
function redrawChildren(live: Node, clone: Node, context: RedrawContext, formValue: boolean): ElementPair[] {
  const pairs: ElementPair[] = [];
  for (const child of Array.from(live.childNodes)) {
    const redrawn = redrawNode(child, context, formValue);
    if (!redrawn) continue;
    clone.appendChild(redrawn);
    if (child instanceof Element && redrawn instanceof Element) pairs.push([child, redrawn]);
  }
  return pairs;
}

function redrawElement(live: Element, context: RedrawContext, formValue: boolean): Node | null {
  const name = live.localName;
  if (DROPPED_ELEMENTS.has(name)) return null;
  if (live instanceof HTMLInputElement && (live.type === 'hidden' || live.type === 'image'))
    return live.type === 'image' ? neutralBlock(live, context) : null;
  if (BLOCKED_ELEMENTS.has(name)) return neutralBlock(live, context);
  if (name === 'svg' && !isShapeOnlySvg(live)) return neutralBlock(live, context);
  const clone = context.factory.createElementNS(live.namespaceURI, name);
  if (!(clone instanceof HTMLElement || clone instanceof SVGElement)) return null;
  copyAttributes(live, clone, context);
  const insideFormValue = formValue || isFormValueRoot(live);
  if (!(live instanceof HTMLTextAreaElement))
    applyScroll(live, redrawChildren(live, clone, context, insideFormValue));
  copyFormValue(live, clone, context);
  return clone;
}

function redrawNode(live: Node, context: RedrawContext, formValue: boolean): Node | null {
  if (live.nodeType === Node.TEXT_NODE) {
    const text = live.textContent ?? '';
    return context.factory.createTextNode(
      formValue ? fakeText(text, context.random) : textRule(text, context),
    );
  }
  if (live instanceof Element) return redrawElement(live, context, formValue);
  return null;
}

/**
 * Redraws the visible page of `document` into a detached clone. The clone
 * keeps the `<html>` and `<body>` elements and drops the head; the
 * rasterizer brings the page's styles.
 */
export function redrawPage(document: Document, catalog: UiStringCatalog, random: RandomSource): RedrawnPage {
  const factory = document.implementation.createHTMLDocument('');
  const context: RedrawContext = { catalog, random, factory };
  const live = document.documentElement;
  const root = factory.createElement('html');
  copyAttributes(live, root, context);
  const body = redrawElement(document.body, context, false);
  if (body instanceof Element) {
    root.appendChild(body);
    applyScroll(live, [[document.body, body]]);
  }
  const view = document.defaultView;
  return {
    root,
    width: view?.innerWidth ?? live.clientWidth,
    height: view?.innerHeight ?? live.clientHeight,
  };
}
