import { expect, test } from "../support/fixtures";
import { expectUsableWithin } from "../../golden/support/scenario-measurement";
import { bannerTarget, boardCardTarget, calendarTarget, standaloneCalendarVisitTarget } from "../../golden/support/browser-observation";
import { LIVE_WEEK_DAYS, liveWeekStart, monthWindowDates, seedTypicalProfile, TYPICAL_PROFILE, TYPICAL_PROFILE_BUSINESS_DATE, type TypicalProfileCounts } from "../support/performance-profile";
import { closeBanners, dragHandleBy, trailingResizeHandle } from "../../golden/support/plantafel";
import { boardCellOf, calendarGrid, calendarReady, calendarStale, createPerformancePage, firstMonthGridDay, holdNextCalendarRead, holdPointerDrag, monthCellOf, realtimeSubscribed, seededBoardCard, seededDayCard, seededMonthCard } from "../support/performance-steps";
import { requireChainedValue } from "../../golden/support/preconditions";
import { auditCheckpoint, saveAuditCheckpoint } from "../support/checkpoints";
import { resolveBerlinWallTime } from "../../../lib/planning/date-time";
import { shiftIsoDateByDays } from "../../../lib/personnel/types";

// Performance profile audit (Step 2, rewritten for P1-24a). Measures the
// landing Plantafel, every view switch, the six-week horizon and the three
// drops (reassign on the board, resize in the day, move in the month) against
// the typical data profile in this group's own organization. Every scenario
// id is registered in lib/testing/measured-scenarios.ts; the run qualifies
// only when each records its three declared samples, within budget, and
// without a regression against its reviewed baseline. The group runs exclusively.

const BUSINESS_DATE = TYPICAL_PROFILE_BUSINESS_DATE;
const CALENDAR_ENTRY = `/kalender?date=${BUSINESS_DATE}`;
/** The live week carries the measured visit; a started visit cannot be moved. */
const LIVE_DATE = liveWeekStart();
const NEXT_DATE = shiftIsoDateByDays(LIVE_DATE, 1);
const LIVE_ENTRY = `/kalender?date=${LIVE_DATE}`;

/** Start instant of the month grid window for the month after `dateIso`, as the container records it. */
function nextMonthRangeStartIso(dateIso: string): string {
  const [year, month] = dateIso.split("-").map(Number);
  if (year === undefined || month === undefined) throw new Error(`Invalid ISO date: ${dateIso}`);
  const nextMonth = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`;
  const window = monthWindowDates(nextMonth);
  const start = resolveBerlinWallTime(`${window.from}T00:00`);
  if (!start) throw new Error(`Cannot resolve ${window.from} in Europe/Berlin.`);
  return start.instant.toISOString();
}

test.describe("Performance profile @AUDIT-PERFORMANCE", () => {
  test("PERF-01 seeds the typical profile into the group's organization @AUDIT-PERFORMANCE-01", async ({ world }) => {
    const counts: TypicalProfileCounts = await seedTypicalProfile(world);
    saveAuditCheckpoint("performance.typicalProfile", { windowFrom: counts.window.from, assignedJobNumber: counts.assignedJobNumber });
    expect(counts.employeeRecords).toBe(TYPICAL_PROFILE.employees);
    expect(counts.customers).toBe(TYPICAL_PROFILE.customers);
    expect(counts.jobs).toBe(TYPICAL_PROFILE.jobs);
    // Every synthetic day of the month and of the live week, plus the one measured visit.
    expect(counts.occurrences).toBe(TYPICAL_PROFILE.occurrencesPerDay * (counts.window.days + LIVE_WEEK_DAYS) + 1);
    expect(counts.workdays).toBeGreaterThanOrEqual(30);
    // Each seeded window stays below the planning read cap; the month is the larger one.
    expect(TYPICAL_PROFILE.occurrencesPerDay * counts.window.days).toBeLessThanOrEqual(2_000);
    expect(counts.timeEntries).toBeGreaterThan(0);
  });

  test("PERF-02 calendar entry, drops and view switches report usable content within budget @AUDIT-PERFORMANCE-02", async ({ adminPage }) => {
    requireChainedValue(auditCheckpoint("performance.typicalProfile")?.windowFrom ?? "", {
      test: "PERF-02", needs: "the seeded typical profile from PERF-01", grep: "PERF-01|PERF-02", suite: "audit",
    });
    for (const sample of [1, 2, 3]) {
    const { context, page } = await createPerformancePage(adminPage);
    try {
    await test.step(`Declared navigation sample ${sample}`, async () => {
    await expectUsableWithin("calendar.board.cold-open", {
      page,
      trigger: () => page.goto(CALENDAR_ENTRY),
      usable: calendarTarget(page, "week"),
    });
    // A fresh read never reports stale data. The drops work on the live week.
    await expect(calendarStale(page)).toHaveCount(0);
    await page.goto(LIVE_ENTRY);
    await expect(calendarReady(page, "week")).toBeVisible({ timeout: 30_000 });
    await expect(seededBoardCard(page)).toBeVisible();
    // The drop scenarios measure a settled shell: the Realtime join catch-up
    // fans out every subscribed read a few seconds after entry (PF-23).
    await expect(realtimeSubscribed(page)).toBeAttached();
    await page.waitForLoadState("networkidle");

    // Reassign: the card of one person lands in another person's row on the
    // same day. The release is the trigger; the gesture before it is not measured.
    const card = seededBoardCard(page);
    const title = (await card.textContent() ?? "").match(/Auftrag \d+: (?:Heizung warten|Bad sanieren)/)?.[0] ?? "";
    expect(title).not.toBe("");
    const sourceRow = await card.evaluate((element) => element.closest("[data-board-row]")?.getAttribute("data-board-row") ?? "");
    // The target is the person row beside the source on the board (four visits, room for one more): both
    // rows share the viewport, so the pointer never scrolls the board.
    const rowIds = await page.locator("[data-plantafel] [data-board-row]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-board-row") ?? ""));
    const sourceIndex = rowIds.indexOf(sourceRow);
    const neighbours = [rowIds[sourceIndex + 1], rowIds[sourceIndex - 1]].filter((row): row is string => Boolean(row) && row !== "unassigned");
    const targetRow = neighbours[0];
    if (!sourceRow || !targetRow) throw new Error("The Plantafel needs a person row beside the measured visit for the reassign scenario.");
    await expect(boardCellOf(page, targetRow, LIVE_DATE)).toBeVisible();
    const releaseThere = await holdPointerDrag(page, card, boardCellOf(page, targetRow, LIVE_DATE));
    await expectUsableWithin("calendar.board.reassign.visible", {
      page,
      trigger: releaseThere,
      usable: boardCardTarget(page, title, targetRow),
    });
    await expect(page.getByRole("alert").filter({ hasText: "verschoben" })).toBeVisible({ timeout: 15_000 });
    await closeBanners(page);
    const releaseBack = await holdPointerDrag(page, boardCardTarget(page, title, targetRow).locator, boardCellOf(page, sourceRow, LIVE_DATE));
    await expectUsableWithin("calendar.board.reassign.settled", {
      page,
      trigger: releaseBack,
      usable: bannerTarget(page, "verschoben"),
    });
    await closeBanners(page);
    await expect(boardCardTarget(page, title, sourceRow).locator).toBeVisible();

    await expectUsableWithin("calendar.board-to-day.covered", {
      page,
      trigger: () => page.getByRole("tab", { name: "Tag", exact: true }).click(),
      usable: calendarTarget(page, "day"),
    });
    // Resize: the end handle of a timed visit moves an hour later.
    const dayCard = seededDayCard(page);
    await expect(dayCard).toBeVisible();
    // The hour axis opens at 05:00; the 04:00 visit sits under the sticky name column until scrolled to.
    await dayCard.evaluate((element) => element.scrollIntoView({ inline: "center", block: "center" }));
    const handle = trailingResizeHandle(dayCard);
    const bounds = await handle.boundingBox();
    if (!bounds) throw new Error("The day view's resize handle has no layout.");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 8, bounds.y + bounds.height / 2, { steps: 2 });
    await page.mouse.move(bounds.x + bounds.width / 2 + 70, bounds.y + bounds.height / 2, { steps: 6 });
    await expectUsableWithin("calendar.day.resize.settled", {
      page,
      trigger: () => page.mouse.up(),
      usable: bannerTarget(page, "Termin dauert jetzt"),
    });
    await closeBanners(page);
    // The visit returns to its hour, so the next sample resizes the same visit (not measured).
    await dragHandleBy(page, trailingResizeHandle(seededDayCard(page)), -70);
    await expect(page.getByRole("alert").filter({ hasText: "Termin dauert jetzt" })).toBeVisible({ timeout: 15_000 });
    await closeBanners(page);

    await expectUsableWithin("calendar.day-to-board.covered", {
      page,
      trigger: () => page.getByRole("tab", { name: "Plantafel", exact: true }).click(),
      usable: calendarTarget(page, "week"),
    });
    await expectUsableWithin("calendar.board.six-weeks", {
      page,
      trigger: async () => {
        await page.getByLabel("Horizont").click();
        await page.getByRole("option", { name: "6 Wochen" }).click();
      },
      usable: calendarTarget(page, "week", undefined, 6),
    });
    await page.getByLabel("Horizont").click();
    await page.getByRole("option", { name: "1 Woche" }).click();
    await expect(calendarReady(page, "week")).toHaveAttribute("data-calendar-horizon", "1");

    await expectUsableWithin("calendar.board-to-month.uncovered", {
      page,
      trigger: () => page.getByRole("tab", { name: "Monat", exact: true }).click(),
      usable: calendarTarget(page, "month"),
    });
    await expect(firstMonthGridDay(page)).toBeVisible();
    // Move: a visit of the business date lands on the next day's cell.
    const monthCard = seededMonthCard(page, LIVE_DATE);
    const monthTitle = (await monthCard.textContent() ?? "").match(/Auftrag \d+: (?:Heizung warten|Bad sanieren)/)?.[0] ?? "";
    expect(monthTitle).not.toBe("");
    const releaseMonth = await holdPointerDrag(page, monthCard, monthCellOf(page, NEXT_DATE));
    await expectUsableWithin("calendar.month.move.visible", {
      page,
      trigger: releaseMonth,
      usable: standaloneCalendarVisitTarget(page, monthTitle, NEXT_DATE),
    });
    await expect(page.getByRole("alert").filter({ hasText: "verschoben" })).toBeVisible({ timeout: 15_000 });
    await closeBanners(page);
    // The way back: the visit returns to the live date, and the settled banner is the measured target.
    const secondMonthCard = seededMonthCard(page, NEXT_DATE);
    const releaseSecond = await holdPointerDrag(page, secondMonthCard, monthCellOf(page, LIVE_DATE));
    await expectUsableWithin("calendar.month.move.settled", {
      page,
      trigger: releaseSecond,
      usable: bannerTarget(page, "verschoben"),
    });
    await closeBanners(page);

    await expectUsableWithin("calendar.month-next.uncovered", {
      page,
      trigger: () => page.getByRole("button", { name: "Weiter" }).click(),
      usable: calendarTarget(page, "month", nextMonthRangeStartIso(LIVE_DATE)),
    });
    await expectUsableWithin("calendar.month-to-board.covered", {
      page,
      trigger: () => page.getByRole("tab", { name: "Plantafel", exact: true }).click(),
      usable: calendarTarget(page, "week"),
    });
    await expect(calendarStale(page)).toHaveCount(0);
    });
    } finally { await context.close(); }
    }
  });

  test("PERF-03 retained calendar rows cannot be edited during a held or failed read @AUDIT-PERFORMANCE-03", async ({ adminPage }) => {
    requireChainedValue(auditCheckpoint("performance.typicalProfile")?.windowFrom ?? "", {
      test: "PERF-03", needs: "the seeded typical profile from PERF-01", grep: "PERF-01|PERF-03", suite: "audit",
    });
    const { context, page } = await createPerformancePage(adminPage);
    try {
      await page.goto(CALENDAR_ENTRY);
      await expect(calendarReady(page, "week")).toBeVisible();
      await expect(realtimeSubscribed(page)).toBeAttached();
      // The provider's database-readiness catch-up reads the calendar about
      // 1.5 s after load; a refresh clicked while that read is in flight
      // coalesces into it and the hold below never enters (2026-09-13).
      await expect(page.locator("html")).toHaveAttribute("data-realtime-postgres-state", "ready", { timeout: 5_000 });
      await page.waitForLoadState("networkidle");
      const grid = calendarGrid(page);
      await expect(grid).not.toHaveAttribute("inert");
      // A failed covered refresh keeps the last-known rows visible but inert.
      const refresh = page.getByRole("button", { name: "Aktualisieren", exact: true });
      const coveredRead = await holdNextCalendarRead(page);
      try {
        await refresh.click();
        await expect.poll(coveredRead.entered).toBe(true);
        coveredRead.fail();
        await expect(calendarStale(page)).toBeVisible();
        await expect(grid).toHaveAttribute("inert", "");
      } finally { await coveredRead.dispose(); }
      const failureBanner = page.getByRole("alert").filter({ hasText: "Der Kalender konnte nicht aktualisiert werden" });
      await failureBanner.getByRole("button", { name: "Hinweis schließen", exact: true }).click();
      await expect(failureBanner).toHaveCount(0);
      await expect(refresh).toBeEnabled();
      await refresh.click();
      await expect(calendarStale(page)).toHaveCount(0);
      await expect(grid).not.toHaveAttribute("inert");

      // An uncovered month cannot display valid retained rows. Its error
      // replaces the renderer and keeps retry interactive instead.
      const uncoveredRead = await holdNextCalendarRead(page);
      try {
        await page.getByRole("tab", { name: "Monat", exact: true }).click();
        await expect.poll(uncoveredRead.entered).toBe(true);
        await expect(grid).toHaveAttribute("inert", "");
        uncoveredRead.fail();
        await expect(grid.getByRole("alert")).toContainText("Kalender konnte nicht geladen werden");
        await expect(grid).toHaveAttribute("data-calendar-state", "unavailable");
        await expect(grid.getByRole("button", { name: "Erneut laden", exact: true })).toBeEnabled();
        await expect(calendarReady(page, "month")).toHaveCount(0);
      } finally { await uncoveredRead.dispose(); }
      await grid.getByRole("button", { name: "Erneut laden", exact: true }).click();
      await expect(calendarReady(page, "month")).toBeVisible();
      await expect(grid).not.toHaveAttribute("inert");
    } finally { await context.close(); }
  });
});
