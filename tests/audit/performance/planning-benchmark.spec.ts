import { expect, test } from "../support/fixtures";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { calendarReady, openBenchmarkMonth, realtimeSubscribed } from "../support/performance-steps";
import { addTeamMemberViaManagement, createJob, createPlannedCalendarEntry, createTeamViaManagement, plannedCalendarEvent } from "../../golden/support/steps";
import { createMeasurementPage, expectScenarioLiveWithin, expectUsableWithin } from "../../golden/support/scenario-measurement";
import { getPlanningState } from "../../golden/support/db";
import { calendarDateVisits, calendarEventTarget, standaloneCalendarVisitTarget } from "../../golden/support/browser-observation";
import { currentRunKey, runDirectory } from "../../golden/support/run-state";

test.describe.configure({ mode: "serial" });

const PLANNING_DATE = "2026-06-11";
const LEGACY_DATE = "2026-06-28";

test("fixed planning workload proves overlapping saves and both role openings @AUDIT-PERFORMANCE-PLANNING @FRESHNESS", async ({ adminPage, bueroPage, employeePage, world }) => {
  const teamName = `Kalender Messgruppe ${world.runId}`;
  await createTeamViaManagement(adminPage, teamName);
  for (const user of [world.users.employee, world.users.buero]) {
    await addTeamMemberViaManagement(adminPage, { teamName, employeeName: `${user.firstName} ${user.lastName}`, validFrom: PLANNING_DATE });
  }
  // Separate workday pairs keep both existing and new visits visible under
  // the real month renderer's two-events-per-day limit.
  const jobs = [
    { firstDate: "2026-06-11", secondDate: "2026-06-12" },
    { firstDate: "2026-06-16", secondDate: "2026-06-17" },
    { firstDate: "2026-06-23", secondDate: "2026-06-24" },
  ].map((dates, index) => ({ ...dates, jobNumber: `PERF-${world.runId}-PLAN-${index + 1}`, title: `Messbesuch ${index + 1} ${world.runId}` }));
  for (const job of jobs) {
    await createJob(adminPage, job);
    await createPlannedCalendarEntry(adminPage, {
      kind: "job_visit", jobSearch: job.jobNumber, date: job.firstDate, time: "09:00", teamNames: [teamName],
      recurrence: { frequency: "daily", count: 2 }, overrideReason: "Die Messgruppe führt diese Termine gemeinsam aus.",
    });
  }
  const initial = await Promise.all(jobs.map((job) => getPlanningState(world.orgId, { jobNumber: job.jobNumber })));
  expect(initial.map((state) => state.occurrenceCount)).toEqual([2, 2, 2]);
  expect(initial.map((state) => state.assignmentCount)).toEqual([4, 4, 4]);
  for (const [index, state] of initial.entries()) {
    const job = jobs[index];
    if (!job) throw new Error(`expected a benchmark job at index ${index}`);
    expect(state.occurrences.map((occurrence) => occurrence.startAt && new Date(occurrence.startAt).toISOString()).sort()).toEqual([
      `${job.firstDate}T07:00:00.000Z`, `${job.secondDate}T07:00:00.000Z`,
    ]);
  }
  writeFileSync(resolve(runDirectory(currentRunKey()), "planning-benchmark-workload.json"), JSON.stringify({
    date: PLANNING_DATE, occurrenceCounts: initial.map((state) => state.occurrenceCount), assignmentCounts: initial.map((state) => state.assignmentCount),
    initialStartTimes: initial.map((state) => state.occurrences.map((occurrence) => occurrence.startAt && new Date(occurrence.startAt).toISOString()).sort()),
    plannedVisits: jobs.map(({ firstDate, secondDate }) => ({ firstDate, secondDate, recurringTime: "09:00", additionalTime: "09:30", durationHours: 1 })),
    protocol: "three disjoint workday pairs, each with one confirmed standalone overlapping visit on its second date; then role-specific fresh-context month entry",
    mutationTotalCounts: [7, 8, 9], legacyDate: LEGACY_DATE,
  }, null, 2));
  await openBenchmarkMonth(bueroPage, PLANNING_DATE);
  await expect(calendarReady(bueroPage, "month")).toBeVisible();
  await expect(realtimeSubscribed(bueroPage)).toBeAttached();
  for (const job of jobs) {
    const firstDayVisits = calendarDateVisits(bueroPage, job.firstDate);
    const secondDayVisits = calendarDateVisits(bueroPage, job.secondDate);
    const firstVisit = firstDayVisits.filter({ hasText: job.title });
    const recurringSecondVisit = secondDayVisits.filter({ hasText: job.title })
      .filter({ has: bueroPage.getByRole("img", { name: "Serientermin", exact: true }) });
    const newVisit = standaloneCalendarVisitTarget(bueroPage, job.title, job.secondDate);
    await expect(firstDayVisits).toHaveCount(1);
    await expect(secondDayVisits).toHaveCount(1);
    await expect(firstVisit).toBeVisible();
    await expect(recurringSecondVisit).toBeVisible();
    await expect(plannedCalendarEvent(bueroPage, job.title, 1)).toBeVisible();
    await expect(plannedCalendarEvent(bueroPage, job.title, 2)).toHaveCount(0);
    await expect(newVisit.locator).toHaveCount(0);
    await expectScenarioLiveWithin("planning.occurrence.cross-session", newVisit, {
      mutation: (beforeSubmit) => createPlannedCalendarEntry(adminPage, {
        kind: "job_visit", jobSearch: job.jobNumber, date: job.secondDate, time: "09:30", teamNames: [teamName],
        overrideReason: "Dieser zusätzliche Paralleltermin ist betrieblich abgestimmt.", beforeSubmit,
      }),
    });
    await expect(firstDayVisits).toHaveCount(1);
    await expect(secondDayVisits).toHaveCount(2);
    await expect(firstVisit).toBeVisible();
    await expect(recurringSecondVisit).toBeVisible();
    await expect(newVisit.locator).toBeVisible();
    const saved = await getPlanningState(world.orgId, { jobNumber: job.jobNumber });
    expect(saved.occurrenceCount).toBe(3);
    expect(saved.assignmentCount).toBe(6);
    expect(saved.capacityConflictKinds).toContain("overlap");
    expect(saved.overrideReasons).toContain("Dieser zusätzliche Paralleltermin ist betrieblich abgestimmt.");
    const addedVisits = saved.occurrences.filter((occurrence) => occurrence.seriesId === null);
    expect(addedVisits).toHaveLength(1);
    const addedVisitStartAt = addedVisits[0]?.startAt;
    expect(addedVisitStartAt && new Date(addedVisitStartAt).toISOString()).toBe(`${job.secondDate}T07:30:00.000Z`);
  }
  const [firstJob] = jobs;
  if (!firstJob) throw new Error("expected at least one benchmark job");
  for (const sample of [1, 2, 3]) {
    const { context, page } = await createMeasurementPage(employeePage);
    try {
      await test.step(`Employee opening sample ${sample}`, () => expectUsableWithin("calendar.month.employee-open-to-event", {
        page, trigger: () => openBenchmarkMonth(page, PLANNING_DATE), usable: calendarEventTarget(page, firstJob.title),
      }));
    } finally { await context.close(); }
  }
  const legacy = { jobNumber: `PERF-${world.runId}-LEGACY`, title: `Messung Altplanung ${world.runId}` };
  await createJob(adminPage, { ...legacy, plannedDateDigits: "28062026" });
  for (const sample of [1, 2, 3]) {
    const { context, page } = await createMeasurementPage(adminPage);
    try {
      await test.step(`Administrator opening sample ${sample}`, () => expectUsableWithin("calendar.month.admin-open-to-legacy-event", {
        page, trigger: () => openBenchmarkMonth(page, LEGACY_DATE), usable: calendarEventTarget(page, legacy.title),
      }));
    } finally { await context.close(); }
  }
  const savedLegacy = await getPlanningState(world.orgId, { jobNumber: legacy.jobNumber });
  expect(savedLegacy.occurrenceCount).toBe(1);
  expect(savedLegacy.occurrences[0]?.legacySourceJobId).toBe(savedLegacy.jobId);
});
