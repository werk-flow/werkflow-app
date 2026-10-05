import { expect, type Locator, type Page } from '@playwright/test';
import { MEASURED_VISIT_TITLE } from './performance-profile';
import { realtimeSubscribed } from '../../golden/support/live';
import { createRolePage } from '../../golden/support/sessions';
export { realtimeSubscribed };

/**
 * Waits until a loaded page has finished its Realtime join: the channel is
 * subscribed, the database listener is ready, and the catch-up that readiness
 * dispatches (a route refresh and every subscribed read, about 1.5 s after
 * load) has drained.
 */
export async function settleLiveShell(page: Page): Promise<void> {
  await expect(realtimeSubscribed(page)).toBeAttached();
  await expect(page.locator('html')).toHaveAttribute('data-realtime-postgres-state', 'ready');
  await page.waitForLoadState('networkidle');
}

/**
 * A warm server and a fresh measured browser context. The warm-up session
 * settles and closes before the measured context exists: its Realtime join
 * catch-up once overlapped the measured navigation and made the server answer
 * both at once (customers.list.open, 2026-10-02).
 */
export async function createPerformancePage(
  input: Parameters<typeof createRolePage>[0],
): Promise<{ page: Page; dispose: () => Promise<void> }> {
  const warmup = await createRolePage(input);
  try {
    await warmup.page.goto('/auftraege');
    await expect(
      warmup.page.locator('[data-usable-content-name="auftraege"][data-usable-content="ready"]'),
    ).toBeVisible();
    await settleLiveShell(warmup.page);
  } finally {
    await warmup.context.close();
  }
  const measured = await createRolePage(input);
  return { page: measured.page, dispose: () => measured.context.close() };
}

// Named lookups for the performance audit. The calendar container and the
// list surfaces write their readiness markers from effects
// (components/kalender/calendar-container.tsx, components/shared/usable-content.tsx),
// so these locators end a measurement only after hydration and data coverage.

export function calendarReady(page: Page, view: 'day' | 'week' | 'month', rangeStartIso?: string): Locator {
  const range = rangeStartIso ? `[data-calendar-range-start="${rangeStartIso}"]` : '';
  return page.locator(
    `[data-calendar-scroll-container][data-calendar-state="ready"][data-calendar-view="${view}"]${range}`,
  );
}

export function calendarStale(page: Page): Locator {
  return page.locator('[data-calendar-scroll-container][data-calendar-stale="true"]');
}

export function calendarGrid(page: Page): Locator {
  return page.getByRole('main').locator('[data-calendar-scroll-container]');
}

/**
 * Hold every real calendar-window GET until `fail()` aborts it; never fake its payload or a
 * successful response. Reads that start after `fail()` and before `dispose()` fail too: the
 * provider's catch-up burst re-read the window 85 ms after the first abort and cleared the
 * stale state under test (release campaign, 2026-09-13). The hold models an outage, not one
 * lost request.
 */
export async function holdNextCalendarRead(
  page: Page,
): Promise<{ entered: () => boolean; fail: () => void; dispose: () => Promise<void> }> {
  let entered = false;
  let release: () => void = () => {};
  const held = new Promise<void>((resolveHeld) => {
    release = resolveHeld;
  });
  const handler = async (route: import('@playwright/test').Route): Promise<void> => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    entered = true;
    await held;
    await route.abort('failed');
  };
  await page.route('**/api/calendar-window?*', handler);
  return {
    entered: () => entered,
    fail: release,
    dispose: async () => {
      release();
      await page.unroute('**/api/calendar-window?*', handler);
    },
  };
}

export function firstMonthGridDay(page: Page): Locator {
  return page.locator('[data-month-cell]').first();
}

function usableList(page: Page, name: string): Locator {
  return page.locator(`[data-usable-content-name="${name}"][data-usable-content="ready"]`);
}

export function loadingList(page: Page, name: string): Locator {
  return page.locator(`[data-usable-content-name="${name}"][data-usable-content="loading"]`);
}

export async function usableListCount(page: Page, name: string): Promise<number> {
  const count = await usableList(page, name).getAttribute('data-usable-count');
  if (count === null) throw new Error(`The usable list "${name}" carries no data-usable-count marker.`);
  return Number(count);
}

/** The measured visit's card on the Plantafel (one card: the profile plans it once). */
export function seededBoardCard(page: Page): Locator {
  return page
    .getByRole('main')
    .locator('[data-plantafel] [data-board-row]:not([data-board-row="unassigned"]) [data-calendar-card]')
    .filter({ hasText: MEASURED_VISIT_TITLE });
}

/** The measured visit in the day view, with its resize handles. */
export function seededDayCard(page: Page): Locator {
  return page
    .getByRole('main')
    .locator('[data-day-view] [data-calendar-card]')
    .filter({ hasText: MEASURED_VISIT_TITLE });
}

/** The measured visit listed under one date of the month grid. */
export function seededMonthCard(page: Page, dateIso: string): Locator {
  return page
    .getByRole('main')
    .locator(`[data-month-day="${dateIso}"] [data-calendar-card]`)
    .filter({ hasText: MEASURED_VISIT_TITLE });
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
  const targetElement = await to.elementHandle();
  if (!targetElement) throw new Error('The drag target is not attached.');
  const viewportRange = await from.evaluate((element, targetNode) => {
    const scroller = element.closest<HTMLElement>('[data-calendar-scroll-container]');
    if (!scroller || !targetNode || !scroller.contains(targetNode))
      throw new Error('The drag needs one calendar scroll owner.');
    const viewport = scroller.getBoundingClientRect();
    const headerBottom = Math.max(
      viewport.top,
      ...Array.from(scroller.querySelectorAll('[role="columnheader"]')).map(
        (header) => header.getBoundingClientRect().bottom,
      ),
    );
    const top = Math.max(0, viewport.top + 48, headerBottom + 12);
    const bottom = Math.min(window.innerHeight, viewport.bottom) - 48;
    const source = element.getBoundingClientRect();
    const target = targetNode.getBoundingClientRect();
    const sourceY = source.y + source.height / 2;
    // A tall person-day cell only needs a reachable point, not its whole height.
    const targetY = Math.max(target.top + 12, Math.min(sourceY, target.bottom - 12));
    const first = Math.min(sourceY, targetY);
    const last = Math.max(sourceY, targetY);
    if (last - first > bottom - top) throw new Error('The drag points cannot share the calendar viewport.');
    // Scroll positions round to device pixels; aim inside the safe region.
    const offset = Math.max(last - (bottom - 2), Math.min(0, first - (top + 2)));
    scroller.scrollTop += offset;
    return { top, bottom };
  }, targetElement);
  await targetElement.dispose();
  const source = await from.boundingBox();
  const target = await to.boundingBox();
  if (!source || !target) throw new Error('The drag source or target has no layout.');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('The performance page has no viewport.');
  const startX = source.x + Math.min(20, source.width / 2);
  const startY = source.y + source.height / 2;
  const targetY = Math.max(target.y + 12, Math.min(startY, target.y + target.height - 12));
  if ([startY, targetY].some((point) => point < viewportRange.top || point > viewportRange.bottom))
    throw new Error(
      `The drag points ${startY}/${targetY} do not share the calendar viewport ${viewportRange.top}–${viewportRange.bottom}.`,
    );
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY, { steps: 2 });
  await page.mouse.move(target.x + target.width / 2, targetY, { steps: 12 });
  await expect(page.locator('body')).toHaveClass(/is-dragging/);
  return () => page.mouse.up();
}

export function calendarClosure(page: Page, label: string): Locator {
  return page.getByRole('main').locator('[data-calendar-scroll-container]').getByText(label, { exact: true });
}

/** The exact person's synthetic 07:00–09:30 correction in the owned date cell. */
export function calendarCorrectionBlock(page: Page, dateIso: string, personName: string): Locator {
  return page
    .getByRole('main')
    .locator(`[data-month-day="${dateIso}"]`)
    .locator('[data-time-block]')
    .filter({ hasText: personName })
    .filter({ hasText: '2 Std. 30 Min.' });
}

export function correctionRequestCard(page: Page, requestId: string): Locator {
  return page.getByRole('main').getByTestId(`time-correction-${requestId}`);
}

export async function openBenchmarkMonth(page: Page, date: string): Promise<void> {
  await page.goto(`/kalender?date=${encodeURIComponent(date)}`);
  await page.getByRole('tab', { name: 'Monat', exact: true }).click();
}

/** Opens the clock sheet from the clock button and waits for its actions. */
export async function openClockSheet(page: Page, running: boolean): Promise<void> {
  await page.locator(`button[title="${running ? 'Zeiterfassung öffnen' : 'Zeiterfassung starten'}"]`).click();
  await expect(clockSheetActions(page)).toBeVisible();
}

function clockSheetActions(page: Page): Locator {
  return page.getByRole('group', { name: 'Nächste Aktion', exact: true });
}

export function clockSheetAction(page: Page, label: 'Arbeit starten' | 'Erfassung beenden'): Locator {
  return clockSheetActions(page).getByRole('button', { name: label, exact: true });
}

/** One open submission of a person in the approval list, named by its time range. */
export function pendingApprovalCard(page: Page, userId: string, timeRange: string): Locator {
  return page
    .getByRole('main')
    .locator(`[data-testid^="pending-session-"][data-user-id="${userId}"]`)
    .filter({ hasText: timeRange });
}

export function boardCellOf(page: Page, employeeRecordId: string, dateIso: string): Locator {
  return page
    .getByRole('main')
    .locator(
      `[data-plantafel] [data-board-row="${employeeRecordId}"] [data-board-cell][data-date="${dateIso}"]`,
    );
}

export function monthCellOf(page: Page, dateIso: string): Locator {
  return page.getByRole('main').locator(`[data-month-cell="${dateIso}"]`);
}
