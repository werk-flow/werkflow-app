import { expect, type Locator, type Page } from "@playwright/test";
import { MEASURED_VISIT_TITLE } from "./performance-profile";
export { realtimeSubscribed } from "../../golden/support/live";
export { createMeasurementPage as createPerformancePage } from "../../golden/support/scenario-measurement";

// Named lookups for the performance audit. The calendar container and the
// list surfaces write their readiness markers from effects
// (components/kalender/calendar-container.tsx, components/shared/usable-content.tsx),
// so these locators end a measurement only after hydration and data coverage.

export function calendarReady(page: Page, view: "day" | "week" | "month", rangeStartIso?: string): Locator {
  const range = rangeStartIso ? `[data-calendar-range-start="${rangeStartIso}"]` : "";
  return page.locator(`[data-calendar-scroll-container][data-calendar-state="ready"][data-calendar-view="${view}"]${range}`);
}

export function calendarStale(page: Page): Locator {
  return page.locator('[data-calendar-scroll-container][data-calendar-stale="true"]');
}

export function calendarGrid(page: Page): Locator {
  return page.getByRole("main").locator("[data-calendar-scroll-container]");
}

/**
 * Hold every real calendar-window GET until `fail()` aborts it; never fake its payload or a
 * successful response. Reads that start after `fail()` and before `dispose()` fail too: the
 * provider's catch-up burst re-read the window 85 ms after the first abort and cleared the
 * stale state under test (release campaign, 2026-09-13). The hold models an outage, not one
 * lost request.
 */
export async function holdNextCalendarRead(page: Page): Promise<{ entered: () => boolean; fail: () => void; dispose: () => Promise<void> }> {
  let entered = false;
  let release: () => void = () => {};
  const held = new Promise<void>((resolveHeld) => { release = resolveHeld; });
  const handler = async (route: import("@playwright/test").Route): Promise<void> => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    entered = true;
    await held;
    await route.abort("failed");
  };
  await page.route("**/api/calendar-window?*", handler);
  return { entered: () => entered, fail: release, dispose: async () => { release(); await page.unroute("**/api/calendar-window?*", handler); } };
}

export function firstMonthGridDay(page: Page): Locator {
  return page.locator("[data-month-cell]").first();
}

function usableList(page: Page, name: string): Locator {
  return page.locator(`[data-usable-content-name="${name}"][data-usable-content="ready"]`);
}

export function loadingList(page: Page, name: string): Locator {
  return page.locator(`[data-usable-content-name="${name}"][data-usable-content="loading"]`);
}

export async function usableListCount(page: Page, name: string): Promise<number> {
  const count = await usableList(page, name).getAttribute("data-usable-count");
  if (count === null) throw new Error(`The usable list "${name}" carries no data-usable-count marker.`);
  return Number(count);
}

/** The measured visit's card on the Plantafel (one card: the profile plans it once). */
export function seededBoardCard(page: Page): Locator {
  return page.getByRole("main").locator('[data-plantafel] [data-board-row]:not([data-board-row="unassigned"]) [data-calendar-card]').filter({ hasText: MEASURED_VISIT_TITLE });
}

/** The measured visit in the day view, with its resize handles. */
export function seededDayCard(page: Page): Locator {
  return page.getByRole("main").locator('[data-day-view] [data-calendar-card]').filter({ hasText: MEASURED_VISIT_TITLE });
}

/** The measured visit listed under one date of the month grid. */
export function seededMonthCard(page: Page, dateIso: string): Locator {
  return page.getByRole("main").locator(`[data-month-day="${dateIso}"] [data-calendar-card]`).filter({ hasText: MEASURED_VISIT_TITLE });
}

/**
 * Presses on `from`, crosses the drag threshold and moves onto `to` without
 * releasing. The returned function releases the pointer: the measured
 * trigger, so the gesture itself never counts toward the interaction budget.
 */
export async function holdPointerDrag(page: Page, from: Locator, to: Locator): Promise<() => Promise<void>> {
  // Both ends of the drag sit in the viewport: the pointer never scrolls the board during the gesture.
  await from.scrollIntoViewIfNeeded();
  await to.scrollIntoViewIfNeeded();
  const source = await from.boundingBox();
  const target = await to.boundingBox();
  if (!source || !target) throw new Error("The drag source or target has no layout.");
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The performance page has no viewport.");
  const inView = (box: { y: number; height: number }): boolean => box.y >= 0 && box.y + box.height / 2 <= viewport.height;
  if (!inView(source) || !inView(target)) throw new Error(`The drag source (y ${Math.round(source.y)}) and target (y ${Math.round(target.y)}, ${Math.round(target.height)} px) do not share the ${viewport.height} px viewport.`);
  const startX = source.x + Math.min(20, source.width / 2);
  const startY = source.y + source.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY, { steps: 2 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await expect(page.locator("body")).toHaveClass(/is-dragging/);
  return () => page.mouse.up();
}

export function calendarClosure(page: Page, label: string): Locator {
  return page.getByRole("main").locator("[data-calendar-scroll-container]").getByText(label, { exact: true });
}

/** The exact person's synthetic 07:00â€“09:30 correction in the owned date cell. */
export function calendarCorrectionBlock(page: Page, dateIso: string, personName: string): Locator {
  return page.getByRole("main").locator(`[data-month-day="${dateIso}"]`).locator("[data-time-block]")
    .filter({ hasText: personName }).filter({ hasText: "2 Std. 30 Min." });
}

export function correctionRequestCard(page: Page, requestId: string): Locator {
  return page.getByRole("main").getByTestId(`time-correction-${requestId}`);
}

export async function openBenchmarkMonth(page: Page, date: string): Promise<void> {
  await page.goto(`/kalender?date=${encodeURIComponent(date)}`);
  await page.getByRole("tab", { name: "Monat", exact: true }).click();
}

export function boardCellOf(page: Page, employeeRecordId: string, dateIso: string): Locator {
  return page.getByRole("main").locator(`[data-plantafel] [data-board-row="${employeeRecordId}"] [data-board-cell][data-date="${dateIso}"]`);
}

export function monthCellOf(page: Page, dateIso: string): Locator {
  return page.getByRole("main").locator(`[data-month-cell="${dateIso}"]`);
}
