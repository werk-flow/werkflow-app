import { expect, test } from '@playwright/test';
import { card, dragPointer, expectBanner, isDragging, monthCell, monthDay, monthDayPopover, openCalendarContract, saving, writeCount } from './calendar-views-support';

// The month grid against the real engine and optimistic owner (P1-24a,
// package D): a date drop writes the planning entry optimistically, the
// overflow of a day opens in a popover, and releasing on the source cell
// writes nothing.

test.beforeEach(async ({ page }) => {
  await openCalendarContract(page, 'calendar-month');
  await expect(card(page, 'Monatsauftrag')).toBeVisible();
});

test('a date drop moves the visit optimistically and a refusal restores it', async ({ page }) => {
  await dragPointer(page, card(page, 'Monatsauftrag'), monthCell(page, '2026-06-16'));
  await expect(monthDay(page, '2026-06-16').locator('[data-calendar-card]').filter({ hasText: 'Monatsauftrag' })).toBeVisible();
  await expect.poll(() => writeCount(page)).toBe(1);
  expect((await page.evaluate(() => window.calendarWriteContract.calls[0]?.input))).toMatchObject({ plannedDate: '2026-06-16' });
  await expect(saving(page)).toHaveText('aktiv');
  await page.evaluate(() => window.calendarWriteContract.complete(0, 'failure', 'stale_occurrence'));
  await expectBanner(page, 'gerade von jemand anderem geändert');
  await expect(monthDay(page, '2026-06-15').locator('[data-calendar-card]').filter({ hasText: 'Monatsauftrag' })).toBeVisible();
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

test('the same date is not a change: releasing on the source cell writes nothing', async ({ page }) => {
  await dragPointer(page, card(page, 'Monatsauftrag'), monthCell(page, '2026-06-15'));
  await expect(isDragging(page)).toHaveCount(0);
  expect(await writeCount(page)).toBe(0);
});
