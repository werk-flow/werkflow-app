import { expect, test } from './support/fixtures';
import {
  getOrganizationTimeEntryCount,
  getPlanningState,
  getVisiblePlanningStateAs,
} from './support/db';
import {
  addTeamMemberViaManagement,
  createJob,
  createPlannedCalendarEntry,
  createTeamViaManagement,
  editPlannedCalendarOccurrence,
  plannedCalendarEvent,
  setPlannedCalendarOccurrenceStatus,
  showPlanningMonth,
} from './support/steps';
import { formatBerlinLocalDateTime } from '../../lib/planning/date-time';

test.describe.configure({ mode: 'serial' });

const TODAY_ISO = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function nextMonthPlanningDate(): string {
  const [year, month] = TODAY_ISO.split('-').map(Number);
  return new Date(Date.UTC(year, month, 5)).toISOString().slice(0, 10);
}

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

const PLANNING_DATE = nextMonthPlanningDate();

function mainJobNumber(runId: string): string {
  return `AUF-${runId}-P111`;
}

function mainJobTitle(runId: string): string {
  return `P1-11 Mehrfachbesuch ${runId}`;
}

test.describe('P1-11 recurring and multi-visit planning @P1-11', () => {
  test('manager creates a stable recurring series and a second visit for the same job', async ({
    adminPage,
    world,
  }) => {
    await createJob(adminPage, {
      jobNumber: mainJobNumber(world.runId),
      title: mainJobTitle(world.runId),
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: mainJobNumber(world.runId),
      date: PLANNING_DATE,
      time: '09:00',
      recurrence: { frequency: 'daily', count: 5 },
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: mainJobNumber(world.runId),
      date: shiftIsoDate(PLANNING_DATE, 10),
      time: '10:00',
      durationHours: 2,
    });

    const state = await getPlanningState(world.orgId, {
      jobNumber: mainJobNumber(world.runId),
    });
    expect(state.occurrenceCount).toBe(6);
    expect(state.seriesCount).toBe(1);
    expect(state.actualTimeCount).toBe(0);
    const stableSeriesIdentities = state.occurrences.flatMap((occurrence) =>
      occurrence.originalStartLocal ? [occurrence.originalStartLocal] : []
    );
    expect(stableSeriesIdentities).toHaveLength(5);
    expect(new Set(stableSeriesIdentities).size).toBe(5);
  });

  test('one, this-and-future, whole-series, and skip edits preserve identity and exceptions', async ({
    adminPage,
    world,
  }) => {
    const title = mainJobTitle(world.runId);
    const initialState = await getPlanningState(world.orgId, {
      jobNumber: mainJobNumber(world.runId),
    });
    const stableSeriesIdentities = initialState.occurrences.flatMap(
      (occurrence) =>
        occurrence.originalStartLocal ? [occurrence.originalStartLocal] : []
    );
    expect(stableSeriesIdentities).toHaveLength(5);
    await editPlannedCalendarOccurrence(adminPage, {
      title,
      eventIndex: 1,
      calendarDate: PLANNING_DATE,
      scope: 'one',
      time: '11:00',
    });
    let state = await getPlanningState(world.orgId, {
      jobNumber: mainJobNumber(world.runId),
    });
    expect(state.occurrences.filter((row) => row.isException)).toHaveLength(1);
    const exceptionStart = state.occurrences.find(
      (row) => row.isException
    )?.startAt;

    await editPlannedCalendarOccurrence(adminPage, {
      title,
      eventIndex: 2,
      calendarDate: PLANNING_DATE,
      scope: 'future',
      time: '12:00',
    });
    state = await getPlanningState(world.orgId, {
      jobNumber: mainJobNumber(world.runId),
    });
    expect(state.seriesCount).toBe(2);
    expect(
      state.occurrences.flatMap((row) =>
        row.originalStartLocal ? [row.originalStartLocal] : []
      )
    ).toEqual(stableSeriesIdentities);

    await editPlannedCalendarOccurrence(adminPage, {
      title,
      eventIndex: 0,
      calendarDate: PLANNING_DATE,
      scope: 'series',
      time: '13:00',
    });
    state = await getPlanningState(world.orgId, {
      jobNumber: mainJobNumber(world.runId),
    });
    expect(state.occurrences.find((row) => row.isException)?.startAt).toBe(
      exceptionStart
    );
    expect(state.eventTypes).toEqual(
      expect.arrayContaining(['edited', 'series_split', 'series_changed'])
    );

    await setPlannedCalendarOccurrenceStatus(adminPage, {
      title,
      eventIndex: 4,
      calendarDate: PLANNING_DATE,
      status: 'skip',
      reason: 'Dieser einzelne Besuch wird betrieblich nicht benötigt.',
    });
    state = await getPlanningState(world.orgId, {
      jobNumber: mainJobNumber(world.runId),
    });
    expect(state.occurrences.some((row) => row.status === 'skipped')).toBe(true);
    expect(state.eventTypes).toContain('skipped');
    expect(state.actualTimeCount).toBe(0);
  });

  test('cross-midnight and multi-day internal work needs neither a fake job nor actual time', async ({
    adminPage,
    world,
  }) => {
    const actualTimeCountBefore = await getOrganizationTimeEntryCount(world.orgId);
    const nightTitle = `P1-11 Nachtarbeit ${world.runId}`;
    const multiDayTitle = `P1-11 Schulung ${world.runId}`;
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: nightTitle,
      internalType: 'internal_work',
      date: shiftIsoDate(PLANNING_DATE, 12),
      time: '22:00',
      durationHours: 4,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: multiDayTitle,
      internalType: 'training',
      date: shiftIsoDate(PLANNING_DATE, 16),
      durationDays: 3,
    });

    const night = await getPlanningState(world.orgId, {
      internalTitle: nightTitle,
    });
    expect(night.occurrences).toHaveLength(1);
    expect(night.jobId).toBeNull();
    expect(
      new Date(night.occurrences[0].endAt!).getTime() -
        new Date(night.occurrences[0].startAt!).getTime()
    ).toBe(4 * 60 * 60 * 1000);
    const localStart = formatBerlinLocalDateTime(night.occurrences[0].startAt!);
    expect(localStart.slice(11, 16)).toBe('22:00');

    const multiDay = await getPlanningState(world.orgId, {
      internalTitle: multiDayTitle,
    });
    expect(multiDay.occurrences[0].endDateExclusive).toBe(
      shiftIsoDate(multiDay.occurrences[0].startDate!, 3)
    );
    expect(await getOrganizationTimeEntryCount(world.orgId)).toBe(
      actualTimeCountBefore
    );
  });

  test('team expansion, overlap warnings, qualification snapshots, RLS, and Realtime stay occurrence-scoped', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const teamName = `P1-11 Einsatzteam ${world.runId}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const jobNumber = `AUF-${world.runId}-P111-TEAM`;
    const jobTitle = `P1-11 Teamtermin ${world.runId}`;
    await createTeamViaManagement(adminPage, teamName);
    await addTeamMemberViaManagement(adminPage, {
      teamName,
      employeeName,
    });
    await addTeamMemberViaManagement(adminPage, {
      teamName,
      employeeName: bueroName,
    });
    await createJob(adminPage, { jobNumber, title: jobTitle });
    await showPlanningMonth(bueroPage, PLANNING_DATE);

    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: jobNumber,
      date: shiftIsoDate(PLANNING_DATE, 6),
      time: '09:00',
      teamNames: [teamName],
      recurrence: { frequency: 'daily', count: 2 },
      overrideReason: 'Das Einsatzteam hat den Termin betrieblich abgestimmt.',
    });
    await expect(plannedCalendarEvent(bueroPage, jobTitle)).toBeVisible({
      timeout: 20_000,
    });

    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: jobNumber,
      date: shiftIsoDate(PLANNING_DATE, 6),
      time: '09:00',
      teamNames: [teamName],
      overrideReason: 'Der doppelte Einsatz ist bewusst als Paralleltermin geplant.',
    });
    const state = await getPlanningState(world.orgId, { jobNumber });
    expect(state.occurrenceCount).toBe(3);
    expect(state.assignmentCount).toBe(6);
    expect(state.capacityConflictKinds).toContain('overlap');
    expect(state.qualificationEvaluationCount).toBeGreaterThanOrEqual(3);
    expect(state.overrideReasons).toContain(
      'Der doppelte Einsatz ist bewusst als Paralleltermin geplant.'
    );

    await showPlanningMonth(employeePage, PLANNING_DATE);
    await expect(plannedCalendarEvent(employeePage, jobTitle)).toBeVisible({
      timeout: 20_000,
    });
    const [managerView, employeeView, outsiderView] = await Promise.all([
      getVisiblePlanningStateAs(world.users.admin, world.orgId),
      getVisiblePlanningStateAs(world.users.employee, world.orgId),
      getVisiblePlanningStateAs(world.outsider.admin, world.orgId),
    ]);
    expect(managerView.planning_series).toBeGreaterThan(0);
    expect(employeeView.planning_series).toBe(0);
    expect(employeeView.planning_occurrences).toBeGreaterThan(0);
    expect(employeeView.planning_occurrence_assessments).toBe(0);
    expect(employeeView.planning_events).toBe(0);
    for (const count of Object.values(outsiderView)) expect(count).toBe(0);
  });

  test('legacy single-date jobs still render and edit through the occurrence bridge', async ({
    adminPage,
    world,
  }) => {
    const jobNumber = `AUF-${world.runId}-P111-LEGACY`;
    const jobTitle = `P1-11 Altplanung ${world.runId}`;
    const legacyDate = shiftIsoDate(PLANNING_DATE, 23);
    await createJob(adminPage, {
      jobNumber,
      title: jobTitle,
      plannedDateDigits: toDatePickerDigits(legacyDate),
    });
    await showPlanningMonth(adminPage, legacyDate);
    await expect(plannedCalendarEvent(adminPage, jobTitle)).toBeVisible({
      timeout: 20_000,
    });
    const before = await getPlanningState(world.orgId, { jobNumber });
    expect(before.occurrenceCount).toBe(1);
    expect(before.occurrences[0].legacySourceJobId).toBe(before.jobId);

    await editPlannedCalendarOccurrence(adminPage, {
      title: jobTitle,
      calendarDate: legacyDate,
      scope: 'one',
      date: shiftIsoDate(legacyDate, 1),
    });
    const after = await getPlanningState(world.orgId, { jobNumber });
    expect(after.occurrences[0].legacySourceJobId).toBe(after.jobId);
    expect(after.occurrences[0].startDate).toBe(shiftIsoDate(legacyDate, 1));
    expect(after.eventTypes).toContain('edited');
    expect(after.actualTimeCount).toBe(before.actualTimeCount);
  });
});
