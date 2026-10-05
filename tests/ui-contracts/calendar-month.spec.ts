import { expect, test } from '@playwright/test';
import {
  card,
  dragPointer,
  expectBanner,
  isDragging,
  monthCell,
  monthDay,
  monthDayPopover,
  openCalendarContract,
  saving,
  writeCount,
} from './calendar-views-support';

// The month grid against the real engine and optimistic owner (P1-24a,
// package D): a date drop writes the planning entry optimistically, the
// overflow of a day opens in a popover, and releasing on the source cell
// writes nothing.

test.beforeEach(async ({ page }) => {
  await openCalendarContract(page, 'calendar-month');
  await expect(card(page, 'Monatsauftrag')).toBeVisible();
  await expect(card(page, 'Monatsauftrag')).not.toHaveAttribute('data-locked', '');
});

test('month weeks fill a tall desktop without collapsing their content', async ({ page }) => {
  const scroller = page
    .getByRole('region', { name: 'Kalenderansicht' })
    .locator('[data-calendar-scroll-container]');
  await scroller.evaluate((element) => {
    element.style.height = '1000px';
  });
  await expect
    .poll(() =>
      scroller.evaluate((element) => {
        const grid = element.querySelector('[data-month-view]');
        return grid !== null && Math.abs(grid.getBoundingClientRect().height - element.clientHeight) <= 1;
      }),
    )
    .toBe(true);
  await expect(card(page, 'Monatsauftrag')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('desktop-month.png'), fullPage: true });
});

test('a date drop moves the visit optimistically and a refusal restores it', async ({ page }) => {
  await dragPointer(page, card(page, 'Monatsauftrag'), monthCell(page, '2026-06-16'));
  await expect(
    monthDay(page, '2026-06-16').locator('[data-calendar-card]').filter({ hasText: 'Monatsauftrag' }),
  ).toBeVisible();
  await expect.poll(() => writeCount(page)).toBe(1);
  expect(await page.evaluate(() => window.calendarWriteContract.calls[0]?.input)).toMatchObject({
    plannedDate: '2026-06-16',
  });
  await expect(saving(page)).toHaveText('aktiv');
  await page.evaluate(() => window.calendarWriteContract.complete(0, 'failure', 'stale_occurrence'));
  await expectBanner(page, 'gerade von jemand anderem geändert');
  await expect(
    monthDay(page, '2026-06-15').locator('[data-calendar-card]').filter({ hasText: 'Monatsauftrag' }),
  ).toBeVisible();
  await expect(saving(page)).toHaveText('frei');
});

test('a day with more visits than fit shows „+n mehr" and lists them all in a popover', async ({ page }) => {
  const day = monthDay(page, '2026-06-17');
  await expect(day.locator('[data-calendar-card]')).toHaveCount(3);
  await day.getByRole('button', { name: '+1 mehr' }).click();
  const popover = monthDayPopover(page, '2026-06-17');
  await expect(popover.locator('[data-calendar-card]')).toHaveCount(4);
  await expect(popover.getByText('Vierter Termin')).toBeVisible();
});

test('a failed first write cancels dependent queued moves and allows a fresh gesture', async ({ page }) => {
  await dragPointer(page, card(page, 'Monatsauftrag'), monthCell(page, '2026-06-16'));
  await expect.poll(() => writeCount(page)).toBe(1);
  await dragPointer(page, card(page, 'Monatsauftrag'), monthCell(page, '2026-06-18'));
  await expect(
    monthDay(page, '2026-06-18').locator('[data-calendar-card]').filter({ hasText: 'Monatsauftrag' }),
  ).toBeVisible();
  await page.evaluate(() => window.calendarWriteContract.complete(0, 'failure'));
  await expect(saving(page)).toHaveText('frei');
  expect(await writeCount(page)).toBe(1);
  await expect(
    monthDay(page, '2026-06-15').locator('[data-calendar-card]').filter({ hasText: 'Monatsauftrag' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('nicht');
  await expect(page.getByRole('button', { name: 'Rückgängig', exact: true })).toHaveCount(0);
  await dragPointer(page, card(page, 'Monatsauftrag'), monthCell(page, '2026-06-18'));
  await expect.poll(() => writeCount(page)).toBe(2);
  await page.evaluate(() => window.calendarWriteContract.complete(1, 'success'));
  await expect(saving(page)).toHaveText('frei');
  await expect(
    monthDay(page, '2026-06-18').locator('[data-calendar-card]').filter({ hasText: 'Monatsauftrag' }),
  ).toBeVisible();
});

test('a failed second move restores the last confirmed position', async ({ page }) => {
  await dragPointer(page, card(page, 'Monatsauftrag'), monthCell(page, '2026-06-16'));
  await expect.poll(() => writeCount(page)).toBe(1);
  await dragPointer(page, card(page, 'Monatsauftrag'), monthCell(page, '2026-06-18'));
  await page.evaluate(() => window.calendarWriteContract.complete(0, 'success'));
  await expect.poll(() => writeCount(page)).toBe(2);
  await page.evaluate(() => window.calendarWriteContract.complete(1, 'failure'));
  await expect(saving(page)).toHaveText('frei');
  await expect(
    monthDay(page, '2026-06-16').locator('[data-calendar-card]').filter({ hasText: 'Monatsauftrag' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('nicht');
});

test('the same date is not a change: releasing on the source cell writes nothing', async ({ page }) => {
  await dragPointer(page, card(page, 'Monatsauftrag'), monthCell(page, '2026-06-15'));
  await expect(isDragging(page)).toHaveCount(0);
  expect(await writeCount(page)).toBe(0);
});

test('failed Undo cancels a dependent gesture and preserves the confirmed position', async ({ page }) => {
  await dragPointer(page, card(page, 'Monatsauftrag'), monthCell(page, '2026-06-16'));
  await expect.poll(() => writeCount(page)).toBe(1);
  await page.evaluate(() => window.calendarWriteContract.complete(0, 'success'));
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect.poll(() => writeCount(page)).toBe(2);
  await dragPointer(page, card(page, 'Monatsauftrag'), monthCell(page, '2026-06-18'));
  await page.evaluate(() => window.calendarWriteContract.complete(1, 'failure'));
  await expect(saving(page)).toHaveText('frei');
  expect(await writeCount(page)).toBe(2);
  await expect(
    monthDay(page, '2026-06-16').locator('[data-calendar-card]').filter({ hasText: 'Monatsauftrag' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('nicht');
});
