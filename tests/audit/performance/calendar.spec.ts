import { expect, test } from "../support/fixtures";
import { expectUsableWithin } from "../../golden/support/scenario-measurement";
import { calendarTarget } from "../../golden/support/browser-observation";
import { monthWindowDates, seedTypicalProfile, TYPICAL_PROFILE, TYPICAL_PROFILE_BUSINESS_DATE, type TypicalProfileCounts } from "../support/performance-profile";
import { calendarGrid, calendarReady, calendarStale, createPerformancePage, firstMonthGridDay, holdNextCalendarRead, realtimeSubscribed, seededJobBlock } from "../support/performance-steps";
import { requireChainedValue } from "../../golden/support/preconditions";
import { auditCheckpoint, saveAuditCheckpoint } from "../support/checkpoints";
import { resolveBerlinWallTime } from "../../../lib/planning/date-time";

// Performance profile audit (Step 2). Measures navigation and view switches
// against the typical data profile in this group's own organization. Every
// scenario id is registered in lib/testing/measured-scenarios.ts; the run
// qualifies only when each records its three declared samples, within budget, and without a
// regression against its reviewed baseline. The group runs exclusively.

test.describe.configure({ mode: "serial" });

const BUSINESS_DATE = TYPICAL_PROFILE_BUSINESS_DATE;
const CALENDAR_ENTRY = `/kalender?date=${BUSINESS_DATE}`;

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
    expect(counts.occurrences).toBe(TYPICAL_PROFILE.occurrencesPerDay * counts.window.days);
    expect(counts.workdays).toBeGreaterThanOrEqual(30);
    // The seeded month window stays below the planning read cap.
    expect(counts.occurrences).toBeLessThanOrEqual(2_000);
    expect(counts.timeEntries).toBeGreaterThan(0);
  });

  test("PERF-02 calendar entry and view switches report usable content within budget @AUDIT-PERFORMANCE-02", async ({ adminPage }) => {
    requireChainedValue(auditCheckpoint("performance.typicalProfile")?.windowFrom ?? "", {
      test: "PERF-02", needs: "the seeded typical profile from PERF-01", grep: "PERF-01|PERF-02", suite: "audit",
    });
    for (const sample of [1, 2, 3]) {
    const { context, page } = await createPerformancePage(adminPage);
    try {
    await test.step(`Declared navigation sample ${sample}`, async () => {
    await expectUsableWithin("calendar.day.cold-open", {
      page,
      trigger: () => page.goto(CALENDAR_ENTRY),
      usable: calendarTarget(page, "day"),
    });
    // A fresh read never reports stale data, and the seeded work is on screen.
    await expect(calendarStale(page)).toHaveCount(0);
    await expect(seededJobBlock(page)).toBeVisible();
    // The view-switch scenarios measure a settled shell: the Realtime join
    // catch-up fans out every subscribed read a few seconds after entry, and
    // Next.js runs one client's Server Actions one after another (PF-23).
    // Waiting for the join marker and then for the network to go idle is a
    // deterministic settle, not a sleep.
    await expect(realtimeSubscribed(page)).toBeAttached();
    await page.waitForLoadState("networkidle");

    await expectUsableWithin("calendar.day-to-week.uncovered", {
      page,
      trigger: () => page.getByRole("tab", { name: "Woche", exact: true }).click(),
      usable: calendarTarget(page, "week"),
    });
    await expectUsableWithin("calendar.week-to-day.covered", {
      page,
      trigger: () => page.getByRole("tab", { name: "Tag", exact: true }).click(),
      usable: calendarTarget(page, "day"),
    });
    await page.getByRole("tab", { name: "Woche", exact: true }).click();
    await expect(calendarReady(page, "week")).toBeVisible();
    await expectUsableWithin("calendar.week-to-month.uncovered", {
      page,
      trigger: () => page.getByRole("tab", { name: "Monat", exact: true }).click(),
      usable: calendarTarget(page, "month"),
    });
    await expect(firstMonthGridDay(page)).toBeVisible();
    await expectUsableWithin("calendar.month-next.uncovered", {
      page,
      trigger: () => page.getByRole("button", { name: "Weiter" }).click(),
      usable: calendarTarget(page, "month", nextMonthRangeStartIso(BUSINESS_DATE)),
    });
    await expectUsableWithin("calendar.month-to-week.covered", {
      page,
      trigger: () => page.getByRole("tab", { name: "Woche", exact: true }).click(),
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
      await expect(calendarReady(page, "day")).toBeVisible();
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
