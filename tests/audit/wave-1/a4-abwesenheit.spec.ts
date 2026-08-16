import type { Locator } from '@playwright/test';

import { doesDateConsumeVacation } from '../../../lib/vacation/balance';
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
  approveVacationRequestFor,
  cancelApprovedVacationForRangeText,
  cancelSicknessReportViaMenuWithReason,
  createOwnVacationRequestViaDialog,
  openMemberDetailFromList,
  openOwnSicknessSection,
  openOwnVacationSection,
  reportOwnSicknessViaDialog,
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

async function expectNoDiagnosisControl(
  dialog: Locator
): Promise<void> {
  await expect(dialog.getByLabel(/Diagnose/i)).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: /Diagnose/i })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: /Diagnose/i })).toHaveCount(0);
  await expect(dialog.getByPlaceholder(/Diagnose/i)).toHaveCount(0);
}

test.describe('A4 Abwesenheitscluster @AUDIT-W1-A4', () => {
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
});
