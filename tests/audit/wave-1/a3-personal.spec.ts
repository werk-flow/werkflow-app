import type { Page } from '@playwright/test';

import {
  ACCESS_STATE_LABELS,
  EMPLOYMENT_STATE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
} from '../../../lib/personnel/types';
import { HOLIDAY_REGION_LABELS } from '../../../lib/personnel/holidays';
import { RESPONSIBILITY_LABELS } from '../../../lib/responsibilities/types';
import { formatDuration } from '../../../lib/time-tracking/helpers';
import { expect, test } from '../support/fixtures';
import { berlinDateAtOffset, ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import {
  getEmployeeRecordEventStates,
  getEmployeeRecordStateByUser,
  setResponsibilityHolders,
} from '../../golden/support/db/personnel';
import { getLatestManualTimeEntryState } from '../../golden/support/db/time-tracking';
import { getTargetContextForRecord } from '../../golden/support/db/vacation';
import { goldenTestEmail } from '../../golden/support/seed';
import { dismissDialog } from '../../golden/support/steps/interaction';
import {
  PERSONNEL_COPY,
  PERSONNEL_FIELDS,
  PERSONNEL_HISTORY_EVENTS,
  RESPONSIBILITY_COPY,
  activeDelegationsBadge,
  addClosureDayViaSettings,
  addConditionButton,
  addConditionViaDialog,
  addDelegationButton,
  addWorkScheduleViaDialog,
  changeResponsibilityButton,
  conditionRow,
  conditionVacationDaysText,
  conditionWeeklyHoursText,
  createPersonnelRecordButton,
  createPersonnelRecordViaDialog,
  createResponsibilityDelegationViaSettings,
  dailyProgressAtPercent,
  dailyProgressOnClosureDay,
  dailyTargetText,
  defaultTargetMarker,
  deleteConditionViaMenu,
  editConditionWeeklyHours,
  editPersonnelExitDate,
  editPersonnelTextField,
  endResponsibilityDelegationViaSettings,
  openMemberDetailFromList,
  personnelChangeText,
  personnelListRow,
  removeClosureDayViaSettings,
  responsibilityCard,
  responsibilitySummary,
  sendInviteFromPersonnelRecord,
  setHolidayRegionViaSettings,
  submitClosureDayForm,
  submitPersonnelRecordButton,
  substituteForText,
  visibleVersionBadge,
  weeklyScheduleText,
} from '../../golden/support/steps/personnel';
import { typeIntoDatePicker, visibleText } from '../../golden/support/steps/shared';
import {
  createOwnManualTimeEntry,
  expectPendingTimeApprovalHidden,
  expectTimeApprovalsUnavailable,
  openTimeApprovals,
} from '../../golden/support/steps/time-tracking';
import { showCalendarMonth } from '../../golden/support/steps/calendar';
import {
  ZERO_OVERTIME_TODAY,
  firstPersonnelHistoryEvent,
  informationalCalendarEvent,
  todayOvertime,
} from '../support/a3-steps';
import { waitForRouteIntercept } from '../support/network';

// A3 — Personal (P1-03, P1-04, P1-05). The edge cases, role variants and
// list values around the golden journeys: the full master-data form with its
// history attribution, every status badge, the closure-day date boundary, the
// holiday-region history, the schedule's effect on list progress and
// overtime, and what affected people and Büro see of responsibilities. Every
// test prepares its own records; the run-day window is +30 … +34 and +67.

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined)
    throw new Error(`Invalid ISO date: ${dateIso}`);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10);
}

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

function toGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

async function expectHistoryAttribution(page: Page, eventLabel: string, actorName: string): Promise<void> {
  const event = firstPersonnelHistoryEvent(page, eventLabel);
  await expect(event).toBeVisible();
  await expect(event).toContainText(actorName);
  await expect(event).toContainText(/\d{2}\.\d{2}\.\d{4},? \d{2}:\d{2}/);
}

async function navigateMonthViewTo(page: Page, dateIso: string): Promise<void> {
  const today = berlinDateAtOffset(0);
  const monthDifference =
    Number(dateIso.slice(0, 4)) * 12 +
    Number(dateIso.slice(5, 7)) -
    (Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)));
  await showCalendarMonth(page, monthDifference);
  const expectedTitle = new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateIso.slice(0, 7)}-01T12:00:00Z`));
  await expect(visibleText(page, expectedTitle)).toBeVisible();
}

test.describe('Wave 1 Audit A3 Personal @AUDIT-W1-A3', () => {
  test('A3-01/A3-03: Vollständige Personalakte, geplante Kondition und nachvollziehbare Werte', async ({
    adminPage,
    world,
  }) => {
    const entryDate = berlinDateAtOffset(30);
    const conditionDate = ownedBerlinDateAtOffset('a3-personal', 31);
    const exitDate = berlinDateAtOffset(34);
    const fullName = `Alina Personal-A3-${world.runId}`;
    const employeeNumber = `MA-A3-${world.runId}`;
    const privateEmail = goldenTestEmail('a3-personal', world.runId);
    const note = `A3 Personalakte ${world.runId}`;
    const conditionNote = `A3 Kondition ${world.runId}`;
    // Hold the number-suggestion server action so the manual number is typed
    // first: the late suggestion must not overwrite it.
    let releaseSuggestion: () => void = () => undefined;
    let markIntercepted: () => void = () => undefined;
    const suggestionGate = new Promise<void>((resolve) => {
      releaseSuggestion = resolve;
    });
    const intercepted = new Promise<void>((resolve) => {
      markIntercepted = resolve;
    });
    let held = false;

    await adminPage.route('**/mitarbeiter', async (route) => {
      const request = route.request();
      if (!held && request.method() === 'POST' && Boolean(request.headers()['next-action'])) {
        held = true;
        markIntercepted();
        await suggestionGate;
      }
      await route.continue();
    });

    await adminPage.goto('/mitarbeiter');
    try {
      await createPersonnelRecordButton(adminPage).click();
      try {
        await waitForRouteIntercept(intercepted);
      } catch (error) {
        throw new Error(
          'The personnel-number suggestion server action was not intercepted within 15 seconds.',
          { cause: error },
        );
      }

      const dialog = adminPage.getByRole('dialog');
      await dialog.locator('#personnel-first-name').fill('Alina');
      await dialog.locator('#personnel-last-name').fill(`Personal-A3-${world.runId}`);
      await dialog.locator('#personnel-number').fill(employeeNumber);
      const suggestionResponse = adminPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/mitarbeiter' &&
          Boolean(response.request().headers()['next-action']),
        { timeout: 15_000 },
      );
      releaseSuggestion();
      await suggestionResponse;
      await expect(dialog.locator('#personnel-number')).toHaveValue(employeeNumber, {
        timeout: 15_000,
      });
      await typeIntoDatePicker(dialog, PERSONNEL_COPY.entryDate, toDatePickerDigits(entryDate));
      await dialog.locator('#personnel-notes').fill(note);
      await submitPersonnelRecordButton(dialog).click();
      await adminPage.waitForURL(/\/mitarbeiter\/[0-9a-f-]{36}/, {
        timeout: 20_000,
      });
    } finally {
      releaseSuggestion();
      await adminPage.unroute('**/mitarbeiter');
    }

    const a3RecordId = adminPage.url().match(/\/mitarbeiter\/([0-9a-f-]{36})/)?.[1];
    if (!a3RecordId) throw new Error('Could not read the A3 personnel record id.');

    await editPersonnelTextField(adminPage, PERSONNEL_FIELDS.phone, '030 300030');
    await editPersonnelTextField(adminPage, PERSONNEL_FIELDS.private_email, privateEmail);
    await editPersonnelTextField(adminPage, PERSONNEL_FIELDS.street, 'Personalweg 30');
    await editPersonnelTextField(adminPage, PERSONNEL_FIELDS.postal_code, '10115');
    await editPersonnelTextField(adminPage, PERSONNEL_FIELDS.city, 'Berlin');
    await editPersonnelTextField(adminPage, PERSONNEL_FIELDS.emergency_contact_name, 'Nina Notfall A3');
    await editPersonnelTextField(adminPage, PERSONNEL_FIELDS.emergency_contact_phone, '030 300031');
    await editPersonnelExitDate(adminPage, exitDate);

    for (const value of [
      fullName,
      employeeNumber,
      '030 300030',
      privateEmail,
      'Personalweg 30',
      '10115',
      'Berlin',
      'Nina Notfall A3',
      '030 300031',
      toGermanDate(entryDate),
      toGermanDate(exitDate),
      note,
    ]) {
      await expect(visibleText(adminPage, value)).toBeVisible();
    }

    await addConditionButton(adminPage).click();
    const optionDialog = adminPage.getByRole('dialog');
    await optionDialog.locator('#condition-type').click();
    for (const employmentType of Object.values(EMPLOYMENT_TYPE_LABELS)) {
      await expect(adminPage.getByRole('option', { name: employmentType, exact: true })).toBeVisible();
    }
    await dismissDialog(adminPage.getByRole('listbox'));
    await dismissDialog(optionDialog);
    await expect(optionDialog).toHaveCount(0);

    await addConditionViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(conditionDate),
      employmentTypeLabel: EMPLOYMENT_TYPE_LABELS.ausbildung,
      weeklyHours: '35',
      vacationDays: '28',
      note: conditionNote,
    });
    await expect(visibleVersionBadge(adminPage, 'scheduled')).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(adminPage, EMPLOYMENT_TYPE_LABELS.ausbildung)).toBeVisible();
    await expect(visibleText(adminPage, conditionWeeklyHoursText(35))).toBeVisible();
    await expect(visibleText(adminPage, conditionVacationDaysText(28))).toBeVisible();
    await expect(visibleText(adminPage, conditionNote)).toBeVisible();

    await editConditionWeeklyHours(adminPage, toGermanDate(conditionDate), '34');
    await adminPage.reload();
    await expect(visibleText(adminPage, personnelChangeText('phone', null, '030 300030'))).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      visibleText(adminPage, personnelChangeText('private_email', null, privateEmail)),
    ).toBeVisible();
    await expect(visibleText(adminPage, personnelChangeText('weekly_hours', '35', '34'))).toBeVisible();
    await expect(visibleText(adminPage, personnelChangeText('note', null, conditionNote))).toBeVisible();
    for (const createdValue of [
      personnelChangeText('employee_number', null, employeeNumber),
      personnelChangeText('first_name', null, 'Alina'),
      personnelChangeText('notes', null, note),
    ]) {
      await expect(visibleText(adminPage, createdValue)).toBeVisible();
    }

    const deletedConditionDate = ownedBerlinDateAtOffset('a3-personal', 32);
    const deletedConditionNote = `A3 Minijob gelöscht ${world.runId}`;
    await addConditionViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(deletedConditionDate),
      employmentTypeLabel: EMPLOYMENT_TYPE_LABELS.minijob,
      weeklyHours: '10',
      vacationDays: '12',
      note: deletedConditionNote,
    });
    const deletedConditionRow = conditionRow(adminPage, toGermanDate(deletedConditionDate));
    await expect(deletedConditionRow).toContainText(EMPLOYMENT_TYPE_LABELS.minijob);
    await expect(deletedConditionRow).toContainText(deletedConditionNote);
    await deleteConditionViaMenu(adminPage, toGermanDate(deletedConditionDate));

    await adminPage.reload();
    await expect(visibleText(adminPage, PERSONNEL_HISTORY_EVENTS.condition_deleted)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      visibleText(adminPage, personnelChangeText('employment_type', EMPLOYMENT_TYPE_LABELS.minijob, null)),
    ).toBeVisible();
    await expect(
      visibleText(adminPage, personnelChangeText('note', deletedConditionNote, null)),
    ).toBeVisible();

    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    for (const eventLabel of [
      PERSONNEL_HISTORY_EVENTS.created,
      PERSONNEL_HISTORY_EVENTS.master_data_updated,
      PERSONNEL_HISTORY_EVENTS.condition_added,
      PERSONNEL_HISTORY_EVENTS.condition_updated,
      PERSONNEL_HISTORY_EVENTS.condition_deleted,
    ]) {
      await expectHistoryAttribution(adminPage, eventLabel, adminName);
    }
    // The visible history is backed by attributed, non-empty event payloads.
    const eventStates = await getEmployeeRecordEventStates(world.orgId, a3RecordId);
    for (const eventType of [
      'created',
      'master_data_updated',
      'condition_added',
      'condition_updated',
      'condition_deleted',
    ]) {
      const event = eventStates.find((state) => state.eventType === eventType);
      expect(event, `Missing ${eventType} event`).toBeDefined();
      expect(event?.createdBy).toBe(world.users.admin.id);
      expect(Object.keys(event?.eventPayload ?? {}).length).toBeGreaterThan(0);
    }

    await adminPage.goto('/mitarbeiter');
    await createPersonnelRecordButton(adminPage).click();
    const duplicateDialog = adminPage.getByRole('dialog');
    await duplicateDialog.locator('#personnel-last-name').fill(`Dora Doppel-A3-${world.runId}`);
    const duplicateNumberInput = duplicateDialog.locator('#personnel-number');
    await expect(duplicateNumberInput).toHaveValue(/^MA-\d+$/, {
      timeout: 15_000,
    });
    await duplicateNumberInput.fill(employeeNumber);
    await expect(duplicateNumberInput).toHaveValue(employeeNumber);
    await typeIntoDatePicker(duplicateDialog, PERSONNEL_COPY.entryDate, toDatePickerDigits(entryDate));
    await submitPersonnelRecordButton(duplicateDialog).click();
    await expect(duplicateDialog.getByText(PERSONNEL_COPY.numberTaken)).toBeVisible({
      timeout: 15_000,
    });
    await dismissDialog(duplicateDialog);
    await expect(duplicateDialog).toBeHidden({ timeout: 15_000 });
    await adminPage.goto(`/mitarbeiter/${a3RecordId}`);
    await expect(visibleText(adminPage, employeeNumber)).toBeVisible();
  });

  test('A3-R01: Alle Personalzeilen zeigen Beschäftigungs- und Zugangsstatus vollständig', async ({
    adminPage,
    world,
  }) => {
    const plannedName = `Pia Planung-A3-${world.runId}`;
    const exitedName = `Eva Ehemalig-A3-${world.runId}`;
    const activeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const exitedEmployeeNumber = `MA-A3-E-${world.runId}`;

    const plannedRecordId = await createPersonnelRecordViaDialog(adminPage, {
      firstName: 'Pia',
      lastName: `Planung-A3-${world.runId}`,
      entryDateDigits: toDatePickerDigits(berlinDateAtOffset(30)),
      employeeNumber: `MA-A3-P-${world.runId}`,
    });
    await adminPage.goto('/mitarbeiter');
    const plannedRow = personnelListRow(adminPage, plannedName);
    await expect(plannedRow.getByText(EMPLOYMENT_STATE_LABELS.geplant, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(plannedRow.getByText(ACCESS_STATE_LABELS.ohne_zugang, { exact: true })).toBeVisible();

    const activeRow = personnelListRow(adminPage, activeName);
    await expect(activeRow.getByText(EMPLOYMENT_STATE_LABELS.aktiv, { exact: true })).toBeVisible();
    await expect(activeRow.getByText(ACCESS_STATE_LABELS.mit_zugang, { exact: true })).toBeVisible();

    await adminPage.goto(`/mitarbeiter/${plannedRecordId}`);
    await sendInviteFromPersonnelRecord(adminPage, `delivered+a3-${world.runId}@resend.dev`, 'employee');
    await adminPage.goto('/mitarbeiter');
    await expect(
      personnelListRow(adminPage, plannedName).getByText(ACCESS_STATE_LABELS.eingeladen, { exact: true }),
    ).toBeVisible();

    await createPersonnelRecordViaDialog(adminPage, {
      firstName: 'Eva',
      lastName: `Ehemalig-A3-${world.runId}`,
      entryDateDigits: toDatePickerDigits(berlinDateAtOffset(-60)),
      employeeNumber: exitedEmployeeNumber,
    });
    await editPersonnelExitDate(adminPage, berlinDateAtOffset(-1));
    await adminPage.goto('/mitarbeiter');
    const exitedRow = personnelListRow(adminPage, exitedName);
    await expect(exitedRow.getByText(EMPLOYMENT_STATE_LABELS.ausgeschieden, { exact: true })).toBeVisible();
    await expect(exitedRow.getByText(ACCESS_STATE_LABELS.ohne_zugang, { exact: true })).toBeVisible();
    await expect(exitedRow).toContainText(exitedEmployeeNumber);
  });

  test('A3-06/A3-07: Betriebsruhe respektiert die Datumsgrenze, Büro pflegt sie mit; Feiertagswechsel bleibt historisch', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const pastDate = berlinDateAtOffset(-1);
    const closureDate = ownedBerlinDateAtOffset('a3-personal', 32);
    const closureLabel = `A3 Betriebsruhe ${world.runId}`;
    const bueroClosureDate = ownedBerlinDateAtOffset('a3-personal', 33);
    const bueroClosureLabel = `A3 Büro-Betriebsruhe ${world.runId}`;

    // A future closure day is stored and removable again.
    await addClosureDayViaSettings(adminPage, {
      dateDigits: toDatePickerDigits(closureDate),
      label: closureLabel,
    });
    let context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    expect(
      context.calendar.closureDays.some(
        (day) => day.closureDate === closureDate && day.label === closureLabel,
      ),
    ).toBe(true);
    await removeClosureDayViaSettings(adminPage, toGermanDate(closureDate));
    context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    expect(context.calendar.closureDays.some((day) => day.closureDate === closureDate)).toBe(false);

    // A past day is never rewritten.
    await adminPage.goto('/einstellungen/zeiterfassung');
    await submitClosureDayForm(adminPage, {
      dateDigits: toDatePickerDigits(pastDate),
      label: `A3 Vergangenheit ${world.runId}`,
    });
    await expect(visibleText(adminPage, PERSONNEL_COPY.closurePastDay)).toBeVisible({ timeout: 15_000 });

    // Büro maintains closure days too; the month grid shows them as labels
    // that cannot be clicked.
    await addClosureDayViaSettings(bueroPage, {
      dateDigits: toDatePickerDigits(bueroClosureDate),
      label: bueroClosureLabel,
    });
    context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    expect(
      context.calendar.closureDays.some(
        (day) => day.closureDate === bueroClosureDate && day.label === bueroClosureLabel,
      ),
    ).toBe(true);
    await navigateMonthViewTo(adminPage, bueroClosureDate);
    const closureEvent = informationalCalendarEvent(adminPage, bueroClosureLabel);
    await expect(closureEvent).toBeVisible({ timeout: 15_000 });
    await expect(closureEvent).toHaveCSS('pointer-events', 'none');
    await closureEvent.dispatchEvent('click');
    await expect(adminPage.getByRole('dialog')).toHaveCount(0);
    await removeClosureDayViaSettings(bueroPage, toGermanDate(bueroClosureDate));
    context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    expect(context.calendar.closureDays.some((day) => day.closureDate === bueroClosureDate)).toBe(false);

    // A region change appends to the history instead of rewriting it.
    await setHolidayRegionViaSettings(adminPage, HOLIDAY_REGION_LABELS.BE);
    await setHolidayRegionViaSettings(adminPage, HOLIDAY_REGION_LABELS.TH);
    context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    const [firstRegion, secondRegion] = context.calendar.holidayRegionHistory.slice(-2);
    if (!firstRegion || !secondRegion) throw new Error('A3 expects two holiday region history entries.');
    expect([firstRegion.region, secondRegion.region]).toEqual(['BE', 'TH']);
    expect(new Date(firstRegion.effectiveFrom).getTime()).toBeLessThanOrEqual(
      new Date(secondRegion.effectiveFrom).getTime(),
    );

    await setHolidayRegionViaSettings(adminPage, PERSONNEL_COPY.noHolidayRegion);
    context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    expect(context.calendar.holidayRegion).toBeNull();
    expect(context.calendar.holidayRegionHistory.at(-1)?.region).toBe('');
  });

  test('A3-R02: Arbeitszeitmodell steuert Ziel, Fortschritt, Überstunden und Listenwerte zugänglich', async ({
    adminPage,
    businessDate,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;

    // A one-minute daily plan from today and eight worked minutes in the
    // completed 00:01–00:09 window of the business date: the runner never
    // starts a group between 23:40 and 00:10, so the window lies in the past.
    await openMemberDetailFromList(adminPage, employeeName);
    await addWorkScheduleViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(businessDate),
      dayHours: ['0,02', '0,02', '0,02', '0,02', '0,02', '0,02', '0,02'],
      note: `A3 Ein-Minuten-Modell ${world.runId}`,
    });
    await expect(visibleText(adminPage, weeklyScheduleText({ minutes: 7 }))).toBeVisible({
      timeout: 15_000,
    });
    await createOwnManualTimeEntry(adminPage, {
      memberName: employeeName,
      dateDigits: toDatePickerDigits(businessDate),
      clockInDigits: '0001',
      clockOutDigits: '0009',
    });

    await employeePage.goto('/zeiterfassung');
    await expect(visibleText(employeePage, dailyTargetText(formatDuration(1)))).toBeVisible({
      timeout: 15_000,
    });
    await expect(todayOvertime(employeePage)).not.toHaveText(ZERO_OVERTIME_TODAY);

    await adminPage.goto('/mitarbeiter');
    await expect(dailyProgressAtPercent(personnelListRow(adminPage, employeeName), 100)).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    await expect(defaultTargetMarker(personnelListRow(adminPage, bueroName))).toBeVisible();

    // A closure day turns the list value into a labeled zero target.
    await addClosureDayViaSettings(adminPage, {
      dateDigits: toDatePickerDigits(businessDate),
      label: `A3 Nullziel ${world.runId}`,
    });
    try {
      await adminPage.goto('/mitarbeiter');
      await expect(dailyProgressOnClosureDay(personnelListRow(adminPage, employeeName))).toHaveAttribute(
        'aria-valuenow',
        '0',
      );
    } finally {
      await removeClosureDayViaSettings(adminPage, toGermanDate(businessDate));
    }
  });

  test('A3-11: Betroffene sehen eigene Verantwortung und Vertretung, Büro liest nur, Manager sehen die Personenzusammenfassung', async ({
    adminPage,
    bueroPage,
    businessDate,
    employeePage,
    world,
  }) => {
    const yesterdayDigits = toDatePickerDigits(shiftIsoDate(businessDate, -1));
    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const [adminRecord, employeeRecord] = await Promise.all([
      getEmployeeRecordStateByUser(world.orgId, world.users.admin.id),
      getEmployeeRecordStateByUser(world.orgId, world.users.employee.id),
    ]);
    const pin = (
      responsibility: 'time_approval' | 'leave_approval',
      holderEmployeeRecordIds: readonly string[] | 'role_default',
    ) =>
      setResponsibilityHolders({
        organizationId: world.orgId,
        ownerUserId: world.users.admin.id,
        responsibility,
        holderEmployeeRecordIds,
      });

    // A selected field worker sees the own responsibility, without any control to change it.
    await pin('time_approval', [employeeRecord.id]);
    await employeePage.goto('/einstellungen/mitarbeiter');
    await expect(visibleText(employeePage, RESPONSIBILITY_LABELS.time_approval)).toBeVisible({
      timeout: 15_000,
    });
    await expect(changeResponsibilityButton(employeePage)).toHaveCount(0);
    await expect(addDelegationButton(employeePage)).toHaveCount(0);
    await expect(employeePage.getByTestId('responsibility-time_approval')).toHaveCount(0);

    // Büro reads the configuration and cannot change it.
    await pin('time_approval', 'role_default');
    await pin('leave_approval', [adminRecord.id]);
    await bueroPage.goto('/einstellungen/mitarbeiter');
    await expect(responsibilityCard(bueroPage, 'time_approval')).toContainText(
      RESPONSIBILITY_COPY.roleDefaultMode,
    );
    await expect(responsibilityCard(bueroPage, 'leave_approval')).toContainText(
      RESPONSIBILITY_COPY.selectedMode,
    );
    await expect(changeResponsibilityButton(bueroPage)).toHaveCount(0);
    await expect(addDelegationButton(bueroPage)).toHaveCount(0);
    for (const responsibility of ['time_approval', 'leave_approval'] as const) {
      await expect(responsibilityCard(bueroPage, responsibility)).toContainText(
        RESPONSIBILITY_COPY.readOnlyHint,
      );
    }

    // The substitute sees the own substitution.
    await createResponsibilityDelegationViaSettings(adminPage, {
      responsibility: 'leave_approval',
      delegatorName: adminName,
      substituteName: employeeName,
      validFromDigits: toDatePickerDigits(businessDate),
      validUntilDigits: toDatePickerDigits(shiftIsoDate(businessDate, 30)),
    });
    await employeePage.goto('/einstellungen/mitarbeiter');
    await expect(visibleText(employeePage, RESPONSIBILITY_COPY.ownSummary)).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, substituteForText(adminName))).toBeVisible();
    await expect(visibleText(employeePage, RESPONSIBILITY_COPY.substituteUntil)).toBeVisible();

    // Under the role default the admin's own entry stays the direct recovery
    // path, while Büro's own entry waits and never reaches Büro's own list.
    await createOwnManualTimeEntry(adminPage, {
      memberName: adminName,
      dateDigits: yesterdayDigits,
      clockInDigits: '0010',
      clockOutDigits: '0020',
    });
    expect((await getLatestManualTimeEntryState(world.orgId, world.users.admin.id)).status).toBe('approved');
    await createOwnManualTimeEntry(bueroPage, {
      memberName: bueroName,
      dateDigits: yesterdayDigits,
      clockInDigits: '0030',
      clockOutDigits: '0040',
    });
    expect((await getLatestManualTimeEntryState(world.orgId, world.users.buero.id)).status).toBe('pending');
    await expectTimeApprovalsUnavailable(employeePage);
    await openTimeApprovals(bueroPage);
    await expectPendingTimeApprovalHidden(bueroPage, world.users.buero.id);

    for (const managerPage of [adminPage, bueroPage]) {
      await managerPage.goto('/einstellungen/mitarbeiter');
      await expect(visibleText(managerPage, RESPONSIBILITY_COPY.ownSummary)).toBeVisible({
        timeout: 15_000,
      });
      await expect(visibleText(managerPage, RESPONSIBILITY_COPY.currentlyResponsible)).toBeVisible();
    }

    await openMemberDetailFromList(adminPage, employeeName);
    const summary = responsibilitySummary(adminPage);
    await expect(summary).toBeVisible();
    await expect(summary.getByText(RESPONSIBILITY_LABELS.leave_approval, { exact: true })).toBeVisible();
    await expect(activeDelegationsBadge(summary, 1)).toBeVisible();

    // After the end the person keeps the history but is no longer responsible.
    await endResponsibilityDelegationViaSettings(adminPage, 'leave_approval', employeeName);
    await employeePage.goto('/einstellungen/mitarbeiter');
    await expect(visibleText(employeePage, RESPONSIBILITY_COPY.ownSummary)).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, RESPONSIBILITY_COPY.notResponsible)).toBeVisible();
    await expect(visibleText(employeePage, substituteForText(adminName))).toBeVisible();
  });
});
