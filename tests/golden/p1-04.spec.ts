import { expect, test } from './support/fixtures';
import { getHolidayName } from '../../lib/personnel/holidays';
import { resolveDailyTarget } from '../../lib/personnel/targets';
import {
  getEmployeeRecordStateByUser,
  getTargetContextForRecord,
  getVisibleWorkScheduleRecordIdsAs,
} from './support/db';
import {
  addClosureDayViaSettings,
  addWorkScheduleViaDialog,
  expectVisibleAfterSave,
  openMemberDetailFromList,
  removeClosureDayViaSettings,
  setHolidayRegionViaSettings,
  visibleText,
  textInDom,
} from './support/steps';

// P1-04 — Date-effective work schedules and regional holiday/closure context
// (@P1-04). Bounded outcome: authorized users define schedules and the
// holiday/closure calendar; calendar context and time targets use them instead
// of the fixed eight-hour assumption. Historical days keep the schedule
// version effective then; missing configuration is a visible exception, never
// a silent 8h day. Pure target math (incl. historical/holiday cases) is
// additionally covered by `bun run test:unit`.

test.describe.configure({ mode: 'serial' });

// Business dates are Europe/Berlin dates (sv-SE formats as YYYY-MM-DD).
function berlinTodayIso(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Monday-first weekday index of an ISO date (0 = Montag … 6 = Sonntag).
function weekdayIndex(dateIso: string): number {
  const [year, month, day] = dateIso.split('-').map(Number);
  const jsWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsWeekday === 0 ? 6 : jsWeekday - 1;
}

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

// ddmmyyyy digits for the segmented DatePicker.
function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

function toGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

// Monday of the previous week: always strictly before today, so a second
// version valid from today never collides with it.
function previousMondayIso(): string {
  const todayIso = berlinTodayIso();
  return shiftIsoDate(todayIso, -(weekdayIndex(todayIso) + 7));
}

// Expected weekly Soll (hours) for Mo–Fr plans: the first test selects the
// Bavarian calendar effective from today, so a Bavarian holiday on today or a
// later weekday zeroes that day's target — the expectation must mirror the
// same in-code dataset the app uses or the suite would fail in holiday weeks.
function expectedWeeklyHours(hoursBeforeToday: number, hoursFromToday: number): number {
  const todayIso = berlinTodayIso();
  const weekStartIso = shiftIsoDate(todayIso, -weekdayIndex(todayIso));
  let total = 0;
  for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
    const dayIso = shiftIsoDate(weekStartIso, dayOffset);
    if (dayIso >= todayIso && getHolidayName('BY', dayIso) !== null) continue;
    total += dayIso < todayIso ? hoursBeforeToday : hoursFromToday;
  }
  return total;
}

test.describe('P1-04 Arbeitszeitmodelle und Feiertage @P1-04', () => {
  test('Admin wählt den Feiertagskalender, Büro sieht ihn nur', async ({
    adminPage,
    bueroPage,
  }) => {
    await setHolidayRegionViaSettings(adminPage, 'Bayern (mit Mariä Himmelfahrt)');

    // Büro sees the selection but cannot change it (admin-only policy).
    await bueroPage.goto('/einstellungen/zeiterfassung');
    await expect(bueroPage.getByLabel('Bundesland')).toContainText(
      'Bayern (mit Mariä Himmelfahrt)',
      { timeout: 15_000 }
    );
    await expect(bueroPage.getByLabel('Bundesland')).toBeDisabled();
    await expect(
      bueroPage.getByRole('button', { name: 'Feiertagskalender speichern' })
    ).toBeDisabled();
  });

  test('Vollzeit-Wochenplan: Ziel kommt aus dem Plan, Abweichung vom Vertrag ist sichtbar', async ({
    adminPage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await openMemberDetailFromList(adminPage, employeeName);

    // Valid from last week's Monday so the whole current week is covered.
    await addWorkScheduleViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(previousMondayIso()),
    });

    await expectVisibleAfterSave(adminPage, '40 Std. pro Woche');
    const currentSchedule = adminPage
      .getByRole('listitem')
      .filter({ hasText: '40 Std. pro Woche' });
    await expect(currentSchedule.getByText('Aktuell', { exact: true })).toBeVisible();

    // P1-03 stored 25 contractual weekly hours for this employee; the
    // schedule wins for targets and the mismatch stays a visible hint.
    await expect(visibleText(adminPage, 'Für Zeitziele gilt der Wochenplan.')).toBeVisible();

    // The change is auditable like every other personnel change.
    await expect(visibleText(adminPage, 'Wochenplan hinzugefügt')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Handwerker sieht das eigene Wochenziel statt der 8-Stunden-Annahme', async ({
    employeePage,
  }) => {
    await employeePage.goto('/zeiterfassung');
    await expectVisibleAfterSave(employeePage, `Soll: ${expectedWeeklyHours(8, 8)} Std.`);
    // With a real schedule there is no unconfigured warning.
    await expect(textInDom(employeePage, 'Kein Arbeitszeitmodell hinterlegt')).toHaveCount(0);
  });

  test('Teilzeit-Wochenplan erzeugt ein anderes Wochenziel', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    await openMemberDetailFromList(adminPage, bueroName);
    await addWorkScheduleViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(previousMondayIso()),
      dayHours: ['4', '4', '4', '4', '4', '0', '0'],
      note: 'Teilzeit vormittags',
    });
    await expectVisibleAfterSave(adminPage, '20 Std. pro Woche');

    // The part-time member sees their own different weekly target.
    await bueroPage.goto('/zeiterfassung');
    await expectVisibleAfterSave(bueroPage, `Soll: ${expectedWeeklyHours(4, 4)} Std.`);
  });

  test('Änderung ab heute: frühere Tage behalten das alte Ziel', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await openMemberDetailFromList(adminPage, employeeName);

    // Second version effective today: 6h Montag–Freitag.
    await addWorkScheduleViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(berlinTodayIso()),
      dayHours: ['6', '6', '6', '6', '6', '0', '0'],
    });
    await expectVisibleAfterSave(adminPage, '30 Std. pro Woche');
    // Both versions stay visible and distinguishable.
    const currentSchedule = adminPage
      .getByRole('listitem')
      .filter({ hasText: '30 Std. pro Woche' });
    await expect(currentSchedule.getByText('Aktuell', { exact: true })).toBeVisible();
    const historicalSchedule = adminPage
      .getByRole('listitem')
      .filter({ hasText: '40 Std. pro Woche' });
    await expect(historicalSchedule.getByText('Früher', { exact: true })).toBeVisible();

    // The week's target mixes both versions: weekdays before today keep the
    // old 8h target, today and later use 6h (holiday-aware). On a weekend run
    // the whole Mo–Fr week already lies in the past and stays at 40.
    await employeePage.goto('/zeiterfassung');
    await expectVisibleAfterSave(employeePage, `Soll: ${expectedWeeklyHours(8, 6)} Std.`);
  });

  test('Feiertag des gewählten Kalenders erscheint im Kalender-Monat', async ({ adminPage }) => {
    await adminPage.goto('/kalender');
    await adminPage.getByRole('tab', { name: 'Monat' }).click();

    // Navigate to next year's January: always in the future (holidays apply
    // only from the region selection onward) and Neujahr exists everywhere.
    const currentMonth = Number(berlinTodayIso().slice(5, 7)) - 1;
    const clicksToNextJanuary = 12 - currentMonth;
    for (let i = 0; i < clicksToNextJanuary; i++) {
      await adminPage.getByRole('button', { name: 'Weiter' }).click();
    }

    await expect(visibleText(adminPage, 'Neujahr')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Betriebsruhe heute wird gespeichert und setzt das Tagesziel auf null', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const todayIso = berlinTodayIso();
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const contextBeforeClosure = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    const targetBeforeClosure = resolveDailyTarget({
      dateIso: todayIso,
      ...contextBeforeClosure,
    });
    await addClosureDayViaSettings(adminPage, {
      dateDigits: toDatePickerDigits(todayIso),
      label: 'Inventur',
    });

    await employeePage.goto('/zeiterfassung');
    if (targetBeforeClosure.targetMinutes > 0) {
      await expectVisibleAfterSave(employeePage, 'Betriebsruhe');
    }
    await expect(visibleText(employeePage, 'heute keine Sollarbeitszeit.')).toBeVisible();

    // Removing a today/future closure day is allowed; the day returns to its
    // schedule truth. That truth is weekday-dependent (a weekend run has no
    // target to return to), so the expected text is computed from the same
    // stored state and resolver the app uses — never assumed.
    await removeClosureDayViaSettings(adminPage, toGermanDate(todayIso));
    const context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
    const todayTarget = resolveDailyTarget({ dateIso: todayIso, ...context });
    await employeePage.goto('/zeiterfassung');
    await expectVisibleAfterSave(
      employeePage,
      todayTarget.isHoliday
        ? `Feiertag: ${todayTarget.holidayName}`
        : todayTarget.targetMinutes > 0
          ? 'Tagesziel:'
          : 'Laut Arbeitszeitmodell heute kein Arbeitstag.'
    );
    await expect(textInDom(employeePage, 'Betriebsruhe')).toHaveCount(0);
  });

  test('Ohne Wochenplan ist das 8-Stunden-Ziel eine sichtbare Ausnahme', async ({
    adminPage,
    world,
  }) => {
    // Nora joined during @P1-03 and has neither schedule nor weekly hours.
    const noraName = `${world.personnelInvitee.firstName} ${world.personnelInvitee.lastName}`;
    await openMemberDetailFromList(adminPage, noraName);

    await expect(
      visibleText(adminPage, 'Kein Arbeitszeitmodell hinterlegt – Standardziel 8 Stunden.')
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      visibleText(adminPage, 'Kein Arbeitszeitmodell hinterlegt. Ohne Wochenplan gilt')
    ).toBeVisible();
  });

  test('Handwerker erreicht keine Verwaltung und sieht nur den eigenen Plan', async ({
    employeePage,
    world,
  }) => {
    // The settings surface is read-only for employees: no region editing, no
    // closure-day form.
    await employeePage.goto('/einstellungen/zeiterfassung');
    await expect(employeePage.getByLabel('Bundesland')).toBeDisabled();
    await expect(
      employeePage.getByRole('button', { name: 'Feiertagskalender speichern' })
    ).toBeDisabled();
    await expect(employeePage.getByRole('button', { name: 'Eintragen' })).toHaveCount(0);

    // RLS: the employee sees exactly their own schedule rows — never the
    // Büro member's — while the org outsider sees none at all.
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const visibleToEmployee = await getVisibleWorkScheduleRecordIdsAs(
      world.users.employee,
      world.orgId
    );
    expect(visibleToEmployee).toEqual([employeeRecord.id]);

    const visibleToOutsider = await getVisibleWorkScheduleRecordIdsAs(
      world.outsider.admin,
      world.orgId
    );
    expect(visibleToOutsider).toEqual([]);
  });
});
