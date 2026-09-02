import {
  getHolidayContextDays,
  resolveDailyTarget,
  resolveHolidayRegionOnDate,
} from '../../../lib/personnel/targets';
import { formatDuration } from '../../../lib/time-tracking/helpers';
import { expect, test } from '../../golden/support/fixtures';
import { berlinDateAtOffset, ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import {
  getEmployeeRecordEventStates,
  getEmployeeRecordStateByUser,
  getLatestManualTimeEntryState,
  getLatestResponsibilityConfigurationState,
  getTargetContextForRecord,
} from '../../golden/support/db';
import { requireChainedValue } from '../../golden/support/preconditions';
import { goldenTestEmail } from '../../golden/support/seed';
import {
  addClosureDayViaSettings,
  addConditionViaDialog,
  addWorkScheduleViaDialog,
  approvePendingTimeEntry,
  confirmResponsibilityPreview,
  createOwnManualTimeEntry,
  createPersonnelRecordViaDialog,
  createResponsibilityDelegationViaSettings,
  editConditionWeeklyHours,
  editPersonnelTextField,
  endResponsibilityDelegationViaSettings,
  expectPendingTimeApprovalHidden,
  expectPendingTimeApprovalVisible,
  expectTimeApprovalsUnavailable,
  openMemberDetailFromList,
  openTimeApprovals,
  previewResponsibilityChange,
  removeClosureDayViaSettings,
  sendInviteFromPersonnelRecord,
  setHolidayRegionViaSettings,
  typeIntoDatePicker,
  visibleText,
} from '../../golden/support/steps';
import {
  firstPersonnelHistoryEvent,
  informationalCalendarEvent,
  waitForPersonnelSuggestionIntercept,
} from '../support/a3-steps';

test.describe.configure({ mode: 'serial' });

let a3PersonnelRecordId = '';

function a3PersonnelName(runId: string): string {
  return `Alina Personal-A3-${runId}`;
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

function toGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

function toBerlinIsoDate(value: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function getCompletedBerlinTimeWindow(now = new Date()): {
  clockInDigits: string;
  clockOutDigits: string;
  calendarTitle: RegExp;
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  const currentMinute = hour * 60 + minute;

  if (!Number.isInteger(currentMinute) || currentMinute < 11) {
    throw new Error(
      'A3-R02 needs ten completed Berlin minutes after midnight to prove overtime.'
    );
  }

  const endMinute = currentMinute - 1;
  const startMinute = endMinute - 10;
  const formatDigits = (minuteOfDay: number) =>
    `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}${String(
      minuteOfDay % 60
    ).padStart(2, '0')}`;
  const formatLabel = (minuteOfDay: number) =>
    `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(
      minuteOfDay % 60
    ).padStart(2, '0')}`;

  return {
    clockInDigits: formatDigits(startMinute),
    clockOutDigits: formatDigits(endMinute),
    calendarTitle: new RegExp(
      `${formatLabel(startMinute)}.*${formatLabel(endMinute)}`
    ),
  };
}

function personnelRow(
  page: import('@playwright/test').Page,
  name: string
): import('@playwright/test').Locator {
  return page.getByRole('row').filter({ hasText: name }).filter({ visible: true });
}

async function expectHistoryAttribution(
  page: import('@playwright/test').Page,
  eventLabel: string,
  actorName: string
): Promise<void> {
  const event = firstPersonnelHistoryEvent(page, eventLabel);
  await expect(event).toBeVisible();
  await expect(event).toContainText(actorName);
  await expect(event).toContainText(/\d{2}\.\d{2}\.\d{4},? \d{2}:\d{2}/);
}

async function navigateMonthViewTo(
  page: import('@playwright/test').Page,
  dateIso: string
): Promise<void> {
  await page.goto('/kalender');
  await page.getByRole('tab', { name: 'Monat' }).click();
  const today = berlinDateAtOffset(0);
  const monthDifference =
    Number(dateIso.slice(0, 4)) * 12 +
    Number(dateIso.slice(5, 7)) -
    (Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)));
  const navigationButton = monthDifference >= 0 ? 'Weiter' : 'Zurück';
  for (let index = 0; index < Math.abs(monthDifference); index += 1) {
    await page.getByRole('button', { name: navigationButton }).click();
  }
  const expectedTitle = new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateIso.slice(0, 7)}-01T12:00:00Z`));
  await expect(visibleText(page, expectedTitle)).toBeVisible();
}

async function expectInformationalCalendarEvent(
  page: import('@playwright/test').Page,
  label: string
): Promise<void> {
  const event = informationalCalendarEvent(page, label);
  await expect(event).toBeVisible({ timeout: 15_000 });
  await expect(event).not.toHaveClass(/fc-event-draggable/);
  await expect(event).toHaveCSS('pointer-events', 'none');
  await event.dispatchEvent('click');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function editPersonnelDateField(
  page: import('@playwright/test').Page,
  fieldLabel: string,
  dateIso: string
): Promise<void> {
  await page.getByRole('button', { name: `${fieldLabel} bearbeiten`, exact: true }).click();
  await typeIntoDatePicker(page.getByRole('main'), 'Datum', toDatePickerDigits(dateIso), 10);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `${fieldLabel} bearbeiten`, exact: true })
  ).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(visibleText(page, toGermanDate(dateIso))).toBeVisible({
    timeout: 15_000,
  });
}

async function deleteWorkBlockViaCalendar(
  page: import('@playwright/test').Page,
  title: RegExp
): Promise<void> {
  await page.goto('/kalender');
  await page.getByRole('tab', { name: 'Tag', exact: true }).click();
  await visibleText(page, 'Arbeitszeiten').click();
  await page.getByRole('button', { name: 'Aktualisieren' }).click();
  const block = page.getByTitle(title).filter({ visible: true });
  await expect(block).toBeVisible({ timeout: 20_000 });
  const openDetailsButton = block.getByRole('button');
  await openDetailsButton.focus();
  await openDetailsButton.press('Enter');
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Eintrag Details' }),
  });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Löschen', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(page.getByTitle(title)).toHaveCount(0, { timeout: 20_000 });
}

async function deleteWorkScheduleViaDetail(
  page: import('@playwright/test').Page,
  validFromIso: string,
  note: string
): Promise<void> {
  const row = page.getByRole('listitem').filter({ hasText: note });
  await row
    .getByRole('button', {
      name: `Aktionen für Wochenplan ab ${toGermanDate(validFromIso)}`,
    })
    .click();
  await page.getByRole('menuitem', { name: 'Löschen' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0, {
    timeout: 15_000,
  });
  await page.reload();
  await expect(
    page.getByRole('button', {
      name: `Aktionen für Wochenplan ab ${toGermanDate(validFromIso)}`,
    })
  ).toHaveCount(0);
}

test.describe('Wave 1 Audit A3 Personal @AUDIT-W1-A3', () => {
  test('A3-01/A3-03: Vollständige Personalakte, geplante Kondition und nachvollziehbare Werte', async ({
    adminPage,
    world,
  }) => {
    const entryDate = berlinDateAtOffset(30);
    const conditionDate = ownedBerlinDateAtOffset('a3-personal', 31);
    const exitDate = berlinDateAtOffset(34);
    const fullName = a3PersonnelName(world.runId);
    const employeeNumber = `MA-A3-${world.runId}`;
    const privateEmail = goldenTestEmail('a3-personal', world.runId);
    const note = `A3 Personalakte ${world.runId}`;
    const conditionNote = `A3 Kondition ${world.runId}`;
    let releaseSuggestion!: () => void;
    let markIntercepted!: () => void;
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
      await adminPage.getByRole('button', { name: 'Personalakte anlegen' }).click();
      try {
        await waitForPersonnelSuggestionIntercept(intercepted);
      } catch (error) {
        throw new Error(
          'The personnel-number suggestion server action was not intercepted within 15 seconds.',
          { cause: error }
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
        { timeout: 15_000 }
      );
      releaseSuggestion();
      await suggestionResponse;
      await expect(dialog.locator('#personnel-number')).toHaveValue(employeeNumber, {
        timeout: 15_000,
      });
      await typeIntoDatePicker(dialog, 'Eintrittsdatum', toDatePickerDigits(entryDate));
      await dialog.locator('#personnel-notes').fill(note);
      await dialog.getByRole('button', { name: 'Personalakte anlegen', exact: true }).click();
      await adminPage.waitForURL(/\/mitarbeiter\/[0-9a-f-]{36}/, {
        timeout: 20_000,
      });
    } finally {
      releaseSuggestion();
      await adminPage.unroute('**/mitarbeiter');
    }

    const recordMatch = adminPage.url().match(/\/mitarbeiter\/([0-9a-f-]{36})/);
    if (!recordMatch) throw new Error('Could not read the A3 personnel record id.');
    a3PersonnelRecordId = recordMatch[1];

    await editPersonnelTextField(adminPage, 'Telefon', '030 300030');
    await editPersonnelTextField(adminPage, 'Private E-Mail', privateEmail);
    await editPersonnelTextField(adminPage, 'Straße', 'Personalweg 30');
    await editPersonnelTextField(adminPage, 'PLZ', '10115');
    await editPersonnelTextField(adminPage, 'Ort', 'Berlin');
    await editPersonnelTextField(adminPage, 'Notfallkontakt', 'Nina Notfall A3');
    await editPersonnelTextField(adminPage, 'Notfallkontakt Telefon', '030 300031');
    await editPersonnelDateField(adminPage, 'Austrittsdatum', exitDate);

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

    await adminPage.getByRole('button', { name: 'Kondition hinzufügen' }).click();
    const optionDialog = adminPage.getByRole('dialog');
    await optionDialog.locator('#condition-type').click();
    for (const employmentType of ['Vollzeit', 'Teilzeit', 'Ausbildung', 'Minijob', 'Sonstiges']) {
      await expect(
        adminPage.getByRole('option', { name: employmentType, exact: true })
      ).toBeVisible();
    }
    await adminPage.keyboard.press('Escape');
    await adminPage.keyboard.press('Escape');
    await expect(optionDialog).toHaveCount(0);

    await addConditionViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(conditionDate),
      employmentTypeLabel: 'Ausbildung',
      weeklyHours: '35',
      vacationDays: '28',
      note: conditionNote,
    });
    await expect(visibleText(adminPage, 'Geplant')).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(adminPage, 'Ausbildung')).toBeVisible();
    await expect(visibleText(adminPage, '35 Std./Woche')).toBeVisible();
    await expect(visibleText(adminPage, '28 Urlaubstage/Jahr')).toBeVisible();
    await expect(visibleText(adminPage, conditionNote)).toBeVisible();

    await editConditionWeeklyHours(adminPage, toGermanDate(conditionDate), '34');
    await adminPage.reload();
    await expect(visibleText(adminPage, 'Telefon: — → 030 300030')).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(adminPage, `Private E-Mail: — → ${privateEmail}`)).toBeVisible();
    await expect(visibleText(adminPage, 'Wochenstunden: 35 → 34')).toBeVisible();
    await expect(visibleText(adminPage, `Notiz: — → ${conditionNote}`)).toBeVisible();
    for (const createdValue of [
      `Personalnummer: — → ${employeeNumber}`,
      'Vorname: — → Alina',
      `Notizen: — → ${note}`,
    ]) {
      await expect(visibleText(adminPage, createdValue)).toBeVisible();
    }

    const deletedConditionDate = ownedBerlinDateAtOffset('a3-personal', 32);
    const deletedConditionNote = `A3 Minijob gelöscht ${world.runId}`;
    await addConditionViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(deletedConditionDate),
      employmentTypeLabel: 'Minijob',
      weeklyHours: '10',
      vacationDays: '12',
      note: deletedConditionNote,
    });
    const deletedConditionRow = adminPage
      .getByRole('listitem')
      .filter({ hasText: `Gültig ab ${toGermanDate(deletedConditionDate)}` })
      .filter({ visible: true });
    await expect(deletedConditionRow).toContainText('Minijob');
    await expect(deletedConditionRow).toContainText(deletedConditionNote);
    await deletedConditionRow
      .getByRole('button', {
        name: `Aktionen für Kondition vom ${toGermanDate(deletedConditionDate)}`,
      })
      .click();
    await adminPage.getByRole('menuitem', { name: 'Löschen' }).click();
    const deleteDialog = adminPage.getByRole('alertdialog');
    await deleteDialog.getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(deleteDialog).toHaveCount(0, { timeout: 15_000 });

    await adminPage.reload();
    await expect(visibleText(adminPage, 'Kondition gelöscht')).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(adminPage, 'Beschäftigungsart: Minijob → —')).toBeVisible();
    await expect(visibleText(adminPage, `Notiz: ${deletedConditionNote} → —`)).toBeVisible();

    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    for (const eventLabel of [
      'Personalakte angelegt',
      'Personalien geändert',
      'Kondition hinzugefügt',
      'Kondition geändert',
      'Kondition gelöscht',
    ]) {
      await expectHistoryAttribution(adminPage, eventLabel, adminName);
    }
    const eventStates = await getEmployeeRecordEventStates(world.orgId, recordMatch[1]);
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
      expect(Number.isNaN(Date.parse(event?.createdAt ?? ''))).toBe(false);
      expect(Object.keys(event?.eventPayload ?? {}).length).toBeGreaterThan(0);
    }

    await adminPage.goto('/mitarbeiter');
    await adminPage.getByRole('button', { name: 'Personalakte anlegen' }).click();
    const duplicateDialog = adminPage.getByRole('dialog');
    await duplicateDialog.locator('#personnel-last-name').fill(`Dora Doppel-A3-${world.runId}`);
    const duplicateNumberInput = duplicateDialog.locator('#personnel-number');
    await expect(duplicateNumberInput).toHaveValue(/^MA-\d+$/, {
      timeout: 15_000,
    });
    await duplicateNumberInput.fill(employeeNumber);
    await expect(duplicateNumberInput).toHaveValue(employeeNumber);
    await typeIntoDatePicker(duplicateDialog, 'Eintrittsdatum', toDatePickerDigits(entryDate));
    await duplicateDialog
      .getByRole('button', { name: 'Personalakte anlegen', exact: true })
      .click();
    await expect(
      duplicateDialog.getByText('Diese Personalnummer ist bereits vergeben.')
    ).toBeVisible({ timeout: 15_000 });
    await adminPage.keyboard.press('Escape');
    await expect(duplicateDialog).toBeHidden({ timeout: 15_000 });
    await adminPage.goto(`/mitarbeiter/${recordMatch[1]}`);
    await expect(visibleText(adminPage, employeeNumber)).toBeVisible();
  });

  test('A3-R01: Alle Personalzeilen zeigen Beschäftigungs- und Zugangsstatus vollständig', async ({
    adminPage,
    world,
  }) => {
    const personnelRecordId = requireChainedValue(a3PersonnelRecordId, {
      test: 'A3-R01',
      needs: 'the personnel record created by A3-01',
      grep: 'A3-01|A3-R01',
      suite: 'audit',
    });
    const plannedName = a3PersonnelName(world.runId);
    const activeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;

    await adminPage.goto('/mitarbeiter');
    const plannedRow = personnelRow(adminPage, plannedName);
    await expect(plannedRow.getByText('Geplant', { exact: true })).toBeVisible();
    await expect(plannedRow.getByText('Ohne Zugang', { exact: true })).toBeVisible();

    const activeRow = personnelRow(adminPage, activeName);
    await expect(activeRow.getByText('Aktiv', { exact: true })).toBeVisible();
    await expect(activeRow.getByText('Mit Zugang', { exact: true })).toBeVisible();

    await adminPage.goto(`/mitarbeiter/${personnelRecordId}`);
    await sendInviteFromPersonnelRecord(
      adminPage,
      `delivered+a3-${world.runId}@resend.dev`,
      'Handwerker/in'
    );
    await adminPage.goto('/mitarbeiter');
    await expect(
      personnelRow(adminPage, plannedName).getByText('Eingeladen', {
        exact: true,
      })
    ).toBeVisible();

    const exitedName = `Eva Ehemalig-A3-${world.runId}`;
    const exitedRecordId = await createPersonnelRecordViaDialog(adminPage, {
      firstName: 'Eva',
      lastName: `Ehemalig-A3-${world.runId}`,
      entryDateDigits: toDatePickerDigits(berlinDateAtOffset(-60)),
      employeeNumber: `MA-A3-E-${world.runId}`,
    });
    await editPersonnelDateField(adminPage, 'Austrittsdatum', berlinDateAtOffset(-1));
    await adminPage.goto('/mitarbeiter');
    const exitedRow = personnelRow(adminPage, exitedName);
    await expect(exitedRow.getByText('Ausgeschieden', { exact: true })).toBeVisible();
    await expect(exitedRow.getByText('Ohne Zugang', { exact: true })).toBeVisible();
    await expect(exitedRow).toContainText(`MA-A3-E-${world.runId}`);
    expect(exitedRecordId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('A3-06/A3-07: Betriebsruhe respektiert die Datumsgrenze; Feiertagswechsel bleibt historisch', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const personnelRecordId = requireChainedValue(a3PersonnelRecordId, {
      test: 'A3-06',
      needs: 'the personnel record created by A3-01',
      grep: 'A3-01|A3-06',
      suite: 'audit',
    });
    const today = berlinDateAtOffset(0);
    const pastDate = shiftIsoDate(today, -1);
    const closureDate = ownedBerlinDateAtOffset('a3-personal', 32);
    const bueroClosureDate = ownedBerlinDateAtOffset('a3-personal', 33);
    const bueroClosureLabel = `A3 Büro-Betriebsruhe ${world.runId}`;

    await addClosureDayViaSettings(adminPage, {
      dateDigits: toDatePickerDigits(closureDate),
      label: `A3 Betriebsruhe ${world.runId}`,
    });
    let context = await getTargetContextForRecord(world.orgId, personnelRecordId);
    expect(
      context.calendar.closureDays.some(
        (day) => day.closureDate === closureDate && day.label === `A3 Betriebsruhe ${world.runId}`
      )
    ).toBe(true);
    await removeClosureDayViaSettings(adminPage, toGermanDate(closureDate));
    context = await getTargetContextForRecord(world.orgId, personnelRecordId);
    expect(context.calendar.closureDays.some((day) => day.closureDate === closureDate)).toBe(false);

    await adminPage.goto('/einstellungen/zeiterfassung');
    await typeIntoDatePicker(
      adminPage.getByRole('main'),
      'Datum der Betriebsruhe',
      toDatePickerDigits(pastDate)
    );
    await adminPage.getByLabel('Bezeichnung (optional)').fill(`A3 Vergangenheit ${world.runId}`);
    await adminPage.getByRole('button', { name: 'Eintragen' }).click();
    await expect(
      visibleText(
        adminPage,
        'Vergangene Tage können nicht geändert werden – frühere Zeiträume behalten ihre damalige Bedeutung.'
      )
    ).toBeVisible({ timeout: 15_000 });

    await setHolidayRegionViaSettings(adminPage, 'Bayern (mit Mariä Himmelfahrt)');
    await setHolidayRegionViaSettings(adminPage, 'Bayern (ohne Mariä Himmelfahrt)');
    await setHolidayRegionViaSettings(adminPage, 'Berlin');
    await setHolidayRegionViaSettings(adminPage, 'Thüringen');

    await bueroPage.goto('/einstellungen/zeiterfassung');
    await expect(bueroPage.getByLabel('Bundesland')).toContainText('Thüringen');
    await expect(bueroPage.getByLabel('Bundesland')).toBeDisabled();
    await expect(
      bueroPage.getByRole('button', { name: 'Feiertagskalender speichern' })
    ).toBeDisabled();
    await addClosureDayViaSettings(bueroPage, {
      dateDigits: toDatePickerDigits(bueroClosureDate),
      label: bueroClosureLabel,
    });

    context = await getTargetContextForRecord(world.orgId, personnelRecordId);
    const a3History = context.calendar.holidayRegionHistory.slice(-2);
    expect(a3History.map((entry) => entry.region)).toEqual(['BE', 'TH']);
    expect(new Date(a3History[0].effectiveFrom).getTime()).toBeLessThanOrEqual(
      new Date(a3History[1].effectiveFrom).getTime()
    );
    const beforeFirstSelection = shiftIsoDate(toBerlinIsoDate(a3History[0].effectiveFrom), -1);
    expect(resolveHolidayRegionOnDate(context.calendar, beforeFirstSelection)).toBeNull();
    const currentYear = Number(today.slice(0, 4));
    const holidayYear = today <= `${currentYear}-09-20` ? currentYear : currentYear + 1;
    const holidayDate = `${holidayYear}-09-20`;
    expect(resolveHolidayRegionOnDate(context.calendar, holidayDate)).toBe('TH');
    expect(
      getHolidayContextDays(context.calendar, holidayYear, holidayYear).some(
        (holiday) => holiday.date === holidayDate && holiday.name === 'Weltkindertag'
      )
    ).toBe(true);

    expect(
      context.calendar.closureDays.some(
        (day) => day.closureDate === bueroClosureDate && day.label === bueroClosureLabel
      )
    ).toBe(true);

    await navigateMonthViewTo(adminPage, holidayDate);
    await expectInformationalCalendarEvent(adminPage, 'Weltkindertag');
    await navigateMonthViewTo(adminPage, bueroClosureDate);
    await expectInformationalCalendarEvent(adminPage, bueroClosureLabel);

    await removeClosureDayViaSettings(bueroPage, toGermanDate(bueroClosureDate));
    context = await getTargetContextForRecord(world.orgId, personnelRecordId);
    expect(context.calendar.closureDays.some((day) => day.closureDate === bueroClosureDate)).toBe(
      false
    );

    await setHolidayRegionViaSettings(adminPage, 'Kein Feiertagskalender');
    context = await getTargetContextForRecord(world.orgId, personnelRecordId);
    expect(context.calendar.holidayRegion).toBeNull();
    expect(context.calendar.holidayRegionHistory.at(-1)?.region).toBe('');
  });

  test('A3-R02: Arbeitszeitmodell steuert Ziel, Fortschritt, Überstunden und Listenwerte zugänglich', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // This same-test current-day state is transient and is not a cross-spec owned fixture.
    const today = berlinDateAtOffset(0);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const scheduleNote = `A3 Ein-Minuten-Modell ${world.runId}`;
    const completedTimeWindow = getCompletedBerlinTimeWindow();

    await openMemberDetailFromList(adminPage, employeeName);
    await addWorkScheduleViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(today),
      dayHours: ['0,02', '0,02', '0,02', '0,02', '0,02', '0,02', '0,02'],
      note: scheduleNote,
    });
    await expect(visibleText(adminPage, '7 Min. pro Woche')).toBeVisible({
      timeout: 15_000,
    });

    await createOwnManualTimeEntry(adminPage, {
      memberName: employeeName,
      dateDigits: toDatePickerDigits(today),
      clockInDigits: completedTimeWindow.clockInDigits,
      clockOutDigits: completedTimeWindow.clockOutDigits,
    });
    expect((await getLatestManualTimeEntryState(world.orgId, world.users.employee.id)).status).toBe(
      'approved'
    );

    await employeePage.goto('/zeiterfassung');
    await expect(visibleText(employeePage, 'Tagesziel: 1 Min. Arbeitszeit')).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, 'Gesamtzeit')).toBeVisible();
    const overtime = visibleText(employeePage, 'Überstunden heute').locator('..');
    await expect(overtime).not.toHaveText(/Überstunden heute\s*0 Min\.\s*$/);
    const mondayBasedDayIndex = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    const mondayIso = shiftIsoDate(today, -mondayBasedDayIndex);
    const targetContext = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    const expectedWeeklyMinutes = Array.from({ length: 7 }, (_, index) =>
        resolveDailyTarget({
          dateIso: shiftIsoDate(mondayIso, index),
          ...targetContext,
        })
      ).reduce((total, target) => total + target.targetMinutes, 0);
    await expect(
      visibleText(employeePage, `Soll: ${formatDuration(expectedWeeklyMinutes)}`)
    ).toBeVisible();

    await adminPage.goto('/mitarbeiter');
    const employeeRow = personnelRow(adminPage, employeeName);
    const progress = employeeRow.getByRole('progressbar', {
      name: 'Tagesfortschritt: 100%',
    });
    await expect(progress).toHaveAttribute('aria-valuenow', '100');
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    await expect(
      personnelRow(adminPage, bueroName).getByLabel('Kein Arbeitszeitmodell hinterlegt')
    ).toBeVisible();

    await addClosureDayViaSettings(adminPage, {
      dateDigits: toDatePickerDigits(today),
      label: `A3 Nullziel ${world.runId}`,
    });
    try {
      const context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
      expect(context.calendar.closureDays.some((day) => day.closureDate === today)).toBe(true);
      await adminPage.goto('/mitarbeiter');
      const zeroTargetProgress = personnelRow(adminPage, employeeName).getByRole('progressbar', {
        name: 'Tagesfortschritt: Betriebsruhe',
      });
      await expect(zeroTargetProgress).toHaveAttribute('aria-valuenow', '0');
      await employeePage.goto('/zeiterfassung');
      await expect(visibleText(employeePage, 'heute keine Sollarbeitszeit.')).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await removeClosureDayViaSettings(adminPage, toGermanDate(today));
    }

    await deleteWorkBlockViaCalendar(adminPage, completedTimeWindow.calendarTitle);
    await openMemberDetailFromList(adminPage, employeeName);
    await deleteWorkScheduleViaDetail(adminPage, today, scheduleNote);
    const cleanedContext = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    expect(
      cleanedContext.schedules.some(
        (schedule) => schedule.validFrom === today && schedule.note === scheduleNote
      )
    ).toBe(false);
  });

  test('A3-11: Betroffene sehen eigene Vertretung und Manager die Personenzusammenfassung', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const today = berlinDateAtOffset(0);
    const yesterdayDigits = toDatePickerDigits(shiftIsoDate(today, -1));
    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const [adminRecord, employeeRecord] = await Promise.all([
      getEmployeeRecordStateByUser(world.orgId, world.users.admin.id),
      getEmployeeRecordStateByUser(world.orgId, world.users.employee.id),
    ]);

    for (const responsibility of ['time_approval', 'leave_approval'] as const) {
      await previewResponsibilityChange(adminPage, { responsibility });
      await confirmResponsibilityPreview(adminPage);
    }

    await previewResponsibilityChange(adminPage, {
      responsibility: 'time_approval',
      selectedNames: [employeeName],
    });
    await confirmResponsibilityPreview(adminPage);
    let configuration = await getLatestResponsibilityConfigurationState(
      world.orgId,
      'time_approval'
    );
    expect(configuration.mode).toBe('selected');
    expect(configuration.holderEmployeeRecordIds).toEqual([employeeRecord.id]);

    await employeePage.goto('/einstellungen/mitarbeiter');
    await expect(visibleText(employeePage, 'Zeitfreigaben')).toBeVisible({
      timeout: 15_000,
    });
    await expect(employeePage.getByRole('button', { name: 'Verantwortung ändern' })).toHaveCount(0);
    await expect(employeePage.getByRole('button', { name: 'Vertretung eintragen' })).toHaveCount(0);
    await expect(employeePage.getByTestId('responsibility-time_approval')).toHaveCount(0);

    await previewResponsibilityChange(adminPage, {
      responsibility: 'time_approval',
    });
    await confirmResponsibilityPreview(adminPage);
    await previewResponsibilityChange(adminPage, {
      responsibility: 'leave_approval',
      selectedNames: [adminName],
    });
    await confirmResponsibilityPreview(adminPage);

    configuration = await getLatestResponsibilityConfigurationState(world.orgId, 'time_approval');
    expect(configuration.mode).toBe('role_default');
    configuration = await getLatestResponsibilityConfigurationState(world.orgId, 'leave_approval');
    expect(configuration.mode).toBe('selected');
    expect(configuration.holderEmployeeRecordIds).toEqual([adminRecord.id]);

    await bueroPage.goto('/einstellungen/mitarbeiter');
    await expect(bueroPage.getByTestId('responsibility-time_approval')).toContainText(
      'Standardrollen'
    );
    await expect(bueroPage.getByTestId('responsibility-leave_approval')).toContainText(
      'Bestimmte Personen'
    );
    await expect(bueroPage.getByRole('button', { name: 'Verantwortung ändern' })).toHaveCount(0);
    await expect(bueroPage.getByRole('button', { name: 'Vertretung eintragen' })).toHaveCount(0);
    for (const responsibility of ['time_approval', 'leave_approval'] as const) {
      await expect(bueroPage.getByTestId(`responsibility-${responsibility}`)).toContainText(
        'Du kannst die Regel einsehen. Nur der Admin kann sie ändern.'
      );
    }

    await createResponsibilityDelegationViaSettings(adminPage, {
      responsibility: 'leave_approval',
      delegatorName: adminName,
      substituteName: employeeName,
      validFromDigits: toDatePickerDigits(today),
      validUntilDigits: toDatePickerDigits(shiftIsoDate(today, 30)),
    });

    await employeePage.goto('/einstellungen/mitarbeiter');
    await expect(
      visibleText(employeePage, 'Meine Verantwortlichkeiten und Vertretungen')
    ).toBeVisible({ timeout: 15_000 });
    await expect(visibleText(employeePage, `Vertretung für ${adminName}`)).toBeVisible();
    await expect(visibleText(employeePage, 'Vertretung bis')).toBeVisible();

    await createOwnManualTimeEntry(adminPage, {
      memberName: adminName,
      dateDigits: yesterdayDigits,
      clockInDigits: '0010',
      clockOutDigits: '0020',
    });
    expect((await getLatestManualTimeEntryState(world.orgId, world.users.admin.id)).status).toBe(
      'approved'
    );

    await createOwnManualTimeEntry(bueroPage, {
      memberName: bueroName,
      dateDigits: yesterdayDigits,
      clockInDigits: '0030',
      clockOutDigits: '0040',
    });
    expect((await getLatestManualTimeEntryState(world.orgId, world.users.buero.id)).status).toBe(
      'pending'
    );
    await expectTimeApprovalsUnavailable(employeePage);
    await openTimeApprovals(bueroPage);
    await expectPendingTimeApprovalHidden(bueroPage, world.users.buero.id);
    await openTimeApprovals(adminPage);
    await expectPendingTimeApprovalVisible(adminPage, world.users.buero.id);
    await approvePendingTimeEntry(adminPage, world.users.buero.id);
    expect((await getLatestManualTimeEntryState(world.orgId, world.users.buero.id)).status).toBe(
      'approved'
    );

    for (const managerPage of [adminPage, bueroPage]) {
      await managerPage.goto('/einstellungen/mitarbeiter');
      await expect(
        visibleText(managerPage, 'Meine Verantwortlichkeiten und Vertretungen')
      ).toBeVisible({ timeout: 15_000 });
      await expect(visibleText(managerPage, 'Aktuell verantwortlich')).toBeVisible();
    }

    await openMemberDetailFromList(adminPage, employeeName);
    const summary = adminPage
      .getByRole('heading', { name: 'Verantwortlichkeiten & Vertretung' })
      .locator('xpath=ancestor::section');
    await expect(summary).toBeVisible();
    await expect(summary.getByText('Urlaubsfreigaben', { exact: true })).toBeVisible();
    await expect(summary.getByText('1 Vertretung', { exact: true })).toBeVisible();

    await endResponsibilityDelegationViaSettings(adminPage, 'leave_approval', employeeName);
    await employeePage.goto('/einstellungen/mitarbeiter');
    await expect(
      visibleText(employeePage, 'Meine Verantwortlichkeiten und Vertretungen')
    ).toBeVisible({ timeout: 15_000 });
    await expect(visibleText(employeePage, 'Nicht verantwortlich')).toBeVisible();
    await expect(visibleText(employeePage, `Vertretung für ${adminName}`)).toBeVisible();

    await previewResponsibilityChange(adminPage, {
      responsibility: 'leave_approval',
    });
    await confirmResponsibilityPreview(adminPage);
    for (const responsibility of ['time_approval', 'leave_approval'] as const) {
      expect(
        (await getLatestResponsibilityConfigurationState(world.orgId, responsibility)).mode
      ).toBe('role_default');
    }
  });
});
