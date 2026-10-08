import { expect, test } from './support/fixtures';
import {
  countVacationDaysByYear,
  doesDateConsumeVacation,
  formatVacationDays,
} from '../../lib/vacation/balance';
import { resolveDailyTargets } from '../../lib/personnel/targets';
import { getBusinessWeekDates } from '../../lib/personnel/schedule';
import { VACATION_PORTION_LABELS, VACATION_STATUS_LABELS } from '../../lib/vacation/types';
import { getEmployeeRecordStateByUser, setResponsibilityHolders } from './support/db/personnel';
import { getLatestVacationRequestState, getTargetContextForRecord } from './support/db/vacation';
import { prepareScheduleScenario } from './support/schedule-fixture';
import {
  TARGET_COPY,
  addConditionViaDialog,
  confirmResponsibilityPreview,
  openMemberDetailFromList,
  previewResponsibilityChange,
  weeklyTargetHoursText,
} from './support/steps/personnel';
import { expectVisibleAfterSave, testData, visibleText, textInDom } from './support/steps/shared';
import {
  VACATION_COPY,
  approveVacationButton,
  approveVacationRequestFor,
  cancelApprovedVacationFor,
  createOwnVacationRequestViaDialog,
  expectClockInBlockedByVacation,
  expectVacationOverlapRejectedViaDialog,
  openOwnVacationSection,
  openVacationApprovals,
  provisionalVacationDaysText,
  rejectVacationRequestFor,
  vacationCalendarLabel,
  vacationRemainingText,
  vacationTakenRatio,
  vacationTakenText,
  withdrawOwnPendingVacationRequest,
} from './support/steps/vacation';
import { showCalendarMonth } from './support/steps/calendar';
import { expectCalendarVacationEventOnDate } from './support/p1-06-calendar';
import type { TestWorld } from './support/world';
import { freezeLiveUpdates } from './support/live';

// P1-06 — Vacation requests, decisions, balances, availability, and target
// effects (@P1-06). The employee's balance is one connected journey: the
// entitlement, a request, its decision and its cancellation all act on the
// same balance, so they are named steps of one test. Day counting and balance
// arithmetic are unit-tested (`bun run test:unit`); this spec computes every
// date expectation from the same stored state and in-code rules the app uses.
// Which request rows each role can read is a database rule
// (supabase/tests/people_boundaries.sql). The preview's edge cases and the
// role variants of the calendar belong to the A4 audit.

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
  return shifted.toISOString().slice(0, 10);
}

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

// Next week's Monday: strictly after today in every case.
function nextMondayIso(todayIso: string): string {
  return shiftIsoDate(todayIso, 7 - weekdayIndex(todayIso));
}

/** Leave approval starts at its role default (Admin and Büro decide), whatever another test configured. */
async function pinLeaveApprovalToRoleDefault(world: TestWorld): Promise<void> {
  await setResponsibilityHolders({
    organizationId: world.orgId,
    ownerUserId: world.users.admin.id,
    responsibility: 'leave_approval',
    holderEmployeeRecordIds: 'role_default',
  });
}

test.describe('P1-06 Urlaubsanträge und Urlaubssaldo @P1-06', () => {
  test('Urlaubssaldo vom fehlenden Anspruch bis zur Stornierung: Antrag, Zurückziehen, Genehmigung, Sollzeit, Einstempeln und halber Tag', async ({
    adminPage,
    bueroPage,
    businessDate,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const todayIso = businessDate;
    const nextMonday = nextMondayIso(todayIso);
    // A Mo–Fr schedule and a condition without vacation days; no holiday region.
    await prepareScheduleScenario(world, {
      today: todayIso,
      previousMonday: shiftIsoDate(nextMonday, -14),
      holidayRegion: null,
    });
    await pinLeaveApprovalToRoleDefault(world);
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);

    await test.step('Ohne hinterlegten Anspruch ist der Saldo eine sichtbare Ausnahme, danach echte Arithmetik', async () => {
      // The old static „9 von 30" fiction must be gone; the honest labeled
      // exception takes its place because no condition carries vacation days.
      await openOwnVacationSection(employeePage);
      await expect(textInDom(employeePage, vacationTakenRatio(9, 30))).toHaveCount(0);
      await expect(visibleText(employeePage, VACATION_COPY.noEntitlement)).toBeVisible();

      // The entitlement lives in the Beschäftigung conditions (P1-03 storage).
      await openMemberDetailFromList(adminPage, employeeName);
      await addConditionViaDialog(adminPage, {
        validFromDigits: toDatePickerDigits(todayIso),
        employmentType: 'vollzeit',
        vacationDays: '30',
      });

      await openOwnVacationSection(employeePage);
      await expectVisibleAfterSave(employeePage, vacationTakenText(0, 30));
      await expectVisibleAfterSave(employeePage, vacationRemainingText(30));
    });

    await test.step('Antrag über ein Wochenende zählt nur echte Arbeitstage; Überschneidung ist blockiert; Zurückziehen bleibt nachvollziehbar', async () => {
      // Thursday of next week through the Monday after: spans a weekend.
      const startIso = shiftIsoDate(nextMonday, 3);
      const endIso = shiftIsoDate(nextMonday, 7);
      await createOwnVacationRequestViaDialog(employeePage, {
        startDigits: toDatePickerDigits(startIso),
        endDigits: toDatePickerDigits(endIso),
        comment: 'Kurzurlaub',
      });

      const context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
      const expectedDays = Object.values(
        countVacationDaysByYear({ startDate: startIso, endDate: endIso, dayPortion: 'full' }, context),
      ).reduce((total, days) => total + days, 0);
      expect(expectedDays).toBeGreaterThan(0);
      expect(expectedDays).toBeLessThan(5);
      await expect(
        visibleText(employeePage, provisionalVacationDaysText(formatVacationDays(expectedDays))),
      ).toBeVisible();
      // Pending requests are provisional: the taken counter must not move.
      await expect(visibleText(employeePage, vacationTakenText(0, 30))).toBeVisible();

      await expectVacationOverlapRejectedViaDialog(employeePage, {
        startDigits: toDatePickerDigits(shiftIsoDate(startIso, 1)),
        endDigits: toDatePickerDigits(shiftIsoDate(startIso, 1)),
      });

      // Withdrawal keeps the request and its history instead of deleting it.
      await withdrawOwnPendingVacationRequest(employeePage);
      const state = await getLatestVacationRequestState(world.orgId, employeeRecord.id);
      expect(state.startDate).toBe(startIso);
      expect(state.status).toBe('withdrawn');
      expect(state.eventTypes).toEqual(['requested', 'withdrawn']);
    });

    await test.step('Genehmigung senkt den Saldo, setzt das Tagesziel auf null, blockiert Einstempeln; Stornierung stellt alles nachvollziehbar wieder her', async () => {
      await createOwnVacationRequestViaDialog(employeePage, {
        startDigits: toDatePickerDigits(todayIso),
        endDigits: toDatePickerDigits(todayIso),
      });

      // Pending requests appear provisionally in the calendar.
      await showCalendarMonth(employeePage);
      await expectCalendarVacationEventOnDate(
        employeePage,
        todayIso,
        vacationCalendarLabel(employeeName, { requested: true }),
        'pending',
      );

      // Büro is a role-default leave_approval holder and decides the request.
      await approveVacationRequestFor(bueroPage, employeeName);

      const context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
      const expectedByYear = countVacationDaysByYear(
        { startDate: todayIso, endDate: todayIso, dayPortion: 'full' },
        context,
      );
      const approvedState = await getLatestVacationRequestState(world.orgId, employeeRecord.id);
      expect(approvedState.startDate).toBe(todayIso);
      expect(approvedState.status).toBe('approved');
      expect(approvedState.approvedDaysByYear).toEqual(expectedByYear);
      expect(approvedState.eventTypes).toEqual(['requested', 'approved']);
      const expectedTaken = Object.values(expectedByYear).reduce((total, days) => total + days, 0);

      // Target effect on the employee's own dashboard (only when today is a
      // working day — on weekends the day never had a target).
      const [todayTargetWithoutAbsence] = resolveDailyTargets([todayIso], context);
      if (!todayTargetWithoutAbsence) throw new Error('P1-06: no daily target resolved for today');
      await openOwnVacationSection(employeePage);
      if (todayTargetWithoutAbsence.targetMinutes > 0) {
        await expectVisibleAfterSave(employeePage, TARGET_COPY.vacationNoTarget);
        const weekDates = getBusinessWeekDates(new Date(`${todayIso}T12:00:00Z`));
        const expectedSollMinutes = resolveDailyTargets(weekDates, {
          ...context,
          absences: [{ type: 'vacation', startDate: todayIso, endDate: todayIso, dayPortion: 'full' }],
        }).reduce((total, target) => total + target.targetMinutes, 0);
        if (expectedSollMinutes % 60 === 0) {
          await expect(
            visibleText(employeePage, weeklyTargetHoursText(expectedSollMinutes / 60)),
          ).toBeVisible();
        }
      }
      // expectedTaken is 0 or 1 here, so German and default integer formatting are identical.
      await expectVisibleAfterSave(employeePage, vacationTakenText(expectedTaken, 30));

      // Approved vacation is a labeled calendar entry without the provisional suffix.
      await showCalendarMonth(bueroPage);
      await expectCalendarVacationEventOnDate(
        bueroPage,
        todayIso,
        vacationCalendarLabel(employeeName),
        'approved',
      );
      await expect(
        textInDom(bueroPage, vacationCalendarLabel(employeeName, { requested: true })),
      ).toHaveCount(0);

      // An approved full-day vacation day denies clock-in with an understandable banner.
      await expectClockInBlockedByVacation(employeePage);

      // Retroactive correction: cancellation restores the balance traceably and
      // keeps the decision snapshot on the cancelled request.
      const cancellationReason = testData`Kundentermin verschoben`;
      await cancelApprovedVacationFor(bueroPage, employeeName, cancellationReason);
      const cancelledState = await getLatestVacationRequestState(world.orgId, employeeRecord.id);
      expect(cancelledState.id).toBe(approvedState.id);
      expect(cancelledState.status).toBe('cancelled');
      expect(cancelledState.approvedDaysByYear).toEqual(expectedByYear);
      expect(cancelledState.eventTypes).toEqual(['requested', 'approved', 'cancelled']);

      await openOwnVacationSection(employeePage);
      await expectVisibleAfterSave(employeePage, vacationTakenText(0, 30));
      await expect(visibleText(employeePage, VACATION_STATUS_LABELS.cancelled)).toBeVisible();
      await expect(visibleText(employeePage, cancellationReason)).toBeVisible();
    });

    await test.step('Ein halber Urlaubstag kostet 0,5 Tage', async () => {
      const context = await getTargetContextForRecord(world.orgId, employeeRecord.id);
      // First Monday at least two weeks out that actually consumes entitlement.
      let halfDayIso: string | null = null;
      for (let weekOffset = 1; weekOffset <= 54; weekOffset++) {
        const candidateIso = shiftIsoDate(nextMonday, weekOffset * 7);
        if (doesDateConsumeVacation(candidateIso, context)) {
          halfDayIso = candidateIso;
          break;
        }
      }
      if (halfDayIso === null) throw new Error('No vacation-consuming Monday found within 54 weeks.');

      await createOwnVacationRequestViaDialog(employeePage, {
        startDigits: toDatePickerDigits(halfDayIso),
        endDigits: toDatePickerDigits(halfDayIso),
        halfDay: true,
      });
      await approveVacationRequestFor(bueroPage, employeeName);

      const state = await getLatestVacationRequestState(world.orgId, employeeRecord.id);
      expect(state.startDate).toBe(halfDayIso);
      expect(state.status).toBe('approved');
      expect(state.dayPortion).toBe('half_day');
      expect(state.approvedDaysByYear).toEqual({ [halfDayIso.slice(0, 4)]: 0.5 });

      await openOwnVacationSection(employeePage);
      await expectVisibleAfterSave(employeePage, vacationTakenText('0,5', 30));
      await expectVisibleAfterSave(employeePage, vacationRemainingText('29,5'));
      await expect(visibleText(employeePage, VACATION_PORTION_LABELS.half_day)).toBeVisible();
    });
  });

  test('Vier Augen und Anspruchswarnung: eigener Antrag bleibt unsichtbar, Genehmigung ohne Anspruch ist eine sichtbare Ausnahme; Entzug wirkt am Aktionspunkt', async ({
    adminPage,
    bueroPage,
    businessDate,
    employeePage,
    world,
  }) => {
    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const nextMonday = nextMondayIso(businessDate);
    await pinLeaveApprovalToRoleDefault(world);
    const [bueroRecord, employeeRecord] = await Promise.all([
      getEmployeeRecordStateByUser(world.orgId, world.users.buero.id),
      getEmployeeRecordStateByUser(world.orgId, world.users.employee.id),
    ]);

    // Büro (a role-default holder) requests own vacation: four eyes hides the
    // request from their own approval queue; only the admin may decide it.
    const bueroStartIso = shiftIsoDate(nextMonday, 8);
    await createOwnVacationRequestViaDialog(bueroPage, {
      startDigits: toDatePickerDigits(bueroStartIso),
      endDigits: toDatePickerDigits(bueroStartIso),
    });
    await openVacationApprovals(bueroPage);
    await expect(approveVacationButton(bueroPage, bueroName)).toHaveCount(0);

    // Büro has no stored entitlement: the approver sees the labeled exception
    // instead of an invented number, and may still decide deliberately.
    await openVacationApprovals(adminPage);
    await expect(visibleText(adminPage, VACATION_COPY.noEntitlement)).toBeVisible({
      timeout: 15_000,
    });
    await approveVacationRequestFor(adminPage, bueroName);
    const bueroState = await getLatestVacationRequestState(world.orgId, bueroRecord.id);
    expect(bueroState.startDate).toBe(bueroStartIso);
    expect(bueroState.status).toBe('approved');

    // The employee submits a request; Büro can currently see it.
    const requestIso = shiftIsoDate(nextMonday, 16);
    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: toDatePickerDigits(requestIso),
      endDigits: toDatePickerDigits(requestIso),
    });
    // Freeze Büro's browser in a genuinely stale state: the woken-up-laptop
    // scenario that action-time enforcement exists for.
    const releaseBuero = await freezeLiveUpdates(bueroPage);
    await openVacationApprovals(bueroPage);
    const staleApproveButton = approveVacationButton(bueroPage, employeeName);
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
    await expect(visibleText(bueroPage, VACATION_COPY.approverNoLongerResponsible)).toBeVisible({
      timeout: 15_000,
    });
    const pendingState = await getLatestVacationRequestState(world.orgId, employeeRecord.id);
    expect(pendingState.startDate).toBe(requestIso);
    expect(pendingState.status).toBe('pending');
    await releaseBuero();

    // The remaining holder rejects with an auditable reason the employee sees.
    const rejectionReason = testData`Betriebsurlaub bereits geplant`;
    await rejectVacationRequestFor(adminPage, employeeName, rejectionReason);
    const rejectedState = await getLatestVacationRequestState(world.orgId, employeeRecord.id);
    expect(rejectedState.id).toBe(pendingState.id);
    expect(rejectedState.status).toBe('rejected');
    expect(rejectedState.eventTypes).toEqual(['requested', 'rejected']);

    await openOwnVacationSection(employeePage);
    await expect(visibleText(employeePage, VACATION_STATUS_LABELS.rejected)).toBeVisible({
      timeout: 15_000,
    });
    await expect(visibleText(employeePage, rejectionReason)).toBeVisible();
  });
});
