import { expect, test } from '@playwright/test';
import { beginDragToPoint, card, dayTimeline, dragGhost, dragHandleBy, expectBanner, openCalendarContract, saving, trailingResizeHandle, writeCount } from './calendar-views-support';

// The day view's resize handle against the real engine and optimistic owner
// (P1-24a, package C): the write waits for persistence, a rejection restores
// the duration and releases refresh ownership, a confirmed write offers Undo.

const TITLE = 'Prüfauftrag ziehen';

test.beforeEach(async ({ page }) => {
  await openCalendarContract(page, 'calendar-day');
  await expect(card(page, TITLE)).toBeVisible();
});

test('a resize waits for persistence and a rejected write restores the duration and releases ownership', async ({ page }) => {
  await dragHandleBy(page, trailingResizeHandle(card(page, TITLE)), 60);
  await expect.poll(() => writeCount(page)).toBe(1);
  const call = await page.evaluate(() => window.calendarWriteContract.calls[0]);
  expect(call?.kind).toBe('planning');
  const minutes = (call?.input as { estimatedDurationMinutes?: number }).estimatedDurationMinutes ?? 0;
  expect(minutes).toBeGreaterThan(60);
  await expect(saving(page)).toHaveText('aktiv');
  await expect(page.getByRole('button', { name: 'Rückgängig', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.calendarWriteContract.complete(0, 'reject'));
  await expectBanner(page, 'Prüfe die Verbindung');
  await expect(saving(page)).toHaveText('frei');
  await expect.poll(() => page.evaluate(() => window.calendarContract.reads.length)).toBeGreaterThan(0);
});

test('a confirmed resize offers Undo whose returned failure is visible and releases ownership', async ({ page }) => {
  await dragHandleBy(page, trailingResizeHandle(card(page, TITLE)), 60);
  await expect.poll(() => writeCount(page)).toBe(1);
  await page.evaluate(() => window.calendarWriteContract.complete(0, 'success'));
  await expectBanner(page, 'Termin dauert jetzt');
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect.poll(() => writeCount(page)).toBe(2);
  expect((await page.evaluate(() => window.calendarWriteContract.calls[1]?.input)) as { estimatedDurationMinutes?: number }).toMatchObject({ estimatedDurationMinutes: 60 });
  await expect(saving(page)).toHaveText('aktiv');
  await page.evaluate(() => window.calendarWriteContract.complete(1, 'failure'));
  await expectBanner(page, 'Rückgängig war nicht möglich');
  await expect(saving(page)).toHaveText('frei');
});

test('a card dropped past midnight is refused at the pointer and never written', async ({ page }) => {
  const source = await card(page, TITLE).boundingBox();
  const bounds = await dayTimeline(page, 'worker').boundingBox();
  if (!source || !bounds) throw new Error('The card or the timeline has no layout.');
  await beginDragToPoint(page, card(page, TITLE), { x: bounds.x + bounds.width - 4, y: source.y + source.height / 2 });
  await expect(dragGhost(page)).toHaveAttribute('data-state', 'refused');
  await expect(dragGhost(page)).toContainText('über Mitternacht');
  await page.mouse.up();
  expect(await writeCount(page)).toBe(0);
});
