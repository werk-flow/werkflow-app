import { expect, type Locator, type Page } from '@playwright/test';
import { settled } from '../../golden/support/steps/interaction';
import { clockInLauncher } from '../../golden/support/steps/time-tracking';

// Capture rules for the visual reference group (docs/technical/standards-audit.md,
// "Rendered design acceptance"). A reference is a viewport screenshot of a
// settled page: no skeleton, fonts loaded, the clock launcher ready, and every
// text the app derives from the wall clock replaced by a constant stand-in.
// Replacing text keeps the layout of the stand-in constant, where a mask would
// still let a longer weekday or month name move its neighbours. The calendar
// shows a week owned relative to the run day, so its range, week number and
// day numbers get stand-ins too; that week never holds today, so no now line
// or today mark is drawn.

declare global {
  interface Window {
    /** The stand-in observer of the current page, replaced when a capture installs a new one. */
    __visualReferenceObserver?: MutationObserver;
  }
}

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
 * The labels of a calendar week that the run day moves, applied before the
 * clock text: a whole range at once, so a week across two months or years
 * reads like one inside a month, and a horizon of several weeks like one week.
 */
const CALENDAR_WEEK_TEXT: readonly (readonly [string, string])[] = [
  [`\\b\\d{1,2}\\.(\\s(${MONTHS}))?\\s-\\s\\d{1,2}\\.\\s(${MONTHS})\\s\\d{4}`, '1. - 1. Januar 2026'],
  ['\\b\\d{1,2}\\.\\d{1,2}\\.(\\d{2})?\\s–\\s\\d{1,2}\\.\\d{1,2}\\.\\d{2}\\b', '01.01. – 01.01.26'],
  ['\\bKW\\s?\\d{1,2}(–\\d{1,2})?\\b', 'KW 1'],
];

/** The clock-text patterns a reference applies, in order: a calendar week's labels first. */
export function standInPatterns(calendarWeek: boolean): readonly (readonly [string, string])[] {
  return calendarWeek ? [...CALENDAR_WEEK_TEXT, ...CLOCK_TEXT] : CLOCK_TEXT;
}

/** The Plantafel's day header; its bare day of the month becomes the column's position. */
const BOARD_DAY_COLUMN = '[data-board-column]';

/**
 * Replaces run-specific strings (e-mail addresses, the join code) and
 * clock-derived text in the rendered page, and keeps replacing it when the
 * page re-renders. Inputs keep their element; only their shown value changes.
 * A calendar week also replaces its range, week number and day numbers.
 */
async function normalizeText(
  page: Page,
  replacements: readonly (readonly [string, string])[],
  calendarWeek: boolean,
): Promise<void> {
  await page.evaluate(
    ({ exact, patterns, dayColumn }) => {
      const compiled = patterns.map(
        ([source, replacement]) => [new RegExp(source, 'g'), replacement] as const,
      );
      // A date field shows its day, month and year in separate segments, which no date pattern sees whole.
      const segmentStandIns: Record<string, string> = { day: '01', month: '01', year: '2026' };
      const rewrite = (value: string, node: Node): string => {
        const segment = node.parentElement?.getAttribute('data-segment');
        if (segment && segmentStandIns[segment] && value.trim()) return segmentStandIns[segment];
        const column = dayColumn ? node.parentElement?.closest(dayColumn) : null;
        if (dayColumn && column && /^\d{1,2}$/.test(value.trim()))
          return String([...document.querySelectorAll<Element>(dayColumn)].indexOf(column) + 1);
        let next = value;
        for (const [from, to] of exact) next = next.split(from).join(to);
        for (const [pattern, to] of compiled) next = next.replace(pattern, to);
        return next;
      };
      const visit = (root: Node): void => {
        // A TreeWalker never yields its own root, so a changed or added bare Text node is rewritten here.
        if (root.nodeType === Node.TEXT_NODE) {
          const value = root.nodeValue ?? '';
          const next = rewrite(value, root);
          if (next !== value) root.nodeValue = next;
          return;
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const value = node.nodeValue ?? '';
          const next = rewrite(value, node);
          if (next !== value) node.nodeValue = next;
        }
        const element = root instanceof Element ? root : root.parentElement;
        for (const field of element?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          'input, textarea',
        ) ?? []) {
          const next = rewrite(field.value, field);
          if (next !== field.value) field.value = next;
        }
      };
      visit(document.body);
      window.__visualReferenceObserver?.disconnect();
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'characterData') visit(record.target);
          for (const added of record.addedNodes) visit(added);
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      window.__visualReferenceObserver = observer;
    },
    {
      exact: replacements,
      patterns: standInPatterns(calendarWeek),
      dayColumn: calendarWeek ? BOARD_DAY_COLUMN : null,
    },
  );
}

/**
 * Waits until the page shows its settled content: the busy signals clear
 * (`settled`: no skeleton, spinner, busy region or route refresh), fonts
 * loaded, the clock launcher ready.
 */
/** The page body inside the main landmark, the content a reference waits for. */
export function pageBody(main: Locator): Locator {
  return main.locator('[data-page-body]');
}

export async function settlePage(page: Page, ready: Locator): Promise<void> {
  await expect(ready).toBeVisible();
  await settled(page);
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
 * The app renders in Geist (app/layout.tsx). A capture of a system-font
 * fallback would record whatever fonts the machine has installed, so every
 * reference first proves that the body text and the page heading compute to
 * Geist and that a Geist face is loaded.
 */
async function expectGeistTypography(page: Page): Promise<void> {
  const typography = await page.evaluate(async () => {
    await document.fonts.ready;
    const leadingFamily = (element: Element): string =>
      (getComputedStyle(element).fontFamily.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
    const heading = document.querySelector('main h1');
    return {
      body: leadingFamily(document.body),
      heading: heading ? leadingFamily(heading) : 'no page heading',
      // document.fonts.check passes when no face matches at all; a loaded Geist face proves the font arrived.
      loaded: [...document.fonts].some(
        (face) => face.family.replace(/["']/g, '') === 'Geist' && face.status === 'loaded',
      ),
    };
  });
  expect(typography, 'body text and page heading render in a loaded Geist face').toEqual({
    body: 'Geist',
    heading: 'Geist',
    loaded: true,
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
  options: { calendarWeek?: boolean; mask?: readonly Locator[] } = {},
): Promise<void> {
  await expectGeistTypography(page);
  await normalizeText(page, replacements, options.calendarWeek ?? false);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    mask: [...(options.mask ?? [])],
    maxDiffPixelRatio: 0.002,
  });
  expect(await viewportText(page)).toMatchSnapshot(`${name}.txt`);
}
