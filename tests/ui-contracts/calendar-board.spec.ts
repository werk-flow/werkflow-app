import { expect, test } from '@playwright/test';
import { boardCell, boardHighlight, boardRowCard, card, dragGhost, dragPointer, expectBanner, isDragging, openCalendarContract, saving, writeCount } from './calendar-views-support';

// The Plantafel against the real range owner, drag engine and optimistic
// owner (P1-24a, criteria 26 to 29): a drop moves the card before the write
// settles, a refused write restores it with the rule's sentence, a confirmed
// write offers Undo through the inverse write, read-only mode refuses the
// drag, and a pointer move commits nothing in React.

const TITLE = 'Prüfauftrag ziehen';

test.beforeEach(async ({ page }) => {
  await openCalendarContract(page, 'calendar-board');
  await expect(card(page, TITLE)).toBeVisible();
});

test('a reassign drop moves the card optimistically, writes the planning entry, and a refusal restores it with the sentence', async ({ page }) => {
  await dragPointer(page, card(page, TITLE), boardCell(page, 'r2', '2026-09-09'));
  await expect(boardRowCard(page, 'r2', TITLE)).toBeVisible();
  await expect(saving(page)).toHaveText('aktiv');
  await expect.poll(() => writeCount(page)).toBe(1);
  const input = await page.evaluate(() => window.calendarWriteContract.calls[0]);
  expect(input?.kind).toBe('planning');
  expect(input?.id).toBe('o1');
  expect(input?.input).toMatchObject({ plannedDate: '2026-09-09', selectedEmployeeRecordIds: ['r2'] });
  await expect(page.getByRole('button', { name: 'Rückgängig', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.calendarWriteContract.complete(0, 'failure', 'started_occurrence'));
  await expectBanner(page, 'Begonnene oder vergangene Termine bleiben unverändert');
  await expect(boardRowCard(page, 'r1', TITLE)).toBeVisible();
  await expect(saving(page)).toHaveText('frei');
  await expect.poll(() => page.evaluate(() => window.calendarContract.reads.length)).toBeGreaterThan(0);
});

test('a confirmed drop offers Undo, which writes the inverse and reports its own failure', async ({ page }) => {
  await dragPointer(page, card(page, TITLE), boardCell(page, 'r2', '2026-09-09'));
  await expect.poll(() => writeCount(page)).toBe(1);
  await page.evaluate(() => window.calendarWriteContract.complete(0, 'success'));
  await expectBanner(page, 'Termin wurde zu Bea Zwei auf 9.9. verschoben.');
  await expect(saving(page)).toHaveText('frei');
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect.poll(() => writeCount(page)).toBe(2);
  const undo = await page.evaluate(() => window.calendarWriteContract.calls[1]);
  expect(undo?.input).toMatchObject({ plannedDate: '2026-09-08', selectedEmployeeRecordIds: ['r1'] });
  await expect(boardRowCard(page, 'r1', TITLE)).toBeVisible();
  await page.evaluate(() => window.calendarWriteContract.complete(1, 'reject'));
  await expectBanner(page, 'Rückgängig war nicht möglich');
  await expect(saving(page)).toHaveText('frei');
});

test('a transport rejection restores the card and names the connection', async ({ page }) => {
  await dragPointer(page, card(page, TITLE), boardCell(page, 'r1', '2026-09-10'));
  await expect.poll(() => writeCount(page)).toBe(1);
  await page.evaluate(() => window.calendarWriteContract.complete(0, 'reject'));
  await expectBanner(page, 'Prüfe die Verbindung');
  await expect(boardRowCard(page, 'r1', TITLE)).toBeVisible();
  await expect(saving(page)).toHaveText('frei');
});

test('a started occurrence is history: not a drag source, no handles, no write', async ({ page }) => {
  const started = card(page, 'Begonnener Termin');
  await expect(started).toHaveAttribute('data-locked', '');
  await expect(started).toHaveAccessibleName(/begonnen oder vergangen/);
  await dragPointer(page, started, boardCell(page, 'r1', '2026-09-10'));
  expect(await writeCount(page)).toBe(0);
  await expect(boardRowCard(page, 'r2', 'Begonnener Termin')).toBeVisible();
  await expect(card(page, TITLE)).not.toHaveAttribute('data-locked', '');
});

test('pointer moves during a drag commit nothing in React and Escape cancels without a write', async ({ page }) => {
  const before = await page.evaluate(() => window.calendarViewContract.commits);
  await dragPointer(page, card(page, TITLE), boardCell(page, 'r2', '2026-09-11'), { release: false, moves: 25, beforeRelease: async () => {
    await expect(isDragging(page)).toHaveCount(1);
    await expect(dragGhost(page)).toBeVisible();
    await expect(boardHighlight(page)).toBeVisible();
  } });
  expect(await page.evaluate(() => window.calendarViewContract.commits)).toBe(before);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(isDragging(page)).toHaveCount(0);
  expect(await writeCount(page)).toBe(0);
  await expect(boardRowCard(page, 'r1', TITLE)).toBeVisible();
});

test('Enter on a focused card opens it and arrow keys move between cells', async ({ page }) => {
  await card(page, TITLE).focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.calendarViewContract.opened)).toEqual([TITLE]);
  await boardCell(page, 'r1', '2026-09-08').focus();
  await page.keyboard.press('ArrowRight');
  await expect(boardCell(page, 'r1', '2026-09-09')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(boardCell(page, 'r2', '2026-09-09')).toBeFocused();
});
