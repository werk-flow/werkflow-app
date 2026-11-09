import { expect, test } from '@playwright/test';
import {
  boardCell,
  boardRowCard,
  card,
  dragPointer,
  openCalendarContract,
  writeCount,
} from './calendar-views-support';

// werk-flow/werkflow-planning#62: a person who left keeps no silent visits. A visit nobody else works
// shows in „Ohne Zuweisung“, a shared one stays with the people who remain, every card names the
// leaver, and a hatched day with planned work reads as overbooked.

const SOLO = 'Wartung Erik allein';
const SHARED = 'Heizung zu zweit';
const LEFT = 'Ausgeschieden: Erik Lindner';

test.beforeEach(async ({ page }) => {
  await openCalendarContract(page, 'calendar-board');
});

test('in the week after an exit, the leaver’s solo visit waits in „Ohne Zuweisung“ and the shared one stays with the other worker', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Woche nach dem Austritt', exact: true }).click();
  await expect(boardCell(page, 'r-erik', '2026-09-10')).toHaveCount(0);
  await expect(boardRowCard(page, 'unassigned', SOLO)).toContainText(LEFT);
  await expect(boardRowCard(page, 'r2', SHARED)).toContainText(LEFT);
  await expect(boardRowCard(page, 'unassigned', SHARED)).toHaveCount(0);
  await expect(card(page, SOLO)).toHaveAccessibleName(new RegExp(`${LEFT}$`));
});

test('a card taken from „Ohne Zuweisung“ onto a person replaces the leaver', async ({ page }) => {
  await page.getByRole('button', { name: 'Woche nach dem Austritt', exact: true }).click();
  await dragPointer(page, boardRowCard(page, 'unassigned', SOLO), boardCell(page, 'r1', '2026-09-10'));
  await expect(boardRowCard(page, 'r1', SOLO)).toBeVisible();
  await expect(boardRowCard(page, 'unassigned', SOLO)).toHaveCount(0);
  await expect.poll(() => writeCount(page)).toBe(1);
  const input = await page.evaluate(() => window.calendarWriteContract.calls[0]);
  expect(input?.input).toMatchObject({ selectedEmployeeRecordIds: ['r1'] });
});

test('in the exit week a visit on a hatched day stays in the leaver’s row, warned, and the day reads overbooked', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Austrittswoche', exact: true }).click();
  await expect(boardRowCard(page, 'r-erik', SOLO)).toContainText(LEFT);
  await expect(boardRowCard(page, 'unassigned', SOLO)).toContainText(LEFT);
  await expect(boardCell(page, 'r-erik', '2026-09-10')).toHaveAttribute('data-capacity', 'overbooked');
  await expect(boardCell(page, 'r-erik', '2026-09-10')).toHaveAccessibleName(
    /Nicht beschäftigt, trotzdem 1 h geplant$/,
  );
  await expect(boardCell(page, 'r-erik', '2026-09-09')).not.toHaveAttribute('data-capacity', 'overbooked');
});

test('a search that hides the leaver’s all-day visit leaves its hatched day overbooked', async ({ page }) => {
  await page.getByRole('button', { name: 'Austrittswoche', exact: true }).click();
  const saturday = boardCell(page, 'r-erik', '2026-09-12');
  await expect(saturday).toHaveAttribute('data-capacity', 'overbooked');
  await page.getByRole('button', { name: 'Nach Prüfauftrag suchen', exact: true }).click();
  await expect(boardRowCard(page, 'r-erik', 'Montage Erik ganztägig')).toHaveCount(0);
  await expect(saturday).toHaveAttribute('data-capacity', 'overbooked');
  await expect(saturday).toHaveAccessibleName(/Nicht beschäftigt, trotzdem eingeplant$/);
});
