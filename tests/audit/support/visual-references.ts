import { expect, type Locator, type Page } from '@playwright/test';
import { clockInLauncher } from '../../golden/support/steps/time-tracking';

// Capture rules for the visual reference group (docs/technical/standards-audit.md,
// "Rendered design acceptance"). A reference is a viewport screenshot of a
// settled page: no skeleton, fonts loaded, the clock launcher ready, and every
// text the app derives from the wall clock replaced by a constant stand-in.
// Replacing text keeps the layout of the stand-in constant, where a mask would
// still let a longer weekday or month name move its neighbours.

export const DESKTOP = { width: 1440, height: 900 } as const;
export const PHONE = { width: 375, height: 812 } as const;

const MONTHS = 'Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember';
const SHORT_MONTHS = 'Jan|Feb|Mär|Apr|Mai|Jun|Jul|Aug|Sep|Sept|Okt|Nov|Dez';
const WEEKDAYS = 'Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag';
const UNITS = 'Sekunden?|Minuten?|Stunden?|Tagen?|Tag|Wochen?|Monaten?|Monat|Jahren?|Jahr';

/** Clock-derived text and its constant stand-in, applied in this order. */
const CLOCK_TEXT: readonly (readonly [string, string])[] = [
  [`Guten (Morgen|Tag|Abend)`, 'Guten Tag'],
  [`\\b\\d{1,2}\\.\\s?(${MONTHS})\\s\\d{4}`, '1. Januar 2026'],
  [`\\b\\d{1,2}\\.\\s?(${SHORT_MONTHS})\\.?\\s\\d{4}`, '1. Jan. 2026'],
  [`\\b\\d{1,2}\\.\\s?(${MONTHS})\\b`, '1. Januar'],
  [`\\b\\d{1,2}\\.\\s?(${SHORT_MONTHS})\\.`, '1. Jan.'],
  [`\\b(${MONTHS})\\s\\d{4}\\b`, 'Januar 2026'],
  [`\\b(${WEEKDAYS})\\b`, 'Montag'],
  ['\\b\\d{1,2}\\.\\d{1,2}\\.\\d{4}\\b', '01.01.2026'],
  ['\\b\\d{1,2}\\.\\d{1,2}\\.\\d{2}\\b', '01.01.26'],
  ['\\b\\d{1,2}\\.\\d{1,2}\\.(?!\\d)', '01.01.'],
  ['\\b\\d{2}\\.\\d{4}\\b', '01.2026'],
  ['\\b\\d{4}-\\d{2}-\\d{2}\\b', '2026-01-01'],
  ['\\b\\d{1,2}:\\d{2}:\\d{2}\\b', '08:00:00'],
  ['\\b\\d{1,2}:\\d{2}\\b', '08:00'],
  ['\\bKW\\s?\\d{1,2}\\b', 'KW 1'],
  [`\\bvor\\s(\\d+|einer|einem|wenigen)\\s(${UNITS})\\b`, 'vor 1 Minute'],
  [`\\bin\\s(\\d+|einer|einem)\\s(${UNITS})\\b`, 'in 1 Tag'],
];

/**
 * Replaces run-specific strings (e-mail addresses, the join code) and
 * clock-derived text in the rendered page, and keeps replacing it when the
 * page re-renders. Inputs keep their element; only their shown value changes.
 */
async function normalizeText(
  page: Page,
  replacements: readonly (readonly [string, string])[],
  clockText: boolean,
): Promise<void> {
  await page.evaluate(
    ({ exact, patterns }) => {
      const compiled = patterns.map(
        ([source, replacement]) => [new RegExp(source, 'g'), replacement] as const,
      );
      const rewrite = (value: string): string => {
        let next = value;
        for (const [from, to] of exact) next = next.split(from).join(to);
        for (const [pattern, to] of compiled) next = next.replace(pattern, to);
        return next;
      };
      const visit = (root: Node): void => {
        // A TreeWalker never yields its own root, so a changed or added bare Text node is rewritten here.
        if (root.nodeType === Node.TEXT_NODE) {
          const value = root.nodeValue ?? '';
          const next = rewrite(value);
          if (next !== value) root.nodeValue = next;
          return;
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const value = node.nodeValue ?? '';
          const next = rewrite(value);
          if (next !== value) node.nodeValue = next;
        }
        const element = root instanceof Element ? root : root.parentElement;
        for (const field of element?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          'input, textarea',
        ) ?? []) {
          const next = rewrite(field.value);
          if (next !== field.value) field.value = next;
        }
      };
      visit(document.body);
      const holder = window as unknown as { __visualReferenceObserver?: MutationObserver };
      holder.__visualReferenceObserver?.disconnect();
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'characterData') visit(record.target);
          for (const added of record.addedNodes) visit(added);
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      holder.__visualReferenceObserver = observer;
    },
    { exact: replacements, patterns: clockText ? CLOCK_TEXT : [] },
  );
}

/**
 * Waits until the page shows its settled content: no skeleton, fonts loaded, the clock launcher ready.
 * The pulse wait stays a class wait: the app shell's loading placeholders
 * (components/sidebar/app-shell.tsx, app-shell-skeleton.tsx) pulse without the
 * Skeleton primitive's data-slot, and the spinner has no shared primitive.
 */
export async function settlePage(page: Page, ready: Locator): Promise<void> {
  await expect(ready).toBeVisible();
  await expect(page.locator('.animate-pulse:visible')).toHaveCount(0);
  await expect(page.locator('.animate-spin:visible')).toHaveCount(0);
  const launcher = clockInLauncher(page);
  if (await launcher.count()) await expect(launcher).toBeEnabled();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/**
 * The normalized text the viewport shows, one line per visible text node in
 * document order. A changed word can stay under the pixel tolerance; this
 * text cannot.
 */
async function viewportText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const lines: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim();
      const parent = node.parentElement;
      if (!text || !parent?.checkVisibility({ visibilityProperty: true })) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const shown = [...range.getClientRects()].some(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth,
      );
      if (shown) lines.push(text);
    }
    return `${lines.join('\n')}\n`;
  });
}

/**
 * Compares the viewport with its reference image and its visible text with the
 * text reference beside it. The pixel tolerance only absorbs anti-aliasing; a
 * moved, recoloured or missing element exceeds it, and a changed word fails
 * the exact text comparison.
 */
export async function expectReference(
  page: Page,
  name: string,
  replacements: readonly (readonly [string, string])[],
  options: { clockText?: boolean; mask?: readonly Locator[] } = {},
): Promise<void> {
  await normalizeText(page, replacements, options.clockText ?? true);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    mask: [...(options.mask ?? [])],
    maxDiffPixelRatio: 0.002,
    timeout: 15_000,
  });
  expect(await viewportText(page)).toMatchSnapshot(`${name}.txt`);
}
