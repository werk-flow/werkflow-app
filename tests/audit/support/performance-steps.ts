import type { Locator, Page } from "@playwright/test";
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
  return page.locator(".fc-daygrid-day[data-date]").first();
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

/** Any seeded visit block of the typical profile; the day decides which job numbers it carries. */
export function seededJobBlock(page: Page): Locator {
  return page.getByRole("main").getByText(/Auftrag \d+: (?:Heizung warten|Bad sanieren)/).first();
}

export function calendarClosure(page: Page, label: string): Locator {
  return page.getByRole("main").locator("[data-calendar-scroll-container]").getByText(label, { exact: true });
}

/** The exact person's synthetic 07:00â€“09:30 correction in the owned date cell. */
export function calendarCorrectionBlock(page: Page, dateIso: string, personName: string): Locator {
  return page.getByRole("main").locator(`.fc-daygrid-day[data-date="${dateIso}"]`).locator(".fc-event-custom")
    .filter({ hasText: personName }).filter({ hasText: "2h 30m" });
}

export function correctionRequestCard(page: Page, requestId: string): Locator {
  return page.getByRole("main").getByTestId(`time-correction-${requestId}`);
}

export async function openBenchmarkMonth(page: Page, date: string): Promise<void> {
  await page.goto(`/kalender?date=${encodeURIComponent(date)}`);
  await page.getByRole("tab", { name: "Monat", exact: true }).click();
}
