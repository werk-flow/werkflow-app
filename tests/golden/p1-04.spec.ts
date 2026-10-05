import { prepareScheduleScenario } from './support/schedule-fixture';
import { expect, test } from './support/fixtures';
import { HOLIDAY_REGION_LABELS, getHolidayName } from '../../lib/personnel/holidays';
import { resolveDailyTarget } from '../../lib/personnel/targets';
import { getEmployeeRecordStateByUser } from './support/db/personnel';
import { getTargetContextForRecord } from './support/db/vacation';
import {
  PERSONNEL_COPY,
  PERSONNEL_HISTORY_EVENTS,
  TARGET_COPY,
  addClosureDayViaSettings,
  addWorkScheduleViaDialog,
  closureDaySubmitButton,
  holidayRegionSelect,
  holidayTargetText,
  openMemberDetailFromList,
  removeClosureDayViaSettings,
  saveHolidayRegionButton,
  setHolidayRegionViaSettings,
  versionBadge,
  weeklyScheduleText,
  weeklyTargetHoursText,
} from './support/steps/personnel';
import { expectVisibleAfterSave, visibleText, textInDom } from './support/steps/shared';
import { showCalendarMonth } from './support/steps/calendar';

// P1-04 — Date-effective work schedules and regional holiday/closure context
// (@P1-04). Bounded outcome: authorized users define schedules and the
// holiday/closure calendar; calendar context and time targets use them instead
// of the fixed eight-hour assumption. Historical days keep the schedule
// version effective then; missing configuration is a visible exception, never
// a silent 8h day. Pure target math (incl. historical/holiday cases) is
// additionally covered by `bun run test:unit`.

// Monday-first weekday index of an ISO date (0 = Montag … 6 = Sonntag).
function weekdayIndex(dateIso: string): number {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined)
    throw new Error(`Invalid ISO date: ${dateIso}`);
  const jsWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsWeekday === 0 ? 6 : jsWeekday - 1;
}

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined)
    throw new Error(`Invalid ISO date: ${dateIso}`);
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
function previousMondayIso(todayIso: string): string {
  return shiftIsoDate(todayIso, -(weekdayIndex(todayIso) + 7));
}

// Expected weekly Soll (hours) for Mo–Fr plans: the schedule fixture selects
// the Bavarian calendar effective from today, so a Bavarian holiday on today or
// a later weekday zeroes that day's target — the expectation must mirror the
// same in-code dataset the app uses or the suite would fail in holiday weeks.
function expectedWeeklyHours(todayIso: string, hoursBeforeToday: number, hoursFromToday: number): number {
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
  test('Admin wählt den Feiertagskalender, Büro sieht ihn nur und der Feiertag erscheint im Kalender-Monat', async ({
    adminPage,
    bueroPage,
    businessDate,
    world,
  }) => {
    await prepareScheduleScenario(world, {
      today: businessDate,
      previousMonday: previousMondayIso(businessDate),
      holidayRegion: null,
    });
    await setHolidayRegionViaSettings(adminPage, HOLIDAY_REGION_LABELS.BY);

    // Büro sees the selection but cannot change it (admin-only policy).
    await bueroPage.goto('/einstellungen/zeiterfassung');
    await expect(holidayRegionSelect(bueroPage)).toContainText(HOLIDAY_REGION_LABELS.BY, {
      timeout: 15_000,
    });
    await expect(holidayRegionSelect(bueroPage)).toBeDisabled();
    await expect(saveHolidayRegionButton(bueroPage)).toBeDisabled();

    // Navigate to next year's January: always in the future (holidays apply
    // only from the region selection onward) and Neujahr exists everywhere.
    const currentMonth = Number(businessDate.slice(5, 7)) - 1;
    await showCalendarMonth(adminPage, 12 - currentMonth);
    const newYearsDay = getHolidayName('BY', `${Number(businessDate.slice(0, 4)) + 1}-01-01`);
    if (!newYearsDay) throw new Error('P1-04: the Bavarian calendar has no New Year holiday');
    await expect(visibleText(adminPage, newYearsDay)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Vollzeit-Wochenplan: Ziel kommt aus dem Plan, Abweichung vom Vertrag ist sichtbar', async ({
    adminPage,
    businessDate,
    world,
  }) => {
    await prepareScheduleScenario(world, {
      today: businessDate,
      previousMonday: previousMondayIso(businessDate),
      employeeSchedule: false,
    });
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await openMemberDetailFromList(adminPage, employeeName);

    // Valid from last week's Monday so the whole current week is covered.
    await addWorkScheduleViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(previousMondayIso(businessDate)),
    });

    await expectVisibleAfterSave(adminPage, weeklyScheduleText({ hours: 40 }));
    const currentSchedule = adminPage
      .getByRole('listitem')
      .filter({ hasText: weeklyScheduleText({ hours: 40 }) });
    await expect(versionBadge(currentSchedule, 'current')).toBeVisible();

    // The fixture supplies 25 contractual weekly hours for this employee; the
    // schedule wins for targets and the mismatch stays a visible hint.
    await expect(visibleText(adminPage, PERSONNEL_COPY.scheduleWins)).toBeVisible();

    // The change is auditable like every other personnel change.
    await expect(visibleText(adminPage, PERSONNEL_HISTORY_EVENTS.schedule_added)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Teilzeit-Wochenplan erzeugt ein anderes Wochenziel', async ({
    adminPage,
    bueroPage,
    businessDate,
    world,
  }) => {
    await prepareScheduleScenario(world, {
      today: businessDate,
      previousMonday: previousMondayIso(businessDate),
    });
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    await openMemberDetailFromList(adminPage, bueroName);
    await addWorkScheduleViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(previousMondayIso(businessDate)),
      dayHours: ['4', '4', '4', '4', '4', '0', '0'],
      note: 'Teilzeit vormittags',
    });
    await expectVisibleAfterSave(adminPage, weeklyScheduleText({ hours: 20 }));

    // The part-time member sees their own different weekly target.
    await bueroPage.goto('/zeiterfassung');
    await expectVisibleAfterSave(bueroPage, weeklyTargetHoursText(expectedWeeklyHours(businessDate, 4, 4)));
  });

  test('Änderung ab heute: frühere Tage behalten das alte Ziel', async ({
    adminPage,
    businessDate,
    employeePage,
    world,
  }) => {
    await prepareScheduleScenario(world, {
      today: businessDate,
      previousMonday: previousMondayIso(businessDate),
    });
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await openMemberDetailFromList(adminPage, employeeName);

    // Second version effective today: 6h Montag–Freitag.
    await addWorkScheduleViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(businessDate),
      dayHours: ['6', '6', '6', '6', '6', '0', '0'],
    });
    await expectVisibleAfterSave(adminPage, weeklyScheduleText({ hours: 30 }));
    // Both versions stay visible and distinguishable.
    const currentSchedule = adminPage
      .getByRole('listitem')
      .filter({ hasText: weeklyScheduleText({ hours: 30 }) });
    await expect(versionBadge(currentSchedule, 'current')).toBeVisible();
    const historicalSchedule = adminPage
      .getByRole('listitem')
      .filter({ hasText: weeklyScheduleText({ hours: 40 }) });
    await expect(versionBadge(historicalSchedule, 'former')).toBeVisible();

    // The week's target mixes both versions: weekdays before today keep the
    // old 8h target, today and later use 6h (holiday-aware). On a weekend run
    // the whole Mo–Fr week already lies in the past and stays at 40.
    await employeePage.goto('/zeiterfassung');
    await expectVisibleAfterSave(
      employeePage,
      weeklyTargetHoursText(expectedWeeklyHours(businessDate, 8, 6)),
    );
    // With a real schedule there is no unconfigured warning.
    await expect(textInDom(employeePage, PERSONNEL_COPY.noSchedule)).toHaveCount(0);
  });

  test('Betriebsruhe heute wird gespeichert und setzt das Tagesziel auf null', async ({
    adminPage,
    businessDate,
    employeePage,
    world,
  }) => {
    await prepareScheduleScenario(world, {
      today: businessDate,
      previousMonday: previousMondayIso(businessDate),
    });
    const todayIso = businessDate;
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
      await expectVisibleAfterSave(employeePage, TARGET_COPY.closure);
    }
    await expect(visibleText(employeePage, TARGET_COPY.noTargetToday)).toBeVisible();

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
        ? holidayTargetText(todayTarget.holidayName)
        : todayTarget.targetMinutes > 0
          ? TARGET_COPY.dailyTargetPrefix
          : TARGET_COPY.noWorkday,
    );
    await expect(textInDom(employeePage, TARGET_COPY.closure)).toHaveCount(0);
  });

  test('Ohne Wochenplan ist das 8-Stunden-Ziel eine sichtbare Ausnahme', async ({
    adminPage,
    businessDate,
    world,
  }) => {
    await prepareScheduleScenario(world, {
      today: businessDate,
      previousMonday: previousMondayIso(businessDate),
    });
    // The office member has neither a schedule nor employment conditions.
    const memberName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    await openMemberDetailFromList(adminPage, memberName);

    await expect(visibleText(adminPage, PERSONNEL_COPY.noScheduleDefaultTarget)).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(adminPage, PERSONNEL_COPY.noScheduleSection)).toBeVisible();
  });

  test('Handwerker erreicht keine Verwaltung des Feiertagskalenders und der Betriebsruhe', async ({
    employeePage,
  }) => {
    // The settings surface is read-only for employees: no region editing, no
    // closure-day form.
    await employeePage.goto('/einstellungen/zeiterfassung');
    await expect(holidayRegionSelect(employeePage)).toBeDisabled();
    await expect(saveHolidayRegionButton(employeePage)).toBeDisabled();
    await expect(closureDaySubmitButton(employeePage)).toHaveCount(0);
    // Which schedule rows each role can read is a database rule:
    // supabase/tests/people_boundaries.sql.
  });
});
