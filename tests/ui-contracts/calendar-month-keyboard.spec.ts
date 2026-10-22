import { expect, test, type Locator, type Page } from '@playwright/test';
import { card, monthCell, openCalendarContract } from './calendar-views-support';

// The month grid's keyboard path: one day cell is the grid's tab stop (today
// in the shown month), arrow keys move one day or one week and stop at the
// grid's edge, the focused day shows the focus ring, Enter and Space open the
// day, and the entry chips stay in the tab order.

test.beforeEach(async ({ page }) => {
  await openCalendarContract(page, 'calendar-month');
  await expect(card(page, 'Monatsauftrag')).toBeVisible();
});

/** The days that are in the tab order; the grid has exactly one. */
async function tabStops(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-month-cell][tabindex="0"]')].map(
      (cell) => cell.dataset.monthCell ?? '',
    ),
  );
}

async function showsFocusRing(cell: Locator): Promise<boolean> {
  return cell.evaluate(
    (element) => element.matches(':focus-visible') && getComputedStyle(element).boxShadow !== 'none',
  );
}

async function opened(page: Page): Promise<string[]> {
  return page.evaluate(() => window.calendarViewContract.opened);
}

test('Tab reaches today as the one day stop and arrow keys move inside the grid', async ({ page }) => {
  expect(await tabStops(page)).toEqual(['2026-06-15']);
  // Backwards from today's first chip: past today's „+“ to the day itself.
  await card(page, 'Monatsauftrag').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(monthCell(page, '2026-06-15')).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(monthCell(page, '2026-06-16')).toBeFocused();
  expect(await showsFocusRing(monthCell(page, '2026-06-16'))).toBe(true);
  expect(await tabStops(page)).toEqual(['2026-06-16']);
  await page.keyboard.press('ArrowDown');
  await expect(monthCell(page, '2026-06-23')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(monthCell(page, '2026-06-22')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(monthCell(page, '2026-06-15')).toBeFocused();

  // The first shown day is the grid's corner: up and left stay on it.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(monthCell(page, '2026-06-01')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  await expect(monthCell(page, '2026-06-01')).toBeFocused();
  expect(await showsFocusRing(monthCell(page, '2026-06-01'))).toBe(true);

  // The last shown day, outside the month, is the other corner.
  await monthCell(page, '2026-07-05').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect(monthCell(page, '2026-07-05')).toBeFocused();
  expect(await tabStops(page)).toEqual(['2026-07-05']);
});

test('Enter and Space open the focused day, Enter on a chip opens the chip', async ({ page }) => {
  await monthCell(page, '2026-06-17').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => opened(page)).toEqual(['Tag 2026-06-17']);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect.poll(() => opened(page)).toEqual(['Tag 2026-06-17', 'Tag 2026-06-18']);

  // The day's chips follow its „+“ in the tab order and keep their own Enter.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(card(page, 'Erster Termin')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => opened(page)).toEqual(['Tag 2026-06-17', 'Tag 2026-06-18', 'Erster Termin']);
});
