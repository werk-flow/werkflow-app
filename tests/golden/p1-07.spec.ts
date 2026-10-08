import { REQUEST_CLOSE_REASON_LABELS } from '../../lib/requests/types';
import { expectDefined } from '../../lib/testing/spec-support/expect-defined';
import { expect, test } from './support/fixtures';
import { getAttentionPatternStateForUser } from './support/db/attention';
import { getEmployeeRecordStateByUser, setResponsibilityHolders } from './support/db/personnel';
import { countOpenClientRequests } from './support/db/requests';
import { getLatestManualTimeEntryState } from './support/db/time-tracking';
import { getLatestVacationRequestState, getVacationRequestIdsByStartDate } from './support/db/vacation';
import {
  ATTENTION_ROW_COPY,
  attentionNotificationRow,
  aufgabenSidebarBadge,
  markAttentionNotificationReadViaButton,
  openAufgaben,
  requestTaskLink,
  taskResponsible,
  timeApprovalTaskLink,
  vacationRequestTaskLink,
} from './support/steps/attention';
import {
  createResponsibilityDelegationViaSettings,
  endResponsibilityDelegationViaSettings,
} from './support/steps/personnel';
import {
  assignRequestAssigneeViaEditDialog,
  closeRequestViaDialog,
  createRequestViaDialog,
} from './support/steps/requests';
import { expectBannerAfter, testData, visibleText, textInDom } from './support/steps/shared';
import {
  approvePendingTimeEntry,
  createOwnManualTimeEntry,
  pendingApprovalsPanel,
} from './support/steps/time-tracking';
import {
  approveVacationButton,
  cancelApprovedVacationForRangeText,
  createOwnVacationRequestViaDialog,
  rejectVacationRequestFor,
  vacationApprovedBanner,
  vacationCalendarLabel,
} from './support/steps/vacation';
import { showCalendarMonth } from './support/steps/calendar';

// GG-02 — Approval and attention (@GG-02), the exit gate of P1-07. One
// role-aware task/approval/notification pattern: derived items,
// responsibility-scoped visibility, delegation-following attention, per-item
// deduplication, deep links into the owning surfaces, and read markers with an
// append-only pattern audit. The stages act on the same requests and the same
// responsibility state, so they are named steps of one test. Schedules,
// vacation balance, sickness and qualifications have their own goldens; which
// attention rows each role can read is a database rule
// (supabase/tests/people_boundaries.sql); badge arithmetic, request age and
// "Meine Anträge" are the A5 audit's edge cases.

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

function formatGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

function monthsBetween(todayIso: string, dateIso: string): number {
  return (
    (Number(dateIso.slice(0, 4)) - Number(todayIso.slice(0, 4))) * 12 +
    (Number(dateIso.slice(5, 7)) - Number(todayIso.slice(5, 7)))
  );
}

test.describe('GG-02 Freigaben und Aufmerksamkeit @P1-07 @GG-02', () => {
  test('Aufgaben erreichen genau die Zuständigen, folgen der Vertretung, verlinken in die Entscheidung und Benachrichtigungen werden wieder ungelesen statt doppelt', async ({
    adminPage,
    bueroPage,
    businessDate,
    employeePage,
    world,
  }) => {
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const nextMonday = shiftIsoDate(businessDate, 7 - weekdayIndex(businessDate));
    const firstDayIso = shiftIsoDate(nextMonday, 1);
    const secondDayIso = shiftIsoDate(nextMonday, 2);
    const requestNumber = `ANF-${world.runId}-GG02`;
    const [adminRecord, employeeRecord] = await Promise.all([
      getEmployeeRecordStateByUser(world.orgId, world.users.admin.id),
      getEmployeeRecordStateByUser(world.orgId, world.users.employee.id),
    ]);
    // Time approval belongs to the employee alone, leave approval to the admin alone.
    await setResponsibilityHolders({
      organizationId: world.orgId,
      ownerUserId: world.users.admin.id,
      responsibility: 'time_approval',
      holderEmployeeRecordIds: [employeeRecord.id],
    });
    await setResponsibilityHolders({
      organizationId: world.orgId,
      ownerUserId: world.users.admin.id,
      responsibility: 'leave_approval',
      holderEmployeeRecordIds: [adminRecord.id],
    });

    await test.step('Anfrage-Aufgabe zeigt Zuständigkeit, verlinkt in die Anfrage und verschwindet nach der Auflösung', async () => {
      const requestSummary = `Heizung klopft im Mehrfamilienhaus ${world.runId}`;
      const request = await createRequestViaDialog(adminPage, {
        summary: requestSummary,
        requestNumber,
      });
      expect([request.summary, request.requestNumber]).toEqual([requestSummary, requestNumber]);
      await assignRequestAssigneeViaEditDialog(adminPage, bueroName);

      // The assignee sees "Mir zugewiesen", others see the responsible person.
      await openAufgaben(bueroPage);
      const bueroRequestTask = requestTaskLink(bueroPage, requestNumber);
      await expect(bueroRequestTask).toHaveCount(1);
      await expect(bueroRequestTask.getByText(ATTENTION_ROW_COPY.assignedToMe)).toBeVisible();

      await openAufgaben(adminPage);
      const adminRequestTask = requestTaskLink(adminPage, requestNumber);
      await expect(adminRequestTask).toHaveCount(1);
      await expect(taskResponsible(adminRequestTask, bueroName)).toBeVisible();

      // The employee never sees office request tasks (role boundary).
      await openAufgaben(employeePage);
      await expect(employeePage.getByTestId('attention-request-tasks')).toHaveCount(0);

      // Deep link into the owning context, resolve it there, and the item disappears.
      await adminRequestTask.click();
      await adminPage.waitForURL(`**/anfragen/${request.id}`, { timeout: 20_000 });
      await expect(visibleText(adminPage, requestSummary)).toBeVisible({
        timeout: 15_000,
      });
      await closeRequestViaDialog(adminPage, REQUEST_CLOSE_REASON_LABELS.anderweitig_geloest);
      await openAufgaben(adminPage);
      await expect(requestTaskLink(adminPage, requestNumber)).toHaveCount(0);
    });

    await test.step('Zeitfreigabe erreicht genau die verantwortliche Person und wird über den Deep-Link entschieden', async () => {
      // Büro's own manual entry becomes pending. Only the employee holds time
      // approval, so the task must reach the employee and not the admin.
      await createOwnManualTimeEntry(bueroPage, {
        memberName: bueroName,
        dateDigits: toDatePickerDigits(shiftIsoDate(businessDate, -1)),
        clockInDigits: '1000',
        clockOutDigits: '1100',
      });

      await openAufgaben(adminPage);
      await expect(adminPage.getByTestId('attention-time-tasks')).toHaveCount(0);

      await openAufgaben(employeePage);
      const timeTask = timeApprovalTaskLink(employeePage, bueroName);
      await expect(timeTask).toHaveCount(1);
      await expect(aufgabenSidebarBadge(employeePage)).toHaveText('1', { timeout: 15_000 });

      await timeTask.click();
      await employeePage.waitForURL('**/zeiterfassung?tab=approvals', { timeout: 20_000 });
      await expect(pendingApprovalsPanel(employeePage)).toHaveAttribute('data-loaded', 'true', {
        timeout: 15_000,
      });
      await approvePendingTimeEntry(employeePage, world.users.buero.id);
      expect((await getLatestManualTimeEntryState(world.orgId, world.users.buero.id)).status).toBe(
        'approved',
      );

      // Resolved means gone from the surface — and the badge follows.
      await openAufgaben(employeePage);
      await expect(employeePage.getByTestId('attention-time-tasks')).toHaveCount(0);
      await expect(aufgabenSidebarBadge(employeePage)).toHaveCount(0, { timeout: 15_000 });
    });

    await test.step('Vertretung: die Aufmerksamkeit folgt der Delegation ohne Duplikate und endet mit ihr', async () => {
      await createOwnVacationRequestViaDialog(employeePage, {
        startDigits: toDatePickerDigits(firstDayIso),
        endDigits: toDatePickerDigits(firstDayIso),
        comment: `GG-02 Antrag ${world.runId}`,
      });

      // Leave approval is held by the admin alone: only the admin sees the task.
      await openAufgaben(adminPage);
      await expect(vacationRequestTaskLink(adminPage, employeeName)).toHaveCount(1);
      await openAufgaben(bueroPage);
      await expect(bueroPage.getByTestId('attention-vacation-tasks')).toHaveCount(0);

      // The admin delegates leave approval to Büro for a bounded window; the
      // attention item follows the delegation — exactly once, never twice.
      await createResponsibilityDelegationViaSettings(adminPage, {
        responsibility: 'leave_approval',
        delegatorName: adminName,
        substituteName: bueroName,
        validFromDigits: toDatePickerDigits(businessDate),
        validUntilDigits: toDatePickerDigits(shiftIsoDate(businessDate, 3)),
      });

      await openAufgaben(bueroPage);
      const bueroVacationTask = vacationRequestTaskLink(bueroPage, employeeName);
      await expect(bueroVacationTask).toHaveCount(1);
      // Unified badge: the open requests plus exactly one delegated approval.
      const openRequests = await countOpenClientRequests(world.orgId);
      await expect(aufgabenSidebarBadge(bueroPage)).toHaveText(String(openRequests + 1), {
        timeout: 15_000,
      });

      // The substitute decides over the deep link, on the same surface as always.
      await bueroVacationTask.click();
      await bueroPage.waitForURL('**/zeiterfassung?tab=approvals', { timeout: 20_000 });
      const approveButton = approveVacationButton(bueroPage, employeeName);
      // The card leaves with the click; the banner is the server's confirmation.
      await expectBannerAfter(bueroPage, vacationApprovedBanner(employeeName), () => approveButton.click());
      await expect(approveButton).toHaveCount(0, { timeout: 15_000 });
      const approvedState = await getLatestVacationRequestState(world.orgId, employeeRecord.id);
      expect(approvedState.startDate).toBe(firstDayIso);
      expect(approvedState.status).toBe('approved');

      // Approved availability: the calendar entry loses its provisional suffix.
      await showCalendarMonth(bueroPage, monthsBetween(businessDate, firstDayIso));
      await expect(visibleText(bueroPage, vacationCalendarLabel(employeeName))).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        textInDom(bueroPage, vacationCalendarLabel(employeeName, { requested: true })),
      ).toHaveCount(0);

      // A second request while the delegation is active: delegator and
      // substitute see it exactly once each (deduplication per viewer).
      await createOwnVacationRequestViaDialog(employeePage, {
        startDigits: toDatePickerDigits(secondDayIso),
        endDigits: toDatePickerDigits(secondDayIso),
      });
      await openAufgaben(adminPage);
      await expect(vacationRequestTaskLink(adminPage, employeeName)).toHaveCount(1);
      await openAufgaben(bueroPage);
      await expect(vacationRequestTaskLink(bueroPage, employeeName)).toHaveCount(1);

      // Ending the delegation removes the substitute's attention immediately;
      // the remaining holder keeps it.
      await endResponsibilityDelegationViaSettings(adminPage, 'leave_approval', bueroName);
      await openAufgaben(bueroPage);
      await expect(bueroPage.getByTestId('attention-vacation-tasks')).toHaveCount(0, { timeout: 15_000 });
      await openAufgaben(adminPage);
      await expect(vacationRequestTaskLink(adminPage, employeeName)).toHaveCount(1);
    });

    await test.step('Eine Benachrichtigung pro Antrag: erneute Entscheidung macht sie wieder ungelesen statt sie zu duplizieren; das Muster-Audit ist lückenlos', async () => {
      // The remaining holder rejects the second request with a reason.
      const rejectionReason = testData`Personalengpass im Zeitraum`;
      await rejectVacationRequestFor(adminPage, employeeName, rejectionReason);

      const requestsByDay = await getVacationRequestIdsByStartDate(world.orgId, employeeRecord.id);
      const approvedRequest = expectDefined(requestsByDay.get(firstDayIso), 'the approved GG-02 request');
      const rejectedRequest = expectDefined(requestsByDay.get(secondDayIso), 'the rejected GG-02 request');
      expect(approvedRequest.status).toBe('approved');
      expect(rejectedRequest.status).toBe('rejected');

      // The employee gets exactly one notification per decided request.
      await openAufgaben(employeePage);
      const approvedRow = attentionNotificationRow(employeePage, approvedRequest.id);
      const rejectedRow = attentionNotificationRow(employeePage, rejectedRequest.id);
      await expect(approvedRow).toHaveCount(1);
      await expect(approvedRow).toHaveAttribute('data-unread', 'true');
      await expect(rejectedRow).toHaveCount(1);
      await expect(rejectedRow.getByText(ATTENTION_ROW_COPY.rejected)).toBeVisible();
      await expect(rejectedRow.getByText(rejectionReason)).toBeVisible();

      await markAttentionNotificationReadViaButton(employeePage, approvedRequest.id);
      await markAttentionNotificationReadViaButton(employeePage, rejectedRequest.id);
      await expect(aufgabenSidebarBadge(employeePage)).toHaveCount(0, { timeout: 15_000 });

      // Retroactive correction: cancelling the approved request re-surfaces the
      // SAME notification as unread — never a second row.
      const cancellationReason = testData`Projekttermin verschoben`;
      await cancelApprovedVacationForRangeText(
        adminPage,
        employeeName,
        formatGermanDate(firstDayIso),
        cancellationReason,
      );

      await openAufgaben(employeePage);
      await expect(approvedRow).toHaveCount(1, { timeout: 15_000 });
      await expect(approvedRow).toHaveAttribute('data-unread', 'true', { timeout: 15_000 });
      await expect(approvedRow.getByText(ATTENTION_ROW_COPY.cancelled)).toBeVisible();
      await expect(approvedRow.getByText(cancellationReason)).toBeVisible();
      await expect(aufgabenSidebarBadge(employeePage)).toHaveText('1', { timeout: 15_000 });
      await markAttentionNotificationReadViaButton(employeePage, approvedRequest.id);

      // Pattern audit: the read marker moved through both versions of the
      // approved request (approved → cancelled), each transition recorded.
      const requestsAfterCancel = await getVacationRequestIdsByStartDate(world.orgId, employeeRecord.id);
      expect(requestsAfterCancel.get(firstDayIso)?.status).toBe('cancelled');
      const patternState = await getAttentionPatternStateForUser(world.orgId, world.users.employee.id);
      const approvedReadState = patternState.readStates.find(
        (readState) => readState.sourceId === approvedRequest.id,
      );
      expect(approvedReadState?.stateVersion.startsWith('cancelled:')).toBe(true);
      expect(
        patternState.events.filter(
          (event) => event.sourceId === approvedRequest.id && event.eventType === 'marked_read',
        ).length,
      ).toBe(2);
    });
  });
});
