import {
  getHolidayContextDays,
  resolveHolidayRegionOnDate,
} from '../../../lib/personnel/targets';
import { expect, test } from '../../golden/support/fixtures';
import { getTargetContextForRecord } from '../../golden/support/db';
import {
  addClosureDayViaSettings,
  addConditionViaDialog,
  confirmResponsibilityPreview,
  createResponsibilityDelegationViaSettings,
  editConditionWeeklyHours,
  editPersonnelTextField,
  endResponsibilityDelegationViaSettings,
  openMemberDetailFromList,
  previewResponsibilityChange,
  removeClosureDayViaSettings,
  setHolidayRegionViaSettings,
  typeIntoDatePicker,
  visibleText,
} from '../../golden/support/steps';

test.describe.configure({ mode: 'serial' });

let a3PersonnelRecordId = '';

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

function requireA3PersonnelRecordId(): string {
  if (!a3PersonnelRecordId) {
    throw new Error('The serial A3 personnel journey did not create its record.');
  }
  return a3PersonnelRecordId;
}

async function editPersonnelDateField(
  page: import('@playwright/test').Page,
  fieldLabel: string,
  dateIso: string
): Promise<void> {
  await page
    .getByRole('button', { name: `${fieldLabel} bearbeiten`, exact: true })
    .click();
  await typeIntoDatePicker(
    page.locator('body'),
    'Datum',
    toDatePickerDigits(dateIso),
    10
  );
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(visibleText(page, toGermanDate(dateIso))).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('Wave 1 Audit A3 Personal @AUDIT-W1-A3', () => {
  test('A3-01/A3-03: Vollständige Personalakte, geplante Kondition und nachvollziehbare Werte', async ({
    adminPage,
    world,
  }) => {
    test.setTimeout(300_000);
    const entryDate = shiftIsoDate(berlinTodayIso(), 30);
    const conditionDate = shiftIsoDate(berlinTodayIso(), 31);
    const exitDate = shiftIsoDate(berlinTodayIso(), 34);
    const fullName = `Alina Personal-A3-${world.runId}`;
    const employeeNumber = `MA-A3-${world.runId}`;
    const privateEmail = `a3-personal-${world.runId}@werkflow-golden.test`;
    const note = `A3 Personalakte ${world.runId}`;
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
      if (
        !held &&
        request.method() === 'POST' &&
        Boolean(request.headers()['next-action'])
      ) {
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
        await Promise.race([
          intercepted,
          adminPage.waitForTimeout(15_000).then(() => {
            throw new Error('Route handler did not observe the request.');
          }),
        ]);
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
      await typeIntoDatePicker(
        dialog,
        'Eintrittsdatum',
        toDatePickerDigits(entryDate)
      );
      await dialog.locator('#personnel-notes').fill(note);
      await dialog
        .getByRole('button', { name: 'Personalakte anlegen', exact: true })
        .click();
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
    await editPersonnelTextField(
      adminPage,
      'Notfallkontakt Telefon',
      '030 300031'
    );
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

    await addConditionViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(conditionDate),
      employmentTypeLabel: 'Ausbildung',
      weeklyHours: '35',
      vacationDays: '28',
      note: `A3 Kondition ${world.runId}`,
    });
    await expect(
      adminPage.getByText('Geplant', { exact: true }).filter({ visible: true }).first()
    ).toBeVisible({ timeout: 15_000 });
    await expect(visibleText(adminPage, 'Ausbildung')).toBeVisible();
    await expect(visibleText(adminPage, '35 Std./Woche')).toBeVisible();
    await expect(visibleText(adminPage, '28 Urlaubstage/Jahr')).toBeVisible();

    await editConditionWeeklyHours(
      adminPage,
      toGermanDate(conditionDate),
      '34'
    );
    await adminPage.reload();
    await expect(visibleText(adminPage, 'Telefon: — → 030 300030')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      visibleText(adminPage, `Private E-Mail: — → ${privateEmail}`)
    ).toBeVisible();
    await expect(visibleText(adminPage, 'Wochenstunden: 35 → 34')).toBeVisible();

    await adminPage.goto('/mitarbeiter');
    await adminPage.getByRole('button', { name: 'Personalakte anlegen' }).click();
    const duplicateDialog = adminPage.getByRole('dialog');
    await duplicateDialog
      .locator('#personnel-last-name')
      .fill(`Dora Doppel-A3-${world.runId}`);
    await duplicateDialog.locator('#personnel-number').fill(employeeNumber);
    await typeIntoDatePicker(
      duplicateDialog,
      'Eintrittsdatum',
      toDatePickerDigits(entryDate)
    );
    await duplicateDialog
      .getByRole('button', { name: 'Personalakte anlegen', exact: true })
      .click();
    await expect(
      duplicateDialog.getByText('Diese Personalnummer ist bereits vergeben.')
    ).toBeVisible({ timeout: 15_000 });
    await adminPage.keyboard.press('Escape');
    await expect(duplicateDialog).toBeHidden({ timeout: 15_000 });
    await adminPage.goto(`/mitarbeiter/${a3PersonnelRecordId}`);
    await expect(visibleText(adminPage, employeeNumber)).toBeVisible();
  });

  test('A3-06/A3-07: Betriebsruhe respektiert die Datumsgrenze; Feiertagswechsel bleibt historisch', async ({
    adminPage,
    world,
  }) => {
    const today = berlinTodayIso();
    const pastDate = shiftIsoDate(today, -1);
    const closureDate = shiftIsoDate(today, 32);
    const personnelRecordId = requireA3PersonnelRecordId();

    await addClosureDayViaSettings(adminPage, {
      dateDigits: toDatePickerDigits(closureDate),
      label: `A3 Betriebsruhe ${world.runId}`,
    });
    let context = await getTargetContextForRecord(
      world.orgId,
      personnelRecordId
    );
    expect(
      context.calendar.closureDays.some(
        (day) =>
          day.closureDate === closureDate &&
          day.label === `A3 Betriebsruhe ${world.runId}`
      )
    ).toBe(true);
    await removeClosureDayViaSettings(adminPage, toGermanDate(closureDate));
    context = await getTargetContextForRecord(world.orgId, personnelRecordId);
    expect(
      context.calendar.closureDays.some((day) => day.closureDate === closureDate)
    ).toBe(false);

    await adminPage.goto('/einstellungen/zeiterfassung');
    await typeIntoDatePicker(
      adminPage.locator('body'),
      'Datum der Betriebsruhe',
      toDatePickerDigits(pastDate)
    );
    await adminPage.locator('#closure-label').fill(`A3 Vergangenheit ${world.runId}`);
    await adminPage.getByRole('button', { name: 'Eintragen' }).click();
    await expect(
      adminPage.getByText(
        'Vergangene Tage können nicht geändert werden – frühere Zeiträume behalten ihre damalige Bedeutung.'
      )
    ).toBeVisible({ timeout: 15_000 });

    await setHolidayRegionViaSettings(adminPage, 'Berlin');
    await setHolidayRegionViaSettings(adminPage, 'Thüringen');
    context = await getTargetContextForRecord(world.orgId, personnelRecordId);
    const a3History = context.calendar.holidayRegionHistory.slice(-2);
    expect(a3History.map((entry) => entry.region)).toEqual(['BE', 'TH']);
    expect(
      new Date(a3History[0].effectiveFrom).getTime()
    ).toBeLessThanOrEqual(new Date(a3History[1].effectiveFrom).getTime());
    const beforeFirstSelection = shiftIsoDate(
      toBerlinIsoDate(a3History[0].effectiveFrom),
      -1
    );
    expect(
      resolveHolidayRegionOnDate(context.calendar, beforeFirstSelection)
    ).toBeNull();
    expect(resolveHolidayRegionOnDate(context.calendar, '2026-09-20')).toBe('TH');
    expect(
      getHolidayContextDays(context.calendar, 2026, 2026).some(
        (holiday) =>
          holiday.date === '2026-09-20' && holiday.name === 'Weltkindertag'
      )
    ).toBe(true);

    await adminPage.goto('/kalender');
    await adminPage.getByRole('tab', { name: 'Monat' }).click();
    const [currentYear, currentMonth] = today.slice(0, 7).split('-').map(Number);
    const monthDifference = 2026 * 12 + 8 - (currentYear * 12 + currentMonth - 1);
    const navigationButton = monthDifference >= 0 ? 'Weiter' : 'Zurück';
    for (let index = 0; index < Math.abs(monthDifference); index += 1) {
      await adminPage.getByRole('button', { name: navigationButton }).click();
    }
    await expect(visibleText(adminPage, 'Weltkindertag')).toBeVisible({
      timeout: 15_000,
    });

    await setHolidayRegionViaSettings(adminPage, 'Kein Feiertagskalender');
    context = await getTargetContextForRecord(world.orgId, personnelRecordId);
    expect(context.calendar.holidayRegion).toBeNull();
    expect(context.calendar.holidayRegionHistory.at(-1)?.region).toBe('');
  });

  test('A3-11: Betroffene sehen eigene Vertretung und Manager die Personenzusammenfassung', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const today = berlinTodayIso();
    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;

    for (const responsibility of ['time_approval', 'leave_approval'] as const) {
      await previewResponsibilityChange(adminPage, { responsibility });
      await confirmResponsibilityPreview(adminPage);
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
    await expect(
      visibleText(employeePage, `Vertretung für ${adminName}`)
    ).toBeVisible();
    await expect(visibleText(employeePage, 'Vertretung bis')).toBeVisible();

    for (const managerPage of [adminPage, bueroPage]) {
      await managerPage.goto('/einstellungen/mitarbeiter');
      await expect(
        visibleText(managerPage, 'Meine Verantwortlichkeiten und Vertretungen')
      ).toBeVisible({ timeout: 15_000 });
      await expect(visibleText(managerPage, 'Aktuell verantwortlich')).toBeVisible();
    }

    await openMemberDetailFromList(adminPage, employeeName);
    const summary = adminPage.locator('section').filter({
      has: adminPage.getByRole('heading', {
        name: 'Verantwortlichkeiten & Vertretung',
      }),
    });
    await expect(summary).toBeVisible();
    await expect(summary.getByText('Urlaubsfreigaben', { exact: true })).toBeVisible();
    await expect(summary.getByText('1 Vertretung', { exact: true })).toBeVisible();

    await endResponsibilityDelegationViaSettings(
      adminPage,
      'leave_approval',
      employeeName
    );
    await employeePage.reload();
    await expect(
      visibleText(employeePage, 'Meine Verantwortlichkeiten und Vertretungen')
    ).toBeVisible({ timeout: 15_000 });
    await expect(visibleText(employeePage, 'Nicht verantwortlich')).toBeVisible();
    await expect(
      visibleText(employeePage, `Vertretung für ${adminName}`)
    ).toBeVisible();
  });
});
