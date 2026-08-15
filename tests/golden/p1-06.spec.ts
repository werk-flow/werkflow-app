import { expect, test } from './support/fixtures';
import type { Page } from '@playwright/test';
import {
  countVacationDaysByYear,
  doesDateConsumeVacation,
  formatVacationDays,
} from '../../lib/vacation/balance';
import { resolveDailyTargets } from '../../lib/personnel/targets';
import { getBusinessWeekDates } from '../../lib/personnel/schedule';
import {
  getEmployeeRecordStateByUser,
  getLatestVacationRequestState,
  getTargetContextForRecord,
  getVisibleVacationRequestRecordIdsAs,
} from './support/db';
import {
  addConditionViaDialog,
  approveVacationRequestFor,
  cancelApprovedVacationFor,
  confirmResponsibilityPreview,
  createOwnVacationRequestViaDialog,
  expectClockInBlockedByVacation,
  expectVacationOverlapRejectedViaDialog,
  expectVisibleAfterSave,
  openMemberDetailFromList,
  openOwnVacationSection,
  openVacationApprovals,
  previewResponsibilityChange,
  rejectVacationRequestFor,
  visibleText,
  withdrawOwnPendingVacationRequest,
} from './support/steps';

// P1-06 — Vacation requests, decisions, balances, availability, and target
// effects (@P1-06). Bounded outcome: employees request/withdraw vacation,
// leave_approval holders decide it, approved absence updates entitlement,
// targets, calendar, and history consistently. Day-counting and balance
// arithmetic are additionally unit-tested (`bun run test:unit`); this spec
// computes every date expectation at runtime from the same stored state and
// in-code rules the app uses.
//
// Inherited full-suite state that matters here: the employee's newest
// employment condition (from @P1-03, effective today) has NO vacation days, so
// the entitlement starts as the labeled missing-configuration exception in the
// full run exactly like in a focused run. @P1-04 gave the employee a Mo–Fr
// schedule and selected the Bavarian holiday calendar; day counting derives
// from that stored state at runtime. leave_approval starts at its role default
// (Admin + Büro) and ends this spec in `selected` mode with the admin as sole
// holder.

test.describe.configure({ mode: 'serial' });

function berlinTodayIso(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

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

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

// Next week's Monday: strictly after today in every case.
function nextMondayIso(): string {
  const todayIso = berlinTodayIso();
  return shiftIsoDate(todayIso, 7 - weekdayIndex(todayIso));
}

async function expectCalendarEventOnDate(
  page: Page,
  dateIso: string,
  title: string,
  status: 'pending' | 'approved'
): Promise<void> {
  const dayCell = page.locator(`.fc-daygrid-day[data-date="${dateIso}"]`);
  const eventClass = `.fc-vacation-${status}`;
  await expect(dayCell.locator(eventClass)).toHaveCount(1, { timeout: 15_000 });

  const moreLink = dayCell.locator('.fc-daygrid-more-link');
  if (await moreLink.isVisible()) {
    await moreLink.click();
    const popover = page.locator('.fc-popover');
    await expect(popover).toBeVisible({ timeout: 15_000 });
    await expect(popover.locator(eventClass)).toHaveCount(1);
  }

  // FullCalendar exposes the complete, non-truncated event name as `title`;
  // the painted text itself can be ellipsized before the person's full name.
  // The event wrapper has a zero-size box in month layout, so DOM identity is
  // the stable assertion while the screenshot-visible child carries the title.
  expect(await page.getByTitle(title).count()).toBeGreaterThan(0);
}

test.describe('P1-06 Urlaubsanträge und Urlaubssaldo @P1-06', () => {
  test('Ohne hinterlegten Anspruch ist der Saldo eine sichtbare Ausnahme, danach echte Arithmetik', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;

    // The old static „9 von 30" fiction must be gone; the honest labeled
    // exception takes its place because no condition carries vacation days.
    await openOwnVacationSection(employeePage);
    await expect(employeePage.getByText('9 von 30')).toHaveCount(0);
    await expect(
      visibleText(employeePage, 'Kein Urlaubsanspruch hinterlegt')
    ).toBeVisible();

    // The entitlement lives in the Beschäftigung conditions (P1-03 storage,
    // first consumed here). Valid from tomorrow so the version never collides
    // with the condition @P1-03 created effective today; the vacation year
    // still picks it up as the newest version of the year.
    await openMemberDetailFromList(adminPage, employeeName);
    await addConditionViaDialog(adminPage, {
      validFromDigits: toDatePickerDigits(shiftIsoDate(berlinTodayIso(), 1)),
      employmentTypeLabel: 'Vollzeit',
      vacationDays: '30',
    });

    await openOwnVacationSection(employeePage);
    await expectVisibleAfterSave(employeePage, '0 von 30 Tagen genommen');
    await expectVisibleAfterSave(employeePage, '30 Tage Resturlaub');
  });

  test('Antrag über ein Wochenende zählt nur echte Arbeitstage; Überschneidung ist blockiert; Zurückziehen bleibt nachvollziehbar', async ({
    employeePage,
    world,
  }) => {
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );

    // Thursday of next week through the Monday after: spans a weekend.
    const startIso = shiftIsoDate(nextMondayIso(), 3);
    const endIso = shiftIsoDate(nextMondayIso(), 7);
    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: toDatePickerDigits(startIso),
      endDigits: toDatePickerDigits(endIso),
      comment: 'Kurzurlaub',
    });

    // Expected consumption from the same stored schedules/holidays the app
    // uses: weekend days cost nothing, holidays cost nothing.
    const context = await getTargetContextForRecord(
      world.orgId,
      employeeRecord.id
    );
    const expectedDays = Object.values(
      countVacationDaysByYear(
        { startDate: startIso, endDate: endIso, dayPortion: 'full' },
        context
      )
    ).reduce((total, days) => total + days, 0);
    expect(expectedDays).toBeGreaterThan(0);
    expect(expectedDays).toBeLessThan(5);
    await expect(
      visibleText(
        employeePage,
        `${formatVacationDays(expectedDays)} (vorläufig)`
      )
    ).toBeVisible();
    // Pending requests are provisional: the taken counter must not move.
    await expect(
      visibleText(employeePage, '0 von 30 Tagen genommen')
    ).toBeVisible();

    // An overlapping own request in a non-terminal state is impossible.
    await expectVacationOverlapRejectedViaDialog(employeePage, {
      startDigits: toDatePickerDigits(shiftIsoDate(startIso, 1)),
      endDigits: toDatePickerDigits(shiftIsoDate(startIso, 1)),
    });

    // Withdrawal keeps the request and its history instead of deleting it.
    await withdrawOwnPendingVacationRequest(employeePage);
    const state = await getLatestVacationRequestState(
      world.orgId,
      employeeRecord.id
    );
    expect(state.status).toBe('withdrawn');
    expect(state.eventTypes).toEqual(['requested', 'withdrawn']);
  });

  test('Genehmigung senkt den Saldo, setzt das Tagesziel auf null, blockiert Einstempeln; Stornierung stellt alles nachvollziehbar wieder her', async ({
    bueroPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const todayIso = berlinTodayIso();
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );

    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: toDatePickerDigits(todayIso),
      endDigits: toDatePickerDigits(todayIso),
    });

    // Pending requests appear provisionally in the calendar. Open the month's
    // overflow when a holiday plus a closure puts the third event behind "+ mehr".
    await employeePage.goto('/kalender');
    await employeePage.getByRole('tab', { name: 'Monat' }).click();
    await expectCalendarEventOnDate(
      employeePage,
      todayIso,
      `Urlaub – ${employeeName} (angefragt)`,
      'pending'
    );

    // Büro is a role-default leave_approval holder and decides the request.
    await approveVacationRequestFor(bueroPage, employeeName);

    const context = await getTargetContextForRecord(
      world.orgId,
      employeeRecord.id
    );
    const expectedByYear = countVacationDaysByYear(
      { startDate: todayIso, endDate: todayIso, dayPortion: 'full' },
      context
    );
    const approvedState = await getLatestVacationRequestState(
      world.orgId,
      employeeRecord.id
    );
    expect(approvedState.status).toBe('approved');
    expect(approvedState.approvedDaysByYear).toEqual(expectedByYear);
    expect(approvedState.eventTypes).toEqual(['requested', 'approved']);

    const expectedTaken = Object.values(expectedByYear).reduce(
      (total, days) => total + days,
      0
    );

    // Target effect on the employee's own dashboard (only asserted when today
    // is a working day — on weekends/holidays the day never had a target).
    const [todayTargetWithoutAbsence] = resolveDailyTargets([todayIso], context);
    await openOwnVacationSection(employeePage);
    if (todayTargetWithoutAbsence.targetMinutes > 0) {
      await expectVisibleAfterSave(
        employeePage,
        'Urlaub genehmigt – heute keine Sollarbeitszeit.'
      );

      // Weekly Soll reflects the zeroed day (runtime- and holiday-aware, from
      // the same in-code resolver the app uses).
      const weekDates = getBusinessWeekDates();
      const expectedSollMinutes = resolveDailyTargets(weekDates, {
        ...context,
        absences: [
          {
            type: 'vacation',
            startDate: todayIso,
            endDate: todayIso,
            dayPortion: 'full',
          },
        ],
      }).reduce((total, target) => total + target.targetMinutes, 0);
      if (expectedSollMinutes % 60 === 0) {
        await expect(
          visibleText(employeePage, `Soll: ${expectedSollMinutes / 60} Std.`)
        ).toBeVisible();
      }
    }
    // expectedTaken is 0 or 1 here, so German and default integer formatting
    // are identical.
    await expectVisibleAfterSave(
      employeePage,
      `${expectedTaken} von 30 Tagen genommen`
    );

    // Approved vacation is a labeled calendar entry without the provisional
    // suffix, visible to planners, including through month overflow.
    await bueroPage.goto('/kalender');
    await bueroPage.getByRole('tab', { name: 'Monat' }).click();
    await expectCalendarEventOnDate(
      bueroPage,
      todayIso,
      `Urlaub – ${employeeName}`,
      'approved'
    );
    await expect(bueroPage.getByText('(angefragt)')).toHaveCount(0);

    // Contradiction rule: an approved full-day vacation day denies clock-in at
    // the server action with an understandable banner.
    await expectClockInBlockedByVacation(employeePage);

    // Retroactive correction: cancellation restores the balance traceably and
    // keeps the decision snapshot on the cancelled request.
    await cancelApprovedVacationFor(bueroPage, employeeName, 'Kundentermin verschoben');
    const cancelledState = await getLatestVacationRequestState(
      world.orgId,
      employeeRecord.id
    );
    expect(cancelledState.status).toBe('cancelled');
    expect(cancelledState.approvedDaysByYear).toEqual(expectedByYear);
    expect(cancelledState.eventTypes).toEqual([
      'requested',
      'approved',
      'cancelled',
    ]);

    await openOwnVacationSection(employeePage);
    await expectVisibleAfterSave(employeePage, '0 von 30 Tagen genommen');
    await expect(visibleText(employeePage, 'Storniert')).toBeVisible();
    await expect(
      visibleText(employeePage, 'Kundentermin verschoben')
    ).toBeVisible();
  });

  test('Ein halber Urlaubstag kostet 0,5 Tage', async ({
    bueroPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );
    const context = await getTargetContextForRecord(
      world.orgId,
      employeeRecord.id
    );

    // First Monday at least two weeks out that actually consumes entitlement
    // (skips holidays deterministically via the same in-code dataset).
    let halfDayIso = shiftIsoDate(nextMondayIso(), 7);
    while (!doesDateConsumeVacation(halfDayIso, context)) {
      halfDayIso = shiftIsoDate(halfDayIso, 7);
    }

    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: toDatePickerDigits(halfDayIso),
      endDigits: toDatePickerDigits(halfDayIso),
      halfDay: true,
    });
    await approveVacationRequestFor(bueroPage, employeeName);

    const state = await getLatestVacationRequestState(
      world.orgId,
      employeeRecord.id
    );
    expect(state.status).toBe('approved');
    expect(state.dayPortion).toBe('half_day');
    expect(state.approvedDaysByYear).toEqual({
      [halfDayIso.slice(0, 4)]: 0.5,
    });

    await openOwnVacationSection(employeePage);
    await expectVisibleAfterSave(employeePage, '0,5 von 30 Tagen genommen');
    await expectVisibleAfterSave(employeePage, '29,5 Tage Resturlaub');
    await expect(visibleText(employeePage, 'Halbtägig')).toBeVisible();
  });

  test('Vier Augen und Anspruchswarnung: eigener Antrag bleibt unsichtbar, Genehmigung ohne Anspruch ist eine sichtbare Ausnahme; Entzug wirkt am Aktionspunkt', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;

    // Büro (a role-default holder) requests own vacation: four eyes hides the
    // request from their own approval queue; only the admin may decide it.
    const bueroStartIso = shiftIsoDate(nextMondayIso(), 8);
    await createOwnVacationRequestViaDialog(bueroPage, {
      startDigits: toDatePickerDigits(bueroStartIso),
      endDigits: toDatePickerDigits(bueroStartIso),
    });
    await openVacationApprovals(bueroPage);
    await expect(
      bueroPage.getByRole('button', {
        name: `Urlaubsantrag von ${bueroName} genehmigen`,
      })
    ).toHaveCount(0);

    // Büro has no stored entitlement: the approver sees the labeled exception
    // with the actionable hint instead of an invented number, and may still
    // decide deliberately.
    await openVacationApprovals(adminPage);
    await expect(
      visibleText(adminPage, 'Kein Urlaubsanspruch hinterlegt')
    ).toBeVisible({ timeout: 15_000 });
    await approveVacationRequestFor(adminPage, bueroName);
    const bueroRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.buero.id
    );
    expect(
      (await getLatestVacationRequestState(world.orgId, bueroRecord.id)).status
    ).toBe('approved');

    // The employee submits another request; Büro can currently see it.
    const requestIso = shiftIsoDate(nextMondayIso(), 16);
    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: toDatePickerDigits(requestIso),
      endDigits: toDatePickerDigits(requestIso),
    });
    // Freeze Büro's browser in a genuinely stale state — the woken-up-laptop
    // scenario that action-time enforcement exists for. Swallow the Realtime
    // websocket AND suppress visibilitychange (the app deliberately refreshes
    // all listeners when a tab becomes visible again, which would self-heal
    // the stale card before the click can prove server-side denial).
    await bueroPage.routeWebSocket(
      (url) => url.toString().includes('realtime'),
      () => {
        // Swallowed: the page-side socket never reaches Supabase.
      }
    );
    await bueroPage.addInitScript(() => {
      document.addEventListener(
        'visibilitychange',
        (event) => event.stopImmediatePropagation(),
        true
      );
    });
    await openVacationApprovals(bueroPage);
    const staleApproveButton = bueroPage.getByRole('button', {
      name: `Urlaubsantrag von ${employeeName} genehmigen`,
    });
    await expect(staleApproveButton).toBeVisible({ timeout: 15_000 });

    // The owner narrows leave_approval to the admin alone while Büro still
    // shows the stale approval card. The click must be denied by action-time
    // resolution — never decided from stale authority.
    await previewResponsibilityChange(adminPage, {
      responsibility: 'leave_approval',
      selectedNames: [adminName],
      lostNames: [bueroName],
    });
    await confirmResponsibilityPreview(adminPage);

    await staleApproveButton.click();
    await expect(
      visibleText(
        bueroPage,
        'Du bist für diese Urlaubsfreigabe nicht mehr verantwortlich. Die Ansicht wurde aktualisiert.'
      )
    ).toBeVisible({ timeout: 15_000 });
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );
    expect(
      (await getLatestVacationRequestState(world.orgId, employeeRecord.id))
        .status
    ).toBe('pending');
    await bueroPage.unrouteAll();

    // The remaining holder rejects with an auditable reason the employee sees.
    await rejectVacationRequestFor(
      adminPage,
      employeeName,
      'Betriebsurlaub bereits geplant'
    );
    const rejectedState = await getLatestVacationRequestState(
      world.orgId,
      employeeRecord.id
    );
    expect(rejectedState.status).toBe('rejected');
    expect(rejectedState.eventTypes).toEqual(['requested', 'rejected']);

    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, 'Abgelehnt')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      visibleText(employeePage, 'Betriebsurlaub bereits geplant')
    ).toBeVisible();
  });

  test('Beschäftigte sehen nur eigene Anträge; Fremdorganisationen sehen nichts', async ({
    outsiderPage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );

    // Real-credential RLS: the employee sees exactly their own request rows
    // (never Büro's approved vacation), the org outsider none at all.
    const visibleToEmployee = await getVisibleVacationRequestRecordIdsAs(
      world.users.employee,
      world.orgId
    );
    expect(visibleToEmployee).toEqual([employeeRecord.id]);

    const visibleToOutsider = await getVisibleVacationRequestRecordIdsAs(
      world.outsider.admin,
      world.orgId
    );
    expect(visibleToOutsider).toEqual([]);

    // The outsider's own organization shows its own honest empty state and no
    // cross-organization vacation entries.
    await openOwnVacationSection(outsiderPage);
    await expect(
      visibleText(outsiderPage, 'Kein Urlaubsanspruch hinterlegt')
    ).toBeVisible();
    await outsiderPage.goto('/kalender');
    await outsiderPage.getByRole('tab', { name: 'Monat' }).click();
    await expect(
      outsiderPage.getByText(`Urlaub – ${employeeName}`)
    ).toHaveCount(0);
  });
});
