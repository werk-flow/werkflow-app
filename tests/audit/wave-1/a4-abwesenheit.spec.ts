import type { Locator, Page } from '@playwright/test';

import { getPublicHolidaysForYear } from '../../../lib/personnel/holidays';
import { resolveDailyTargets } from '../../../lib/personnel/targets';
import { formatDuration } from '../../../lib/time-tracking/helpers';
import {
  doesDateConsumeVacation,
  formatVacationDays,
} from '../../../lib/vacation/balance';
import { formatSicknessRange } from '../../../lib/sickness/types';
import { expect, test } from '../../golden/support/fixtures';
import {
  getEmployeeRecordStateByUser,
  getLatestSicknessReportState,
  getLatestVacationRequestState,
  getTargetContextForRecord,
} from '../../golden/support/db';
import {
  addConditionViaDialog,
  addClosureDayViaSettings,
  addWorkScheduleViaDialog,
  approveVacationRequestFor,
  cancelApprovedVacationForRangeText,
  cancelSicknessReportViaMenuWithReason,
  createJob,
  createOwnVacationRequestViaDialog,
  openMemberDetailFromList,
  openOwnSicknessSection,
  openOwnVacationSection,
  rejectVacationRequestFor,
  removeClosureDayViaSettings,
  reportOwnSicknessViaDialog,
  setHolidayRegionViaSettings,
  typeIntoDatePicker,
  visibleText,
} from '../../golden/support/steps';

test.describe.configure({ mode: 'serial' });

function berlinTodayIso(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
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
  const [year, month, day] = dateIso.split('-').map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek === 0 ? 6 : dayOfWeek - 1;
}

function firstWeekendOnOrAfter(startDateIso: string): string {
  let dateIso = startDateIso;
  while (weekdayIndex(dateIso) < 5) dateIso = shiftIsoDate(dateIso, 1);
  return dateIso;
}

function firstWeekdayOnOrAfter(startDateIso: string): string {
  let dateIso = startDateIso;
  while (weekdayIndex(dateIso) >= 5) dateIso = shiftIsoDate(dateIso, 1);
  return dateIso;
}

async function expectVacationPreview(
  page: Page,
  dateIso: string,
  expectedDays: number,
  halfDay = false
): Promise<void> {
  await openOwnVacationSection(page);
  await page.getByRole('button', { name: 'Urlaub beantragen' }).click();
  const dialog = page.getByRole('dialog');
  await typeIntoDatePicker(dialog, 'Von', toDatePickerDigits(dateIso));
  await typeIntoDatePicker(dialog, 'Bis', toDatePickerDigits(dateIso));
  if (halfDay) await dialog.locator('#vacation-half-day').click();
  await expect(dialog.getByTestId('vacation-days-preview')).toHaveText(
    `Berechnete Urlaubstage: ${formatVacationDays(expectedDays)}`,
    { timeout: 15_000 }
  );
  await expect(
    dialog.getByRole('button', { name: 'Antrag einreichen' })
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toHaveCount(0);
}

async function cancelOwnSicknessReport(
  page: Page,
  rangeText: string
): Promise<void> {
  await openOwnSicknessSection(page);
  await page
    .getByRole('button', {
      name: `Krankmeldung vom ${rangeText} stornieren`,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Krankmeldung stornieren' })
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Stornieren', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

async function deleteWorkScheduleViaDetail(
  page: Page,
  validFromIso: string,
  note: string
): Promise<void> {
  const row = page.locator('li').filter({ hasText: note }).first();
  await row
    .getByRole('button', {
      name: `Aktionen für Wochenplan ab ${formatGermanDate(validFromIso)}`,
    })
    .click();
  await page.getByRole('menuitem', { name: 'Löschen' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Löschen', exact: true })
    .click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0, {
    timeout: 15_000,
  });
  await page.reload();
  await expect(
    page.getByRole('button', {
      name: `Aktionen für Wochenplan ab ${formatGermanDate(validFromIso)}`,
    })
  ).toHaveCount(0);
}

async function openMonthCalendar(page: Page, dateIso = berlinTodayIso()): Promise<void> {
  await page.goto('/kalender');
  await page.getByRole('tab', { name: 'Monat', exact: true }).click();
  const [targetYear, targetMonth] = dateIso.split('-').map(Number);
  const [currentYear, currentMonth] = berlinTodayIso().split('-').map(Number);
  const monthDelta =
    (targetYear - currentYear) * 12 + targetMonth - currentMonth;
  const stepTitle = monthDelta < 0 ? 'Zurück' : 'Weiter';
  for (let step = 0; step < Math.abs(monthDelta); step += 1) {
    await page.getByTitle(stepTitle).click();
  }
}

function vacationEvent(
  page: Page,
  status: 'pending' | 'approved',
  personName: string
): Locator {
  return page
    .locator(`.fc-vacation-${status}`)
    .filter({ hasText: personName })
    .first();
}

async function expectNoDiagnosisControl(
  dialog: Locator
): Promise<void> {
  await expect(dialog.getByLabel(/Diagnose/i)).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: /Diagnose/i })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: /Diagnose/i })).toHaveCount(0);
  await expect(dialog.getByPlaceholder(/Diagnose/i)).toHaveCount(0);
}

test.describe('A4 Abwesenheitscluster @AUDIT-W1-A4', () => {
  let halfDayScheduleNote = '';

  test('A4-04: Neueste Kondition des Jahres bestimmt den Urlaubssaldo', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const todayIso = berlinTodayIso();
    const firstConditionDate = shiftIsoDate(todayIso, 35);
    const secondConditionDate = shiftIsoDate(todayIso, 36);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );

    await openMemberDetailFromList(adminPage, employeeName);
    await addConditionViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(firstConditionDate),
      employmentTypeLabel: 'Vollzeit',
      weeklyHours: '40',
      vacationDays: '27',
      note: `A4 Anspruch 27 ${world.runId}`,
    });
    let context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    expect(
      context.conditions.some(
        (condition) =>
          condition.validFrom === firstConditionDate &&
          condition.vacationDaysPerYear === 27
      )
    ).toBe(true);

    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, '0 von 27 Tagen genommen')).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, '27 Tage Resturlaub')).toBeVisible();

    await openMemberDetailFromList(adminPage, employeeName);
    await addConditionViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(secondConditionDate),
      employmentTypeLabel: 'Vollzeit',
      weeklyHours: '40',
      vacationDays: '31',
      note: `A4 Anspruch 31 ${world.runId}`,
    });
    context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    expect(
      context.conditions.some(
        (condition) =>
          condition.validFrom === secondConditionDate &&
          condition.vacationDaysPerYear === 31
      )
    ).toBe(true);

    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, '0 von 31 Tagen genommen')).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, '31 Tage Resturlaub')).toBeVisible();
  });

  test('A4-R01: Vorschau zeigt normale und halbe Tage und schließt Wochenende, Feiertag, freien Wochenplantag und Betriebsruhe aus [P1-06-F01]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    test.setTimeout(300_000);
    const todayIso = berlinTodayIso();
    const scheduleValidFrom = shiftIsoDate(todayIso, 1);
    const scheduleDate = firstWeekdayOnOrAfter(shiftIsoDate(todayIso, 68));
    const scheduleFreeDate = firstWeekdayOnOrAfter(shiftIsoDate(scheduleDate, 1));
    const weekendDate = firstWeekendOnOrAfter(scheduleValidFrom);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );

    const dayHours = ['8', '8', '8', '8', '8', '0', '0'];
    dayHours[weekdayIndex(scheduleFreeDate)] = '0';
    const scheduleNote = `A4 Vorschau-Wochenplan ${world.runId}`;
    await openMemberDetailFromList(adminPage, employeeName);
    await addWorkScheduleViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(scheduleValidFrom),
      dayHours,
      note: scheduleNote,
    });

    let context = await getTargetContextForRecord(
      world.orgId,
      employeeRecord.id
    );
    expect(doesDateConsumeVacation(scheduleDate, context)).toBe(true);
    expect(doesDateConsumeVacation(scheduleFreeDate, context)).toBe(false);
    expect(doesDateConsumeVacation(weekendDate, context)).toBe(false);
    await expectVacationPreview(employeePage, weekendDate, 0);

    const currentYear = Number(todayIso.slice(0, 4));
    const holiday = [currentYear, currentYear + 1]
      .flatMap((year) => getPublicHolidaysForYear('BE', year))
      .find(
        (candidate) =>
          candidate.date > todayIso &&
          weekdayIndex(candidate.date) < 5 &&
          weekdayIndex(candidate.date) !== weekdayIndex(scheduleFreeDate)
      );
    if (!holiday) throw new Error('A4 could not resolve a future Berlin weekday holiday.');
    await setHolidayRegionViaSettings(adminPage, 'Berlin');
    try {
      await expectVacationPreview(employeePage, holiday.date, 0);
    } finally {
      await setHolidayRegionViaSettings(adminPage, 'Kein Feiertagskalender');
    }

    await expectVacationPreview(employeePage, scheduleDate, 1);
    await expectVacationPreview(employeePage, scheduleDate, 0.5, true);
    await expectVacationPreview(employeePage, scheduleFreeDate, 0);

    const closureLabel = `A4 Vorschau-Betriebsruhe ${world.runId}`;
    await addClosureDayViaSettings(adminPage, {
      dateDigits: toDatePickerDigits(scheduleDate),
      label: closureLabel,
    });
    try {
      context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
      expect(
        context.calendar.closureDays.some(
          (day) =>
            day.closureDate === scheduleDate && day.label === closureLabel
        )
      ).toBe(true);
      expect(doesDateConsumeVacation(scheduleDate, context)).toBe(false);
      await expectVacationPreview(employeePage, scheduleDate, 0);
    } finally {
      await removeClosureDayViaSettings(
        adminPage,
        formatGermanDate(scheduleDate)
      );
    }
  });

  test('A4-06/A4-09/A4-10: Sonstige Abwesenheit ändert Urlaub nicht, verlangt Korrekturgrund und fragt keine Diagnose ab', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );
    const context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    const ownedDates = [37, 38, 39].map((offset) =>
      shiftIsoDate(berlinTodayIso(), offset)
    );
    const overlapDate = ownedDates.find((date) =>
      doesDateConsumeVacation(date, context)
    );
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
    const approvedVacation = await getLatestVacationRequestState(
      world.orgId,
      employeeRecord.id
    );
    expect(approvedVacation).toMatchObject({
      status: 'approved',
      startDate: overlapDate,
      endDate: overlapDate,
      dayPortion: 'full',
      approvedDaysByYear: { [overlapDate.slice(0, 4)]: 1 },
      eventTypes: ['requested', 'approved'],
    });

    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, '1 von 31 Tagen genommen')).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, '30 Tage Resturlaub')).toBeVisible();

    await openOwnSicknessSection(employeePage);
    await employeePage.getByRole('button', { name: 'Krank melden' }).click();
    let dialog = employeePage.getByRole('dialog');
    await expect(
      dialog.getByText('bitte gib keine Diagnose an.', { exact: false })
    ).toBeVisible();
    await expectNoDiagnosisControl(dialog);
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toHaveCount(0);

    await openMemberDetailFromList(adminPage, employeeName);
    await adminPage.getByRole('button', { name: 'Krankmeldung erfassen' }).click();
    dialog = adminPage.getByRole('dialog');
    await expect(
      dialog.getByText('Es werden keine Krankheitsdetails erfasst.', {
        exact: false,
      })
    ).toBeVisible();
    await expectNoDiagnosisControl(dialog);
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toHaveCount(0);

    await reportOwnSicknessViaDialog(employeePage, {
      startDigits: dateDigits,
      endDigits: dateDigits,
      typeLabel: 'Sonstige Abwesenheit',
      expectVacationOverlapHint: true,
    });
    const reportedSickness = await getLatestSicknessReportState(
      world.orgId,
      employeeRecord.id
    );
    expect(reportedSickness).toMatchObject({
      status: 'reported',
      absenceType: 'sonstige',
      startDate: overlapDate,
      endDate: overlapDate,
      dayPortion: 'full',
      eventTypes: ['reported'],
    });
    expect(
      await getLatestVacationRequestState(world.orgId, employeeRecord.id)
    ).toEqual(approvedVacation);
    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, '1 von 31 Tagen genommen')).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, '30 Tage Resturlaub')).toBeVisible();

    await openMemberDetailFromList(adminPage, employeeName);
    const sicknessRange = formatSicknessRange({
      startDate: overlapDate,
      endDate: overlapDate,
    });
    await adminPage
      .getByRole('button', {
        name: `Aktionen für die Krankmeldung vom ${sicknessRange}`,
      })
      .click();
    await adminPage.getByRole('menuitem', { name: 'Korrigieren' }).click();
    dialog = adminPage.getByRole('dialog');
    const saveCorrection = dialog.getByRole('button', {
      name: 'Korrektur speichern',
    });
    await expect(saveCorrection).toBeDisabled();
    await dialog.locator('#correct-sickness-half-day').click();
    await dialog
      .locator('#correct-sickness-reason')
      .fill(`A4 telefonisch auf halbtags korrigiert ${world.runId}`);
    await expect(saveCorrection).toBeEnabled();
    await saveCorrection.click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    const correctedSickness = await getLatestSicknessReportState(
      world.orgId,
      employeeRecord.id
    );
    expect(correctedSickness).toMatchObject({
      id: reportedSickness.id,
      status: 'reported',
      absenceType: 'sonstige',
      startDate: overlapDate,
      endDate: overlapDate,
      dayPortion: 'half_day',
      eventTypes: ['reported', 'corrected'],
    });
    expect(
      await getLatestVacationRequestState(world.orgId, employeeRecord.id)
    ).toEqual(approvedVacation);
    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, '1 von 31 Tagen genommen')).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, '30 Tage Resturlaub')).toBeVisible();

    await openMemberDetailFromList(adminPage, employeeName);
    await cancelSicknessReportViaMenuWithReason(
      adminPage,
      sicknessRange,
      `A4 Prüfung abgeschlossen ${world.runId}`
    );
    const cancelledSickness = await getLatestSicknessReportState(
      world.orgId,
      employeeRecord.id
    );
    expect(cancelledSickness.status).toBe('cancelled');
    expect(cancelledSickness.eventTypes).toEqual([
      'reported',
      'corrected',
      'cancelled',
    ]);

    await cancelApprovedVacationForRangeText(
      adminPage,
      employeeName,
      rangeText,
      `A4 Prüfung abgeschlossen ${world.runId}`
    );
    const cancelledVacation = await getLatestVacationRequestState(
      world.orgId,
      employeeRecord.id
    );
    expect(cancelledVacation).toMatchObject({
      id: approvedVacation.id,
      status: 'cancelled',
      approvedDaysByYear: approvedVacation.approvedDaysByYear,
      eventTypes: ['requested', 'approved', 'cancelled'],
    });

    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, '0 von 31 Tagen genommen')).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, '31 Tage Resturlaub')).toBeVisible();
  });

  test('A4-R02: Freigabe zeigt neutral eine andere Abwesenheit und nur Aufträge im beantragten Zeitraum [P1-06-F03]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const requestDate = shiftIsoDate(berlinTodayIso(), 68);
    const outsideDate = shiftIsoDate(berlinTodayIso(), 69);
    const dateDigits = toDatePickerDigits(requestDate);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );
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
      typeLabel: 'Krankheit',
    });
    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: dateDigits,
      endDigits: dateDigits,
      comment: `A4 Freigabehinweise ${world.runId}`,
    });

    await adminPage.goto('/zeiterfassung?tab=approvals');
    const requestCard = adminPage
      .locator('[data-vacation-request]')
      .filter({ hasText: employeeName });
    await expect(requestCard).toHaveCount(1, { timeout: 15_000 });
    await expect(requestCard).toContainText(
      'Hinweis: Für diese Person liegt im beantragten Zeitraum eine weitere Abwesenheit vor.'
    );
    await expect(requestCard).toContainText(
      `Im Zeitraum eingeplant: ${inRangeJobTitle} (${formatGermanDate(requestDate)})`
    );
    await expect(requestCard).not.toContainText(outsideJobTitle);
    await expect(requestCard).not.toContainText(/Krankheit|Kind krank|Sonstige/);

    await rejectVacationRequestFor(
      adminPage,
      employeeName,
      `A4 Hinweisprüfung abgeschlossen ${world.runId}`
    );
    const rejectedVacation = await getLatestVacationRequestState(
      world.orgId,
      employeeRecord.id
    );
    expect(rejectedVacation).toMatchObject({
      status: 'rejected',
      startDate: requestDate,
      endDate: requestDate,
      eventTypes: ['requested', 'rejected'],
    });

    await cancelOwnSicknessReport(employeePage, formatGermanDate(requestDate));
    const cancelledSickness = await getLatestSicknessReportState(
      world.orgId,
      employeeRecord.id
    );
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
    test.setTimeout(300_000);
    const requestDate = berlinTodayIso();
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );
    let context = await getTargetContextForRecord(
      world.orgId,
      employeeRecord.id
    );
    let [baseTarget] = resolveDailyTargets([requestDate], context);
    if (baseTarget.targetMinutes <= 0) {
      halfDayScheduleNote = `A4 Halbtag-Wochenplan ${world.runId}`;
      await openMemberDetailFromList(adminPage, employeeName);
      await addWorkScheduleViaDialog(adminPage, {
        validFromDigits: toDatePickerDigits(requestDate),
        dayHours: ['1', '1', '1', '1', '1', '1', '1'],
        note: halfDayScheduleNote,
      });
      context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
      [baseTarget] = resolveDailyTargets([requestDate], context);
    }
    const dateDigits = toDatePickerDigits(requestDate);
    const rangeText = formatGermanDate(requestDate);
    expect(baseTarget.targetMinutes).toBeGreaterThan(0);
    const halfTargetLabel = formatDuration(
      Math.round(baseTarget.baseTargetMinutes / 2)
    );

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
    const employeePending = vacationEvent(
      adminPage,
      'pending',
      employeeName
    );
    const bueroPending = vacationEvent(adminPage, 'pending', bueroName);
    await expect(employeePending).toBeVisible({ timeout: 15_000 });
    await expect(bueroPending).toBeVisible();
    expect(
      await employeePending.evaluate(
        (element) => getComputedStyle(element).borderStyle
      )
    ).toContain('dashed');

    await openMonthCalendar(employeePage, requestDate);
    await expect(vacationEvent(employeePage, 'pending', employeeName)).toBeVisible({
      timeout: 15_000,
    });
    await expect(vacationEvent(employeePage, 'pending', bueroName)).toHaveCount(0);

    await approveVacationRequestFor(adminPage, employeeName);
    await approveVacationRequestFor(adminPage, bueroName);
    const approvedVacation = await getLatestVacationRequestState(
      world.orgId,
      employeeRecord.id
    );
    expect(approvedVacation).toMatchObject({
      status: 'approved',
      startDate: requestDate,
      endDate: requestDate,
      dayPortion: 'half_day',
      approvedDaysByYear: { [requestDate.slice(0, 4)]: 0.5 },
      eventTypes: ['requested', 'approved'],
    });

    await openOwnVacationSection(employeePage);
    await expect(
      visibleText(
        employeePage,
        `Halber Urlaubstag – Tagesziel: ${halfTargetLabel} Arbeitszeit`
      )
    ).toBeVisible({ timeout: 15_000 });

    await openMonthCalendar(adminPage, requestDate);
    const employeeApproved = vacationEvent(
      adminPage,
      'approved',
      employeeName
    );
    await expect(employeeApproved).toBeVisible({ timeout: 15_000 });
    await expect(vacationEvent(adminPage, 'approved', bueroName)).toBeVisible();
    expect(
      await employeeApproved.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      )
    ).not.toBe('rgba(0, 0, 0, 0)');

    await openMonthCalendar(employeePage, requestDate);
    await expect(
      vacationEvent(employeePage, 'approved', employeeName)
    ).toBeVisible({ timeout: 15_000 });
    await expect(vacationEvent(employeePage, 'approved', bueroName)).toHaveCount(0);

    await cancelApprovedVacationForRangeText(
      adminPage,
      employeeName,
      rangeText,
      `A4 halben Urlaub geprüft ${world.runId}`
    );
    await cancelApprovedVacationForRangeText(
      adminPage,
      bueroName,
      rangeText,
      `A4 Manager-Sicht geprüft ${world.runId}`
    );
  });

  test('A4-R04: Eigene halbtägige Krankmeldung halbiert das Tagesziel und lässt sich selbst stornieren [P1-08-F02/P1-08-F05]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const requestDate = berlinTodayIso();
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );
    let context = await getTargetContextForRecord(
      world.orgId,
      employeeRecord.id
    );
    let [baseTarget] = resolveDailyTargets([requestDate], context);
    if (baseTarget.targetMinutes <= 0) {
      halfDayScheduleNote = `A4 Halbtag-Wochenplan ${world.runId}`;
      await openMemberDetailFromList(adminPage, employeeName);
      await addWorkScheduleViaDialog(adminPage, {
        validFromDigits: toDatePickerDigits(requestDate),
        dayHours: ['1', '1', '1', '1', '1', '1', '1'],
        note: halfDayScheduleNote,
      });
      context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
      [baseTarget] = resolveDailyTargets([requestDate], context);
    }
    const dateDigits = toDatePickerDigits(requestDate);
    const rangeText = formatGermanDate(requestDate);
    expect(baseTarget.targetMinutes).toBeGreaterThan(0);
    const halfTargetLabel = formatDuration(
      Math.round(baseTarget.baseTargetMinutes / 2)
    );

    await reportOwnSicknessViaDialog(employeePage, {
      startDigits: dateDigits,
      endDigits: dateDigits,
      halfDay: true,
      typeLabel: 'Krankheit',
    });
    const reported = await getLatestSicknessReportState(
      world.orgId,
      employeeRecord.id
    );
    expect(reported).toMatchObject({
      status: 'reported',
      startDate: requestDate,
      endDate: requestDate,
      dayPortion: 'half_day',
      eventTypes: ['reported'],
    });
    await employeePage.goto('/zeiterfassung');
    await expect(
      visibleText(
        employeePage,
        `Halber Tag Krankmeldung – Tagesziel: ${halfTargetLabel} Arbeitszeit`
      )
    ).toBeVisible({ timeout: 15_000 });

    await openMonthCalendar(adminPage, requestDate);
    await expect(
      adminPage
        .locator('.fc-vacation-approved')
        .filter({ hasText: `Abwesend – ${employeeName} (halber Tag)` })
    ).toBeVisible({ timeout: 15_000 });

    await cancelOwnSicknessReport(employeePage, rangeText);
    const cancelled = await getLatestSicknessReportState(
      world.orgId,
      employeeRecord.id
    );
    expect(cancelled).toMatchObject({
      id: reported.id,
      status: 'cancelled',
      eventTypes: ['reported', 'cancelled'],
    });
    await employeePage.goto('/zeiterfassung');
    await expect(
      visibleText(
        employeePage,
        `Tagesziel: ${formatDuration(baseTarget.baseTargetMinutes)} Arbeitszeit`
      )
    ).toBeVisible({ timeout: 15_000 });
    await openMonthCalendar(adminPage, requestDate);
    await expect(
      adminPage.getByText(`Abwesend – ${employeeName} (halber Tag)`)
    ).toHaveCount(0, { timeout: 15_000 });

    await openMemberDetailFromList(adminPage, employeeName);
    if (halfDayScheduleNote) {
      await deleteWorkScheduleViaDetail(
        adminPage,
        requestDate,
        halfDayScheduleNote
      );
    }
    await deleteWorkScheduleViaDetail(
      adminPage,
      shiftIsoDate(requestDate, 1),
      `A4 Vorschau-Wochenplan ${world.runId}`
    );
  });
});
