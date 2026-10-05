import type { Page } from '@playwright/test';

import { EMPLOYMENT_TYPE_LABELS } from '../../../lib/personnel/types';
import { HOLIDAY_REGION_LABELS, getPublicHolidaysForYear } from '../../../lib/personnel/holidays';
import { resolveDailyTargets } from '../../../lib/personnel/targets';
import { formatDuration } from '../../../lib/time-tracking/helpers';
import { doesDateConsumeVacation } from '../../../lib/vacation/balance';
import { formatSicknessRange } from '../../../lib/sickness/types';
import { expect, test } from '../support/fixtures';
import { berlinDateAtOffset, ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import {
  getEmployeeRecordStateByUser,
  giveEmployeesWorkSchedules,
  seedEmploymentCondition,
} from '../../golden/support/db/personnel';
import { getLatestSicknessReportState } from '../../golden/support/db/sickness';
import { getLatestVacationRequestState, getTargetContextForRecord } from '../../golden/support/db/vacation';
import {
  PERSONNEL_COPY,
  addConditionViaDialog,
  addClosureDayViaSettings,
  addWorkScheduleViaDialog,
  dailyTargetText,
  openMemberDetailFromList,
  removeClosureDayViaSettings,
  setHolidayRegionViaSettings,
} from '../../golden/support/steps/personnel';
import { SHARED_COPY, visibleText, textInDom } from '../../golden/support/steps/shared';
import {
  SICKNESS_COPY,
  absenceCalendarLabel,
  cancelOwnSicknessReport,
  cancelSicknessReportViaMenuWithReason,
  expectNoDiagnosisControl,
  openOwnSicknessSection,
  openSicknessReportMenu,
  recordSicknessButton,
  reportOwnSicknessViaDialog,
  reportSicknessButton,
  saveSicknessCorrectionButton,
} from '../../golden/support/steps/sickness';
import {
  approveVacationRequestFor,
  cancelApprovedVacationForRangeText,
  createOwnVacationRequestViaDialog,
  openOwnVacationSection,
  rejectVacationRequestFor,
  vacationRemainingText,
  vacationTakenText,
} from '../../golden/support/steps/vacation';
import { showCalendarMonth } from '../../golden/support/steps/calendar';
import { createJob } from '../../golden/support/steps/work';
import {
  OTHER_ABSENCE_HINT,
  SICKNESS_TYPE_WORDS,
  absenceCalendarEvent,
  expectVacationPreview,
  plannedInRangeText,
  vacationCalendarEvent,
  vacationRequestCard,
} from '../support/a4-steps';
import type { TestWorld } from '../../golden/support/world';

// A4 — Abwesenheit (P1-06, P1-08). The edge cases and role variants around
// the vacation and sickness goldens: the newest condition of the year, the
// preview's exclusions, approval hints, the half-day target effects, the
// neutral calendar per role and the no-diagnosis contract. Every test prepares
// its own entitlement and schedule; the run-day window is +35 … +39, +68, +69.

/** A one-hour plan on every day from today for everyone, so the current day always carries a target. */
async function giveEveryoneATodayPlan(world: TestWorld, todayIso: string): Promise<void> {
  await giveEmployeesWorkSchedules({
    organizationId: world.orgId,
    actorUserId: world.users.admin.id,
    validFrom: todayIso,
    weekdayMinutes: 60,
    weekendMinutes: 60,
    note: 'A4 Tagesplan',
  });
}

/** Year, month and day of a `YYYY-MM-DD` string; a missing or non-numeric part is an error, never NaN arithmetic. */
function parseIsoDateParts(dateIso: string): [number, number, number] {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    ![year, month, day].every(Number.isInteger)
  ) {
    throw new Error(`Invalid ISO date: ${dateIso}`);
  }
  return [year, month, day];
}

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = parseIsoDateParts(dateIso);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

function formatGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

function weekdayIndex(dateIso: string): number {
  const [year, month, day] = parseIsoDateParts(dateIso);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek === 0 ? 6 : dayOfWeek - 1;
}

function firstWeekdayOnOrAfter(startDateIso: string): string {
  let dateIso = startDateIso;
  while (weekdayIndex(dateIso) >= 5) dateIso = shiftIsoDate(dateIso, 1);
  return dateIso;
}

async function openMonthCalendar(page: Page, dateIso = berlinDateAtOffset(0)): Promise<void> {
  const [targetYear, targetMonth] = parseIsoDateParts(dateIso);
  const [currentYear, currentMonth] = parseIsoDateParts(berlinDateAtOffset(0));
  await showCalendarMonth(page, (targetYear - currentYear) * 12 + targetMonth - currentMonth);
}

test.describe('A4 Abwesenheitscluster @AUDIT-W1-A4', () => {
  test('A4-04: Neueste Kondition des Jahres bestimmt den Urlaubssaldo', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const firstConditionDate = ownedBerlinDateAtOffset('a4-abwesenheit', 38);
    const secondConditionDate = ownedBerlinDateAtOffset('a4-abwesenheit', 39);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);

    await openMemberDetailFromList(adminPage, employeeName);
    await addConditionViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(firstConditionDate),
      employmentTypeLabel: EMPLOYMENT_TYPE_LABELS.vollzeit,
      weeklyHours: '40',
      vacationDays: '27',
      note: `A4 Anspruch 27 ${world.runId}`,
    });
    let context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    expect(
      context.conditions.some(
        (condition) => condition.validFrom === firstConditionDate && condition.vacationDaysPerYear === 27,
      ),
    ).toBe(true);

    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, vacationTakenText(0, 27))).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, vacationRemainingText(27))).toBeVisible();

    await openMemberDetailFromList(adminPage, employeeName);
    await addConditionViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(secondConditionDate),
      employmentTypeLabel: EMPLOYMENT_TYPE_LABELS.vollzeit,
      weeklyHours: '40',
      vacationDays: '31',
      note: `A4 Anspruch 31 ${world.runId}`,
    });
    context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    expect(
      context.conditions.some(
        (condition) => condition.validFrom === secondConditionDate && condition.vacationDaysPerYear === 31,
      ),
    ).toBe(true);

    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, vacationTakenText(0, 31))).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, vacationRemainingText(31))).toBeVisible();
  });

  test('A4-R01: Vorschau zeigt normale und halbe Tage und schließt Feiertag, freien Wochenplantag und Betriebsruhe aus [P1-06-F01]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const todayIso = berlinDateAtOffset(0);
    const scheduleValidFrom = ownedBerlinDateAtOffset('a4-abwesenheit', 37);
    const scheduleDate = [37, 38, 39]
      .map((offset) => ownedBerlinDateAtOffset('a4-abwesenheit', offset))
      .find((dateIso) => weekdayIndex(dateIso) < 5);
    if (!scheduleDate) {
      throw new Error('A4 has no weekday inside its +37 ... +39 partition.');
    }
    const scheduleFreeDate = firstWeekdayOnOrAfter(shiftIsoDate(scheduleDate, 1));
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);

    const dayHours = ['8', '8', '8', '8', '8', '0', '0'];
    dayHours[weekdayIndex(scheduleFreeDate)] = '0';
    const scheduleNote = `A4 Vorschau-Wochenplan ${world.runId}`;
    await openMemberDetailFromList(adminPage, employeeName);
    await addWorkScheduleViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(scheduleValidFrom),
      dayHours,
      note: scheduleNote,
    });

    let context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    expect(doesDateConsumeVacation(scheduleDate, context)).toBe(true);
    expect(doesDateConsumeVacation(scheduleFreeDate, context)).toBe(false);

    const currentYear = Number(todayIso.slice(0, 4));
    const holiday = [currentYear, currentYear + 1]
      .flatMap((year) => getPublicHolidaysForYear('BE', year))
      .find(
        (candidate) =>
          candidate.date > todayIso &&
          weekdayIndex(candidate.date) < 5 &&
          weekdayIndex(candidate.date) !== weekdayIndex(scheduleFreeDate),
      );
    if (!holiday) throw new Error('A4 could not resolve a future Berlin weekday holiday.');
    await setHolidayRegionViaSettings(adminPage, HOLIDAY_REGION_LABELS.BE);
    try {
      await expectVacationPreview(employeePage, toDatePickerDigits(holiday.date), 0);
    } finally {
      await setHolidayRegionViaSettings(adminPage, PERSONNEL_COPY.noHolidayRegion);
    }

    await expectVacationPreview(employeePage, toDatePickerDigits(scheduleDate), 1);
    await expectVacationPreview(employeePage, toDatePickerDigits(scheduleDate), 0.5, true);
    await expectVacationPreview(employeePage, toDatePickerDigits(scheduleFreeDate), 0);

    const closureLabel = `A4 Vorschau-Betriebsruhe ${world.runId}`;
    await addClosureDayViaSettings(adminPage, {
      dateDigits: toDatePickerDigits(scheduleDate),
      label: closureLabel,
    });
    try {
      context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
      expect(
        context.calendar.closureDays.some(
          (day) => day.closureDate === scheduleDate && day.label === closureLabel,
        ),
      ).toBe(true);
      expect(doesDateConsumeVacation(scheduleDate, context)).toBe(false);
      await expectVacationPreview(employeePage, toDatePickerDigits(scheduleDate), 0);
    } finally {
      await removeClosureDayViaSettings(adminPage, formatGermanDate(scheduleDate));
    }
  });

  test('A4-06/A4-09/A4-10: Sonstige Abwesenheit ändert Urlaub nicht, verlangt Korrekturgrund und fragt keine Diagnose ab', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    // The 31-day entitlement this test counts against. A4-04 only ever adds a
    // later 31-day version, so the year's newest condition stays at 31 days.
    await seedEmploymentCondition({
      organizationId: world.orgId,
      employeeRecordId: employeeRecord.id,
      actorUserId: world.users.admin.id,
      validFrom: ownedBerlinDateAtOffset('a4-abwesenheit', 35),
      employmentType: 'vollzeit',
      weeklyHours: 40,
      vacationDaysPerYear: 31,
      note: `A4 Anspruch Sonstige ${world.runId}`,
    });
    const context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    const ownedDates = [37, 38, 39].map((offset) => ownedBerlinDateAtOffset('a4-abwesenheit', offset));
    const overlapDate = ownedDates.find((date) => doesDateConsumeVacation(date, context));
    if (!overlapDate) {
      throw new Error('A4 has no positive-target date in its +37 ... +39 partition.');
    }
    const dateDigits = toDatePickerDigits(overlapDate);
    const rangeText = formatGermanDate(overlapDate);

    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: dateDigits,
      endDigits: dateDigits,
      comment: `A4 Urlaub ${world.runId}`,
    });
    await approveVacationRequestFor(adminPage, employeeName);
    const approvedVacation = await getLatestVacationRequestState(world.orgId, employeeRecord.id);
    expect(approvedVacation).toMatchObject({
      status: 'approved',
      startDate: overlapDate,
      endDate: overlapDate,
      dayPortion: 'full',
      approvedDaysByYear: { [overlapDate.slice(0, 4)]: 1 },
      eventTypes: ['requested', 'approved'],
    });

    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, vacationTakenText(1, 31))).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, vacationRemainingText(30))).toBeVisible();

    await openOwnSicknessSection(employeePage);
    await reportSicknessButton(employeePage).click();
    let dialog = employeePage.getByRole('dialog');
    await expect(dialog.getByText(SICKNESS_COPY.ownNoDiagnosisHint, { exact: false })).toBeVisible();
    await expectNoDiagnosisControl(dialog);
    await dialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();
    await expect(dialog).toHaveCount(0);

    await openMemberDetailFromList(adminPage, employeeName);
    await recordSicknessButton(adminPage).click();
    dialog = adminPage.getByRole('dialog');
    await expect(
      dialog.getByText(SICKNESS_COPY.managerNoDetailsHint, {
        exact: false,
      }),
    ).toBeVisible();
    await expectNoDiagnosisControl(dialog);
    await dialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();
    await expect(dialog).toHaveCount(0);

    await reportOwnSicknessViaDialog(employeePage, {
      startDigits: dateDigits,
      endDigits: dateDigits,
      type: 'sonstige',
      expectVacationOverlapHint: true,
    });
    const reportedSickness = await getLatestSicknessReportState(world.orgId, employeeRecord.id);
    expect(reportedSickness).toMatchObject({
      status: 'reported',
      absenceType: 'sonstige',
      startDate: overlapDate,
      endDate: overlapDate,
      dayPortion: 'full',
      eventTypes: ['reported'],
    });
    expect(await getLatestVacationRequestState(world.orgId, employeeRecord.id)).toEqual(approvedVacation);
    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, vacationTakenText(1, 31))).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, vacationRemainingText(30))).toBeVisible();

    await openMemberDetailFromList(adminPage, employeeName);
    const sicknessRange = formatSicknessRange({
      startDate: overlapDate,
      endDate: overlapDate,
    });
    await openSicknessReportMenu(adminPage, sicknessRange, 'correct');
    dialog = adminPage.getByRole('dialog');
    const saveCorrection = saveSicknessCorrectionButton(dialog);
    const correctionReason = dialog.locator('#correct-sickness-reason');
    await expect(saveCorrection).toBeEnabled();
    await saveCorrection.click();
    await expect(dialog.getByText(SICKNESS_COPY.correctionReasonRequired)).toBeVisible();
    await expect(correctionReason).toHaveAttribute('aria-invalid', 'true');
    await expect(correctionReason).toBeFocused();
    await dialog.locator('#correct-sickness-half-day').click();
    await correctionReason.fill(`A4 telefonisch auf halbtags korrigiert ${world.runId}`);
    await saveCorrection.click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    const correctedSickness = await getLatestSicknessReportState(world.orgId, employeeRecord.id);
    expect(correctedSickness).toMatchObject({
      id: reportedSickness.id,
      status: 'reported',
      absenceType: 'sonstige',
      startDate: overlapDate,
      endDate: overlapDate,
      dayPortion: 'half_day',
      eventTypes: ['reported', 'corrected'],
    });
    expect(await getLatestVacationRequestState(world.orgId, employeeRecord.id)).toEqual(approvedVacation);
    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, vacationTakenText(1, 31))).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, vacationRemainingText(30))).toBeVisible();

    await openMemberDetailFromList(adminPage, employeeName);
    await cancelSicknessReportViaMenuWithReason(
      adminPage,
      sicknessRange,
      `A4 Prüfung abgeschlossen ${world.runId}`,
    );
    const cancelledSickness = await getLatestSicknessReportState(world.orgId, employeeRecord.id);
    expect(cancelledSickness.status).toBe('cancelled');
    expect(cancelledSickness.eventTypes).toEqual(['reported', 'corrected', 'cancelled']);

    await cancelApprovedVacationForRangeText(
      adminPage,
      employeeName,
      rangeText,
      `A4 Prüfung abgeschlossen ${world.runId}`,
    );
    const cancelledVacation = await getLatestVacationRequestState(world.orgId, employeeRecord.id);
    expect(cancelledVacation).toMatchObject({
      id: approvedVacation.id,
      status: 'cancelled',
      approvedDaysByYear: approvedVacation.approvedDaysByYear,
      eventTypes: ['requested', 'approved', 'cancelled'],
    });

    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, vacationTakenText(0, 31))).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, vacationRemainingText(31))).toBeVisible();
  });

  test('A4-R02: Freigabe zeigt neutral eine andere Abwesenheit und nur Aufträge im beantragten Zeitraum [P1-06-F03]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const requestDate = ownedBerlinDateAtOffset('a4-abwesenheit', 68);
    const outsideDate = ownedBerlinDateAtOffset('a4-abwesenheit', 69);
    const dateDigits = toDatePickerDigits(requestDate);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const inRangeJobTitle = `A4 Auftrag im Zeitraum ${world.runId}`;
    const outsideJobTitle = `A4 Auftrag außerhalb ${world.runId}`;

    await createJob(adminPage, {
      jobNumber: `A4-IN-${world.runId}`,
      title: inRangeJobTitle,
      assignEmployeeName: 'Emil',
      plannedDateDigits: toDatePickerDigits(requestDate),
    });
    await createJob(adminPage, {
      jobNumber: `A4-OUT-${world.runId}`,
      title: outsideJobTitle,
      assignEmployeeName: 'Emil',
      plannedDateDigits: toDatePickerDigits(outsideDate),
    });
    await reportOwnSicknessViaDialog(employeePage, {
      startDigits: dateDigits,
      endDigits: dateDigits,
      type: 'krankheit',
    });
    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: dateDigits,
      endDigits: dateDigits,
      comment: `A4 Freigabehinweise ${world.runId}`,
    });

    await adminPage.goto('/zeiterfassung?tab=approvals');
    const requestCard = vacationRequestCard(adminPage, employeeName);
    await expect(requestCard).toHaveCount(1, { timeout: 15_000 });
    await expect(requestCard).toContainText(OTHER_ABSENCE_HINT);
    await expect(requestCard).toContainText(
      plannedInRangeText(inRangeJobTitle, formatGermanDate(requestDate)),
    );
    await expect(requestCard).not.toContainText(outsideJobTitle);
    await expect(requestCard).not.toContainText(SICKNESS_TYPE_WORDS);

    await rejectVacationRequestFor(adminPage, employeeName, `A4 Hinweisprüfung abgeschlossen ${world.runId}`);
    const rejectedVacation = await getLatestVacationRequestState(world.orgId, employeeRecord.id);
    expect(rejectedVacation).toMatchObject({
      status: 'rejected',
      startDate: requestDate,
      endDate: requestDate,
      eventTypes: ['requested', 'rejected'],
    });

    await cancelOwnSicknessReport(employeePage, formatGermanDate(requestDate));
    const cancelledSickness = await getLatestSicknessReportState(world.orgId, employeeRecord.id);
    expect(cancelledSickness).toMatchObject({
      status: 'cancelled',
      startDate: requestDate,
      endDate: requestDate,
      eventTypes: ['reported', 'cancelled'],
    });
  });

  test('A4-R03: Halber Urlaubstag halbiert das Tagesziel; Manager sehen alle Kalenderzustände, Beschäftigte nur den eigenen [P1-06-F05]', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    // This scenario proves the dashboard's current-day target projection, so
    // it uses today and seeds a plan that gives today a target.
    const requestDate = berlinDateAtOffset(0);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    await giveEveryoneATodayPlan(world, requestDate);
    const context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    expect(doesDateConsumeVacation(requestDate, context)).toBe(true);
    const [baseTarget] = resolveDailyTargets([requestDate], context);
    if (!baseTarget) throw new Error('A4: no daily target resolved for the request date');
    const dateDigits = toDatePickerDigits(requestDate);
    const rangeText = formatGermanDate(requestDate);
    expect(baseTarget.targetMinutes).toBeGreaterThan(0);
    const halfTargetLabel = formatDuration(Math.round(baseTarget.baseTargetMinutes / 2));

    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: dateDigits,
      endDigits: dateDigits,
      halfDay: true,
      comment: `A4 halber Urlaub ${world.runId}`,
    });
    await createOwnVacationRequestViaDialog(bueroPage, {
      startDigits: dateDigits,
      endDigits: dateDigits,
      comment: `A4 Büro-Urlaub ${world.runId}`,
    });

    await openMonthCalendar(adminPage, requestDate);
    const employeePending = vacationCalendarEvent(adminPage, 'pending', employeeName);
    const bueroPending = vacationCalendarEvent(adminPage, 'pending', bueroName);
    await expect(employeePending).toBeVisible({ timeout: 15_000 });
    await expect(bueroPending).toBeVisible();
    expect(await employeePending.evaluate((element) => getComputedStyle(element).borderStyle)).toContain(
      'dashed',
    );

    await openMonthCalendar(employeePage, requestDate);
    await expect(vacationCalendarEvent(employeePage, 'pending', employeeName)).toBeVisible({
      timeout: 15_000,
    });
    await expect(vacationCalendarEvent(employeePage, 'pending', bueroName)).toHaveCount(0);

    await approveVacationRequestFor(adminPage, employeeName);
    await approveVacationRequestFor(adminPage, bueroName);
    const approvedVacation = await getLatestVacationRequestState(world.orgId, employeeRecord.id);
    expect(approvedVacation).toMatchObject({
      status: 'approved',
      startDate: requestDate,
      endDate: requestDate,
      dayPortion: 'half_day',
      approvedDaysByYear: { [requestDate.slice(0, 4)]: 0.5 },
      eventTypes: ['requested', 'approved'],
    });

    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, dailyTargetText(halfTargetLabel, 'vacation'))).toBeVisible({
      timeout: 15_000,
    });

    await openMonthCalendar(adminPage, requestDate);
    const employeeApproved = vacationCalendarEvent(adminPage, 'approved', employeeName);
    await expect(employeeApproved).toBeVisible({ timeout: 15_000 });
    await expect(vacationCalendarEvent(adminPage, 'approved', bueroName)).toBeVisible();
    expect(await employeeApproved.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      'rgba(0, 0, 0, 0)',
    );

    await openMonthCalendar(employeePage, requestDate);
    await expect(vacationCalendarEvent(employeePage, 'approved', employeeName)).toBeVisible({
      timeout: 15_000,
    });
    await expect(vacationCalendarEvent(employeePage, 'approved', bueroName)).toHaveCount(0);

    await cancelApprovedVacationForRangeText(
      adminPage,
      employeeName,
      rangeText,
      `A4 halben Urlaub geprüft ${world.runId}`,
    );
    await cancelApprovedVacationForRangeText(
      adminPage,
      bueroName,
      rangeText,
      `A4 Manager-Sicht geprüft ${world.runId}`,
    );
  });

  test('A4-R04: Eigene halbtägige Krankmeldung halbiert das Tagesziel und lässt sich selbst stornieren [P1-08-F02/P1-08-F05]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // The dashboard target banner is intentionally a current-day contract.
    const requestDate = berlinDateAtOffset(0);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    await giveEveryoneATodayPlan(world, requestDate);
    const context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    const [baseTarget] = resolveDailyTargets([requestDate], context);
    if (!baseTarget) throw new Error('A4: no daily target resolved for the request date');
    const dateDigits = toDatePickerDigits(requestDate);
    const rangeText = formatGermanDate(requestDate);
    expect(baseTarget.targetMinutes).toBeGreaterThan(0);
    const halfTargetLabel = formatDuration(Math.round(baseTarget.baseTargetMinutes / 2));

    await reportOwnSicknessViaDialog(employeePage, {
      startDigits: dateDigits,
      endDigits: dateDigits,
      halfDay: true,
      type: 'krankheit',
    });
    const reported = await getLatestSicknessReportState(world.orgId, employeeRecord.id);
    expect(reported).toMatchObject({
      status: 'reported',
      startDate: requestDate,
      endDate: requestDate,
      dayPortion: 'half_day',
      eventTypes: ['reported'],
    });
    await employeePage.goto('/zeiterfassung');
    await expect(visibleText(employeePage, dailyTargetText(halfTargetLabel, 'sickness'))).toBeVisible({
      timeout: 15_000,
    });

    await openMonthCalendar(adminPage, requestDate);
    const halfDayAbsenceLabel = absenceCalendarLabel(employeeName, { halfDay: true });
    await expect(absenceCalendarEvent(adminPage, halfDayAbsenceLabel)).toBeVisible({
      timeout: 15_000,
    });

    await cancelOwnSicknessReport(employeePage, rangeText);
    const cancelled = await getLatestSicknessReportState(world.orgId, employeeRecord.id);
    expect(cancelled).toMatchObject({
      id: reported.id,
      status: 'cancelled',
      eventTypes: ['reported', 'cancelled'],
    });
    await employeePage.goto('/zeiterfassung');
    await expect(
      visibleText(employeePage, dailyTargetText(formatDuration(baseTarget.baseTargetMinutes))),
    ).toBeVisible({ timeout: 15_000 });
    await openMonthCalendar(adminPage, requestDate);
    await expect(textInDom(adminPage, halfDayAbsenceLabel)).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
