import { expect, test } from './support/fixtures';
import { getPlanningState } from './support/db/calendar';
import {
  createPlannedCalendarEntry,
  editPlannedCalendarOccurrence,
  occurrenceEditConfirmation,
  plannedCalendarEvent,
  plannedEntriesConfirmation,
  showPlanningMonth,
} from './support/steps/calendar';
import { addTeamMemberViaManagement, createTeamViaManagement } from './support/steps/qualifications';
import { createJob } from './support/steps/work';
import { expectLiveWithin, expectReadyWithin } from './support/live';
import { createRolePage } from './support/sessions';

// P1-11 — the planning journey a manager walks: a recurring series and a
// second visit for one job, the three edit scopes, team visits that reach an
// open office calendar live, and the legacy single-date bridge. Occurrence
// identity, exceptions, protected history, plan-versus-actual separation and
// planning visibility are database rules in supabase/tests/planning_occurrences.sql.
// Edge cases, role variants and capacity sources live in audit A6.

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined)
    throw new Error(`Invalid ISO date: ${dateIso}`);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10);
}

// The fifth of the next month keeps a five-day series and its edits inside
// one month grid, clear of today.
function nextMonthPlanningDate(businessDate: string): string {
  const [year, month] = businessDate.split('-').map(Number);
  if (year === undefined || month === undefined) throw new Error(`Invalid ISO date: ${businessDate}`);
  return new Date(Date.UTC(year, month, 5)).toISOString().slice(0, 10);
}

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

test.describe('P1-11 recurring and multi-visit planning @P1-11', () => {
  test('manager plans a series and a second visit, then edits one, this and future, and the whole series', async ({
    adminPage,
    businessDate,
    world,
  }) => {
    const planningDate = nextMonthPlanningDate(businessDate);
    const jobNumber = `AUF-${world.runId}-P111`;
    const title = `P1-11 Mehrfachbesuch ${world.runId}`;

    await test.step('plan a five-visit series and a second visit for the same job', async () => {
      await createJob(adminPage, { jobNumber, title });
      await createPlannedCalendarEntry(adminPage, {
        kind: 'job_visit',
        jobSearch: jobNumber,
        date: planningDate,
        time: '09:00',
        recurrence: { frequency: 'daily', count: 5 },
      });
      await expect(plannedEntriesConfirmation(adminPage, 5)).toBeVisible({ timeout: 15_000 });
      await createPlannedCalendarEntry(adminPage, {
        kind: 'job_visit',
        jobSearch: jobNumber,
        date: shiftIsoDate(planningDate, 10),
        time: '10:00',
        durationHours: 2,
      });
      await expect(plannedEntriesConfirmation(adminPage, 1)).toBeVisible({ timeout: 15_000 });
      await showPlanningMonth(adminPage, planningDate);
      await expect(plannedCalendarEvent(adminPage, title, 5)).toBeVisible({ timeout: 20_000 });

      const state = await getPlanningState(world.orgId, { jobNumber });
      expect(state.occurrenceCount).toBe(6);
      expect(state.seriesCount).toBe(1);
    });

    await test.step('move only the second visit', async () => {
      await editPlannedCalendarOccurrence(adminPage, {
        title,
        eventIndex: 1,
        calendarDate: planningDate,
        scope: 'one',
        time: '11:00',
      });
      await expect(occurrenceEditConfirmation(adminPage, 'one')).toBeVisible({ timeout: 15_000 });
      const state = await getPlanningState(world.orgId, { jobNumber });
      expect(state.occurrences.filter((occurrence) => occurrence.isException)).toHaveLength(1);
    });

    await test.step('move the third visit and every later one', async () => {
      await editPlannedCalendarOccurrence(adminPage, {
        title,
        eventIndex: 2,
        calendarDate: planningDate,
        scope: 'future',
        time: '12:00',
      });
      await expect(occurrenceEditConfirmation(adminPage, 'future')).toBeVisible({
        timeout: 15_000,
      });
      const state = await getPlanningState(world.orgId, { jobNumber });
      expect(state.seriesCount).toBe(2);
    });

    await test.step('move the whole series', async () => {
      await editPlannedCalendarOccurrence(adminPage, {
        title,
        eventIndex: 0,
        calendarDate: planningDate,
        scope: 'series',
        time: '13:00',
      });
      await expect(occurrenceEditConfirmation(adminPage, 'series')).toBeVisible({ timeout: 15_000 });
      const state = await getPlanningState(world.orgId, { jobNumber });
      expect(state.eventTypes).toContain('series_changed');
      expect(state.actualTimeCount).toBe(0);
    });
  });

  test('team visits expand per occurrence, overlap needs a reason, and office and field worker see them @FRESHNESS', async ({
    adminPage,
    bueroPage,
    browser,
    baseURL,
    businessDate,
    world,
  }) => {
    const planningDate = shiftIsoDate(nextMonthPlanningDate(businessDate), 6);
    const teamName = `P1-11 Einsatzteam ${world.runId}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const jobNumber = `AUF-${world.runId}-P111-TEAM`;
    const jobTitle = `P1-11 Teamtermin ${world.runId}`;
    const parallelReason = 'Der doppelte Einsatz ist bewusst als Paralleltermin geplant.';
    await createTeamViaManagement(adminPage, teamName);
    await addTeamMemberViaManagement(adminPage, { teamName, employeeName });
    await addTeamMemberViaManagement(adminPage, { teamName, employeeName: bueroName });
    await createJob(adminPage, { jobNumber, title: jobTitle });
    await showPlanningMonth(bueroPage, planningDate);

    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: jobNumber,
      date: planningDate,
      time: '09:00',
      teamNames: [teamName],
      recurrence: { frequency: 'daily', count: 2 },
      overrideReason: 'Das Einsatzteam hat den Termin betrieblich abgestimmt.',
    });
    await expect(plannedCalendarEvent(bueroPage, jobTitle, 1)).toBeVisible();

    // The parallel visit is guaranteed to warn (overlap with the series), so
    // the measured submission boundary sits before the override click. The
    // Büro month grid must show the third occurrence inside the freshness
    // deadline without any navigation.
    await expectLiveWithin(plannedCalendarEvent(bueroPage, jobTitle, 2), {
      label: 'P1-11 overlapping occurrence reaches the already-open office month',
      actingPage: adminPage,
      mutation: (beforeSubmit) =>
        createPlannedCalendarEntry(adminPage, {
          kind: 'job_visit',
          jobSearch: jobNumber,
          date: planningDate,
          time: '09:00',
          teamNames: [teamName],
          overrideReason: parallelReason,
          beforeSubmit,
        }),
    });
    const state = await getPlanningState(world.orgId, { jobNumber });
    expect(state.occurrenceCount).toBe(3);
    expect(state.assignmentCount).toBe(6);
    expect(state.capacityConflictKinds).toContain('overlap');
    expect(state.overrideReasons).toContain(parallelReason);

    const employeeOpening = await createRolePage({ browser, baseUrl: baseURL, world, role: 'employee' });
    try {
      await expectReadyWithin(plannedCalendarEvent(employeeOpening.page, jobTitle), {
        label: 'P1-11 employee calendar opening to assigned occurrence',
        targetMs: 5_000,
        boundary: 'navigation-to-usable-content',
        trigger: () => showPlanningMonth(employeeOpening.page, planningDate),
      });
    } finally {
      await employeeOpening.context.close();
    }
  });

  test('legacy single-date jobs still render and edit through the occurrence bridge', async ({
    adminPage,
    browser,
    baseURL,
    businessDate,
    world,
  }) => {
    const jobNumber = `AUF-${world.runId}-P111-LEGACY`;
    const jobTitle = `P1-11 Altplanung ${world.runId}`;
    const legacyDate = shiftIsoDate(nextMonthPlanningDate(businessDate), 23);
    await createJob(adminPage, {
      jobNumber,
      title: jobTitle,
      plannedDateDigits: toDatePickerDigits(legacyDate),
    });
    const adminOpening = await createRolePage({ browser, baseUrl: baseURL, world, role: 'admin' });
    try {
      await expectReadyWithin(plannedCalendarEvent(adminOpening.page, jobTitle), {
        label: 'P1-11 administrator calendar opening to legacy occurrence',
        targetMs: 5_000,
        boundary: 'navigation-to-usable-content',
        trigger: () => showPlanningMonth(adminOpening.page, legacyDate),
      });
    } finally {
      await adminOpening.context.close();
    }
    const before = await getPlanningState(world.orgId, { jobNumber });
    expect(before.occurrenceCount).toBe(1);
    expect(before.occurrences[0]?.legacySourceJobId).toBe(before.jobId);

    await editPlannedCalendarOccurrence(adminPage, {
      title: jobTitle,
      calendarDate: legacyDate,
      scope: 'one',
      date: shiftIsoDate(legacyDate, 1),
    });
    await expect(occurrenceEditConfirmation(adminPage, 'one')).toBeVisible({ timeout: 15_000 });
    const after = await getPlanningState(world.orgId, { jobNumber });
    expect(after.occurrences[0]?.legacySourceJobId).toBe(after.jobId);
    expect(after.occurrences[0]?.startDate).toBe(shiftIsoDate(legacyDate, 1));
  });
});
