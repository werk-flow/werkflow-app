import { expect, test } from '@playwright/test';
import {
  beginDragToPoint,
  card,
  dayTimeline,
  dragGhost,
  dragHandleBy,
  expectBanner,
  openCalendarContract,
  saving,
  trailingResizeHandle,
  writeCount,
} from './calendar-views-support';

// The day view's resize handle against the real engine and optimistic owner
// (P1-24a, package C): the write waits for persistence, a rejection restores
// the duration and releases refresh ownership, a confirmed write offers Undo.

const TITLE = 'Prüfauftrag ziehen';

test.beforeEach(async ({ page }) => {
  await openCalendarContract(page, 'calendar-day');
  await expect(card(page, TITLE)).toBeVisible();
});

test('a resize waits for persistence and a rejected write restores the duration and releases ownership', async ({
  page,
}) => {
  await dragHandleBy(page, trailingResizeHandle(card(page, TITLE)), 60);
  await expect.poll(() => writeCount(page)).toBe(1);
  const call = await page.evaluate(() => window.calendarWriteContract.calls[0]);
  expect(call?.kind).toBe('planning');
  const minutes = (call?.input as { estimatedDurationMinutes?: number }).estimatedDurationMinutes ?? 0;
  expect(minutes).toBeGreaterThan(60);
  await expect(saving(page)).toHaveText('aktiv');
  await expectBanner(page, 'Änderung wird gespeichert');
  await expect(page.getByRole('button', { name: 'Rückgängig', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.calendarWriteContract.complete(0, 'reject'));
  await expectBanner(page, 'Prüfe die Verbindung');
  await expect(saving(page)).toHaveText('frei');
  await expect.poll(() => page.evaluate(() => window.calendarContract.reads.length)).toBeGreaterThan(0);
});

test('desktop rows grow with the available height and keep readable cards', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Kalenderansicht' });
  const scroller = region.locator('[data-calendar-scroll-container]');
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const viewportWidth = await scroller.evaluate((element) => element.clientWidth);
  await expect
    .poll(async () => (await dayTimeline(page, 'worker').boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(((viewportWidth - 160) / 13) * 24 - 1);
  const employeeRow = region.locator('[data-day-row="worker"]');
  const before = await employeeRow.boundingBox();
  if (!before) throw new Error('Missing employee row');
  expect(before.height).toBeGreaterThanOrEqual(96);
  await scroller.evaluate((element) => {
    element.style.height = '1000px';
  });
  await expect
    .poll(async () => (await employeeRow.boundingBox())?.height ?? 0)
    .toBeGreaterThan(before.height);
  // A sparse calendar must not turn one employee's card into a full-height column.
  expect((await employeeRow.boundingBox())?.height ?? 0).toBeLessThanOrEqual(288);
  const fits = await scroller.evaluate((element) => {
    const grid = element.querySelector('[data-day-view]');
    return grid !== null && grid.getBoundingClientRect().height >= element.clientHeight;
  });
  expect(fits).toBe(true);
  const bounds = await card(page, TITLE).boundingBox();
  expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(90);
  await page.screenshot({ path: test.info().outputPath('desktop-day.png'), fullPage: true });
});

test('a visit without a time stays readable beside the sticky name column', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Kalenderansicht' });
  const scroller = region.locator('[data-calendar-scroll-container]');
  // The day opens at the working hours, so the timeline is scrolled away from midnight.
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const row = region.locator('[data-day-row="worker-2"]');
  const names = await row.getByRole('rowheader').boundingBox();
  const allDay = await card(page, 'Ganztägige Baustelle').boundingBox();
  if (!names || !allDay) throw new Error('Missing row header or all-day card');
  expect(allDay.x).toBeGreaterThanOrEqual(names.x + names.width - 1);
});

test('an earlier failure stays visible without hiding the later entry Undo', async ({ page }) => {
  await dragHandleBy(page, trailingResizeHandle(card(page, TITLE)), 60);
  await expect.poll(() => writeCount(page)).toBe(1);
  const timeline = await dayTimeline(page, 'worker-2').boundingBox();
  if (!timeline) throw new Error('Missing timeline');
  await dragHandleBy(page, trailingResizeHandle(card(page, 'Kurzer Termin')), timeline.width / 24 / 2);
  await expect.poll(() => writeCount(page)).toBe(2);
  await page.evaluate(() => window.calendarWriteContract.complete(1, 'success'));
  await page.evaluate(() => window.calendarWriteContract.complete(0, 'failure'));
  await expect(page.getByRole('alert')).toContainText('nicht');
  await page.getByRole('button', { name: 'Letzte Änderung rückgängig', exact: true }).click();
  await expect.poll(() => writeCount(page)).toBe(3);
  expect(await page.evaluate(() => window.calendarWriteContract.calls[2]?.id)).toBe(
    await page.evaluate(() => window.calendarWriteContract.calls[1]?.id),
  );
  await page.evaluate(() => window.calendarWriteContract.complete(2, 'success'));
});

test('a confirmed resize offers Undo whose returned failure is visible and releases ownership', async ({
  page,
}) => {
  await dragHandleBy(page, trailingResizeHandle(card(page, TITLE)), 60);
  await expect.poll(() => writeCount(page)).toBe(1);
  await page.evaluate(() => window.calendarWriteContract.complete(0, 'success'));
  await expectBanner(page, 'Termin dauert jetzt');
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect.poll(() => writeCount(page)).toBe(2);
  expect(
    (await page.evaluate(() => window.calendarWriteContract.calls[1]?.input)) as {
      estimatedDurationMinutes?: number;
    },
  ).toMatchObject({ estimatedDurationMinutes: 60 });
  await expect(saving(page)).toHaveText('aktiv');
  await page.evaluate(() => window.calendarWriteContract.complete(1, 'failure'));
  await expectBanner(page, 'Rückgängig war nicht möglich');
  await expect(saving(page)).toHaveText('frei');
});

test('a card dropped past midnight is refused at the pointer and never written', async ({ page }) => {
  const source = await card(page, TITLE).boundingBox();
  const bounds = await dayTimeline(page, 'worker').boundingBox();
  if (!source || !bounds) throw new Error('The card or the timeline has no layout.');
  await beginDragToPoint(page, card(page, TITLE), {
    x: bounds.x + bounds.width - 4,
    y: source.y + source.height / 2,
  });
  await expect(dragGhost(page)).toHaveAttribute('data-state', 'refused');
  await expect(dragGhost(page)).toContainText('über Mitternacht');
  const contained = await dragGhost(page).evaluate((element) => {
    const message = element.querySelector('[data-ghost-message]');
    if (!message) return false;
    const box = element.getBoundingClientRect();
    const text = message.getBoundingClientRect();
    return (
      text.bottom <= box.bottom &&
      text.right <= box.right &&
      box.right <= innerWidth &&
      box.bottom <= innerHeight
    );
  });
  expect(contained).toBe(true);
  await page.mouse.up();
  expect(await writeCount(page)).toBe(0);
});

test('resizing an expanded short visit follows its actual endpoint', async ({ page }) => {
  const timeline = await dayTimeline(page, 'worker-2').boundingBox();
  if (!timeline) throw new Error('Missing timeline');
  await dragHandleBy(page, trailingResizeHandle(card(page, 'Kurzer Termin')), timeline.width / 24 / 2);
  await expect.poll(() => writeCount(page)).toBe(1);
  expect(await page.evaluate(() => window.calendarWriteContract.calls[0]?.input)).toMatchObject({
    estimatedDurationMinutes: 30,
  });
});

test('resizing recorded time opens a reason-required correction without changing the saved block', async ({
  page,
}) => {
  const timeline = await dayTimeline(page, 'worker-2').boundingBox();
  if (!timeline) throw new Error('Missing timeline');
  const block = page
    .getByRole('region', { name: 'Kalenderansicht' })
    .getByRole('button', { name: /Arbeitszeit 07:00 bis 07:02/ });
  await dragHandleBy(page, trailingResizeHandle(block), timeline.width / 24 / 2);
  const dialog = page.getByRole('dialog', { name: 'Arbeitszeit korrigieren' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('07:30');
  expect(await writeCount(page)).toBe(0);
  await dialog.getByRole('button', { name: 'Korrektur einreichen' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Grund');
  await dialog.getByLabel('Grund').fill('Endzeit falsch erfasst');
  await dialog.getByRole('button', { name: 'Korrektur einreichen' }).click();
  await expect.poll(() => writeCount(page)).toBe(1);
  expect(await page.evaluate(() => window.calendarWriteContract.calls[0])).toMatchObject({
    kind: 'entries',
    id: 'correction',
    input: {
      reason: 'Endzeit falsch erfasst',
      calendarAdjustment: [
        { timestamp: '2026-09-08T05:00:00.000Z' },
        { timestamp: '2026-09-08T05:30:00.000Z' },
      ],
    },
  });
  await expect(dialog.getByRole('button', { name: 'Korrektur einreichen' })).toBeDisabled();
  await page.evaluate(() => window.calendarWriteContract.complete(0, 'failure', 'period_closed'));
  await expect(dialog.getByRole('alert')).toContainText('abgeschlossen');
  await expect(dialog.getByLabel('Grund')).toHaveValue('Endzeit falsch erfasst');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(block).toBeVisible();
});

test('the phone day list exposes short activities and visits without a cropped timeline', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'Telefonansicht', exact: true }).click();
  const region = page.getByRole('region', { name: 'Kalenderansicht' });
  const travel = region.getByRole('button', { name: /Fahrt.*07:00–07:02/ });
  await expect(travel).toBeVisible();
  await expect(region.getByRole('button', { name: /Freigabe ausstehend/ })).toBeVisible();
  const bounds = await travel.boundingBox();
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  expect(bounds?.width).toBeGreaterThan(250);
  await travel.click();
  expect(await page.evaluate(() => window.calendarViewContract.opened.length)).toBe(1);
  await expect(card(page, 'Kurzer Termin')).toHaveAccessibleName(/2 min/);
  await card(page, 'Kurzer Termin').click();
  expect(await page.evaluate(() => window.calendarViewContract.opened)).toContain('Kurzer Termin');
  expect(
    await region
      .locator('[data-calendar-scroll-container]')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  expect(await writeCount(page)).toBe(0);
});
