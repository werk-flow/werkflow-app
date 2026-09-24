import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Named lookups for the calendar of P1-24a (the Plantafel, the day and the
 * month view). The views expose their structure through data attributes
 * (docs/technical/realtime-and-caching.md, design skill "Calendar canon");
 * specs go through these helpers instead of repeating the markup.
 */

export function calendarViewReady(page: Page, view: "day" | "week" | "month"): Locator {
  return page.locator(`[data-calendar-scroll-container][data-calendar-state="ready"][data-calendar-view="${view}"]`);
}

export async function openPlantafel(page: Page, dateIso: string): Promise<void> {
  await page.goto(`/kalender?date=${dateIso}`);
  // The view persists per user: an earlier month or day step leaves the landing there.
  const tab = page.getByRole("tab", { name: /^(Plantafel|Woche)$/ });
  await expect(tab).toBeVisible({ timeout: 30_000 });
  if ((await tab.getAttribute("data-state")) !== "active") await tab.click();
  await expect(calendarViewReady(page, "week")).toBeVisible({ timeout: 30_000 });
}

export async function openCalendarView(page: Page, dateIso: string, view: "day" | "month", tab: string): Promise<void> {
  await page.goto(`/kalender?date=${dateIso}`);
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await expect(calendarViewReady(page, view)).toBeVisible({ timeout: 30_000 });
}

export function plantafel(page: Page): Locator {
  return page.getByRole("main").locator("[data-plantafel]");
}

export function boardRows(page: Page): Locator {
  return plantafel(page).locator("[data-board-row]");
}

export function boardTeamHeader(page: Page, teamName: string): Locator {
  return plantafel(page).locator("[data-board-team]").filter({ hasText: teamName });
}

export function boardColumn(page: Page, dateIso: string): Locator {
  return plantafel(page).locator(`[data-board-column="${dateIso}"]`);
}

/** A visit card in one person's row; `dateIso` narrows to the card that starts on that date. */
export function boardCard(page: Page, employeeRecordId: string, title: string, dateIso?: string): Locator {
  const row = plantafel(page).locator(`[data-board-row="${employeeRecordId}"]`);
  const scope = dateIso ? row.locator(`[data-board-item-date="${dateIso}"]`) : row;
  return scope.locator("[data-calendar-card]").filter({ hasText: title });
}

export function boardCell(page: Page, employeeRecordId: string, dateIso: string): Locator {
  return plantafel(page).locator(`[data-board-row="${employeeRecordId}"] [data-board-cell][data-date="${dateIso}"]`);
}

export function boardAbsenceBar(page: Page, employeeRecordId: string, label: string): Locator {
  return plantafel(page).locator(`[data-board-row="${employeeRecordId}"] [data-calendar-bar="absence"]`).filter({ hasText: label });
}

export function dragGhost(page: Page): Locator {
  return page.locator("[data-calendar-drag-ghost]");
}

export function jobPopover(page: Page): Locator {
  return page.locator("[data-job-popover]");
}

export function parkplatzButton(page: Page): Locator {
  return page.getByRole("button", { name: /^Parkplatz/ });
}

export function parkplatzCardOf(page: Page, title: string): Locator {
  return page.locator("[data-parkplatz-panel] [data-parkplatz-card]").filter({ hasText: title });
}

export function dayRow(page: Page, userId: string): Locator {
  return page.getByRole("main").locator(`[data-day-view] [data-day-row="${userId}"]`);
}

export function dayTimeline(row: Locator): Locator {
  return row.locator("[data-day-timeline]");
}

export function dayCard(row: Locator, title: string): Locator {
  return row.locator("[data-calendar-card]").filter({ hasText: title });
}

export function monthDay(page: Page, dateIso: string): Locator {
  return page.getByRole("main").locator(`[data-month-day="${dateIso}"]`);
}

export function monthCell(page: Page, dateIso: string): Locator {
  return page.getByRole("main").locator(`[data-month-cell="${dateIso}"]`);
}

export function monthDayPopover(page: Page, dateIso: string): Locator {
  return page.locator(`[data-month-day-popover="${dateIso}"]`);
}

export function monthCards(scope: Locator, title?: string): Locator {
  const cards = scope.locator("[data-calendar-card]");
  return title ? cards.filter({ hasText: title }) : cards;
}

export function calendarHolidayLabel(page: Page, label: string): Locator {
  return page.getByRole("main").locator("[data-calendar-holiday]").filter({ hasText: label });
}

export function calendarAbsenceBarStarting(page: Page, dateIso: string, label: string): Locator {
  return page.getByRole("main").locator(`[data-calendar-bar="absence"][data-bar-start="${dateIso}"]`).filter({ hasText: label });
}

export function inMonthCells(page: Page): Locator {
  return page.getByRole("main").locator('[data-month-cell][data-in-month="true"]');
}

/** The trailing resize handle of a card; the card exposes its handles positionally by design. */
export function trailingResizeHandle(card: Locator): Locator {
  return card.locator('[role="presentation"]').last();
}

/**
 * Presses on `from`, crosses the engine's threshold, moves onto `to` and
 * releases unless told otherwise. Modifier keys are held across the move.
 */
export async function dragCardTo(page: Page, from: Locator, to: Locator, options: { release?: boolean; alt?: boolean } = {}): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const source = await from.boundingBox();
  const target = await to.boundingBox();
  if (!source || !target) throw new Error("The drag source or target has no layout.");
  const startX = source.x + Math.min(20, source.width / 2);
  const startY = source.y + source.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY, { steps: 2 });
  if (options.alt) await page.keyboard.down("Alt");
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  if (options.release !== false) {
    await page.mouse.up();
    if (options.alt) await page.keyboard.up("Alt");
  }
}

/** Presses on a card, crosses the threshold and moves to an absolute viewport point without releasing. */
export async function beginCardDragToPoint(page: Page, from: Locator, point: { x: number; y: number }): Promise<void> {
  const source = await from.boundingBox();
  if (!source) throw new Error("The drag source has no layout.");
  const startX = source.x + Math.min(20, source.width / 2);
  const startY = source.y + source.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY, { steps: 2 });
  await page.mouse.move(point.x, point.y, { steps: 10 });
}

/** Drags a resize handle by `deltaPx` along the axis and releases. */
export async function dragHandleBy(page: Page, handle: Locator, deltaPx: number): Promise<void> {
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error("The resize handle has no layout.");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + Math.sign(deltaPx) * 8, y, { steps: 2 });
  await page.mouse.move(x + deltaPx, y, { steps: 8 });
  await page.mouse.up();
}

/** Drags a handle onto the centre of a target element. */
export async function dragHandleTo(page: Page, handle: Locator, target: Locator): Promise<void> {
  const bounds = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  if (!bounds || !targetBox) throw new Error("The handle or its target has no layout.");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 12, bounds.y + bounds.height / 2, { steps: 2 });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 });
  await page.mouse.up();
}

/** Drags across empty time of a day row: from `startHour` to `endHour` (fractions allowed). */
export async function dragToCreateOnDayRow(page: Page, timeline: Locator, startHour: number, endHour: number): Promise<void> {
  const bounds = await timeline.boundingBox();
  if (!bounds) throw new Error("The day timeline has no layout.");
  const hour = bounds.width / 24;
  const y = bounds.y + bounds.height - 6;
  await page.mouse.move(bounds.x + hour * startHour, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + hour * endHour, y, { steps: 6 });
  await page.mouse.up();
}

/** The feedback banners: alerts that carry the close button (other alert roles are inline errors). */
export function banners(page: Page): Locator {
  return page.getByRole("alert").filter({ visible: true }).filter({ has: page.getByRole("button", { name: "Hinweis schließen", exact: true }) });
}

export function successBanner(page: Page, text: string | RegExp): Locator {
  return banners(page).filter({ hasText: text });
}

/** Closes every visible banner; the calendar's confirmations stay until dismissed. */
export async function closeBanners(page: Page): Promise<void> {
  const open = banners(page);
  for (let attempt = 0; attempt < 10 && (await open.count()) > 0; attempt += 1) {
    // A banner auto-dismisses after a few seconds; one that leaves mid-click is closed all the same.
    await open.first().getByRole("button", { name: "Hinweis schließen", exact: true }).click({ timeout: 2_000 }).catch(() => undefined);
  }
  await expect(open).toHaveCount(0, { timeout: 10_000 });
}
