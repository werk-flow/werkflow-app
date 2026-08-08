import type { Page } from '@playwright/test';

import { expect, test } from './support/fixtures';
import { resolveDailyTargets } from '../../lib/personnel/targets';
import { getBusinessWeekDates } from '../../lib/personnel/schedule';
import {
  countOpenClientRequests,
  getAttentionPatternStateForUser,
  getEmployeeRecordStateByUser,
  getLatestManualTimeEntryState,
  getLatestVacationRequestState,
  getTargetContextForRecord,
  getVacationRequestIdsByStartDate,
  getVisibleAttentionOwnersAs,
} from './support/db';
import {
  addWorkScheduleViaDialog,
  addJobCapabilityRequirement,
  approvePendingTimeEntry,
  assignJobWithQualificationWarning,
  assignRequestAssigneeViaEditDialog,
  attentionNotificationRow,
  attentionTaskLink,
  aufgabenSidebarBadge,
  cancelApprovedVacationForRangeText,
  closeRequestViaDialog,
  confirmResponsibilityPreview,
  createCapabilityViaManagement,
  createJob,
  createOwnManualTimeEntry,
  createOwnVacationRequestViaDialog,
  createRequestViaDialog,
  createResponsibilityDelegationViaSettings,
  endResponsibilityDelegationViaSettings,
  expectVacationOverlapRejectedViaDialog,
  expectVisibleAfterSave,
  markAllAttentionNotificationsReadViaButton,
  markAttentionNotificationReadViaButton,
  openAufgaben,
  openMemberDetailFromList,
  previewResponsibilityChange,
  reportOwnSicknessViaDialog,
  rejectVacationRequestFor,
  cancelSicknessReportViaMenuWithReason,
  visibleText,
  withdrawOwnPendingVacationRequest,
} from './support/steps';

// GG-02 — Schedule, vacation, approval, and attention (@GG-02), the exit gate
// of P1-07. One role-aware task/approval/notification pattern: derived items,
// responsibility-scoped visibility, delegation-following attention, per-item
// deduplication, deep links into the owning surfaces, read markers with an
// append-only pattern audit, and employee transparency.
//
// PLACEMENT DECISION (documented in docs/technical/testing.md): this file
// deliberately sorts AFTER p1-06.spec.ts (option (b) of the P1-07 plan), so
// in the full suite it inherits the suite-end state instead of injecting
// business facts six earlier slice specs would silently inherit. It also runs
// FOCUSED on a fresh world (`--grep @GG-02`), so it never assumes inherited
// rows exist: its first test pins the responsibility state itself (a no-op
// re-selection in the full run) and every count expectation is derived from
// the database at runtime. Inherited full-suite state it tolerates: three
// decided employee vacation requests and one decided Büro request (their
// notifications are read in the first test), the approved future half-day
// vacation (never overlapped by this spec's Tuesday/Wednesday requests), and
// GG-01's one open, unassigned client request.
// The additional cross-domain gate below leaves one cancelled sickness report,
// one run-scoped qualification requirement, and its append-only assignment
// assessment. Later slices use distinct dates/names and derive counts from the
// database, so focused and full-suite execution remain equivalent.

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

function formatGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

// Next week's Monday: strictly after today in every case.
function nextMondayIso(): string {
  const todayIso = berlinTodayIso();
  return shiftIsoDate(todayIso, 7 - weekdayIndex(todayIso));
}

// Months to click "Weiter" from the current month to reach dateIso's month.
function monthsAhead(dateIso: string): number {
  const todayIso = berlinTodayIso();
  const [todayYear, todayMonth] = todayIso.split('-').map(Number);
  const [targetYear, targetMonth] = dateIso.split('-').map(Number);
  return (targetYear - todayYear) * 12 + (targetMonth - todayMonth);
}

async function openCalendarMonthOf(page: Page, dateIso: string): Promise<void> {
  await page.goto('/kalender');
  await page.getByRole('tab', { name: 'Monat' }).click();
  for (let step = 0; step < monthsAhead(dateIso); step++) {
    await page.locator('button[title="Weiter"]').click();
  }
}

// The two GG-02 vacation days: Tuesday and Wednesday after next Monday. They
// can never collide with the inherited approved half-day (always a Monday).
const requestDayIso = () => shiftIsoDate(nextMondayIso(), 1);
const secondRequestDayIso = () => shiftIsoDate(nextMondayIso(), 2);

// Reads a person's decided (notifiable) vacation requests from the database —
// the mode-independent expectation for inherited notification counts.
async function getDecidedRequestCount(
  orgId: string,
  userId: string
): Promise<number> {
  const record = await getEmployeeRecordStateByUser(orgId, userId);
  const byStartDate = await getVacationRequestIdsByStartDate(orgId, record.id);
  return [...byStartDate.values()].filter((request) =>
    ['approved', 'rejected', 'cancelled'].includes(request.status)
  ).length;
}

test.describe('GG-02 Zeitplan, Urlaub, Freigabe und Aufmerksamkeit @GG-02', () => {
  test('Ausgangslage: Verantwortlichkeiten stehen fest; Anfrage-Aufgaben zeigen Zuständigkeit, Deep-Link und nachvollziehbare Auflösung; geerbte Benachrichtigungen werden dedupliziert gelesen', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;

    // Pin the responsibility state this gate builds on. In the full suite this
    // re-selects the holders @P1-05/@P1-06 already left in place (a recorded
    // no-op configuration); in a focused run it replaces the role defaults.
    await previewResponsibilityChange(adminPage, {
      responsibility: 'time_approval',
      selectedNames: [employeeName],
    });
    await confirmResponsibilityPreview(adminPage);
    await previewResponsibilityChange(adminPage, {
      responsibility: 'leave_approval',
      selectedNames: [adminName],
    });
    await confirmResponsibilityPreview(adminPage);

    // A new operational request with an explicit responsible person: the
    // assignment (P1-02 storage) becomes an ownership signal on the surface.
    const requestId = await createRequestViaDialog(adminPage, {
      summary: 'Heizung klopft im Mehrfamilienhaus',
      requestNumber: `ANF-${world.runId}-GG02`,
    });
    await assignRequestAssigneeViaEditDialog(adminPage, bueroName);

    // The assignee sees "Mir zugewiesen", others see the responsible person.
    await openAufgaben(bueroPage);
    const bueroRequestTask = attentionTaskLink(
      bueroPage,
      `Anfrage ANF-${world.runId}-GG02 öffnen`
    );
    await expect(bueroRequestTask).toHaveCount(1);
    await expect(bueroRequestTask.getByText('Mir zugewiesen')).toBeVisible();

    await openAufgaben(adminPage);
    const adminRequestTask = attentionTaskLink(
      adminPage,
      `Anfrage ANF-${world.runId}-GG02 öffnen`
    );
    await expect(adminRequestTask).toHaveCount(1);
    await expect(
      adminRequestTask.getByText(`Zuständig: ${bueroName}`)
    ).toBeVisible();
    // No pending approvals exist yet: those groups are absent, not empty
    // shells, and the admin has no decision notifications.
    await expect(adminPage.getByTestId('attention-time-tasks')).toHaveCount(0);
    await expect(
      adminPage.getByTestId('attention-vacation-tasks')
    ).toHaveCount(0);
    await expect(
      visibleText(adminPage, 'Keine Benachrichtigungen.')
    ).toBeVisible();

    // Deep link into the owning context, resolve it there, and the item
    // disappears — explainable from the request's own history (geschlossen).
    await adminRequestTask.click();
    await adminPage.waitForURL(`**/anfragen/${requestId}`, {
      timeout: 20_000,
    });
    await expect(
      visibleText(adminPage, 'Heizung klopft im Mehrfamilienhaus')
    ).toBeVisible({ timeout: 15_000 });
    await closeRequestViaDialog(adminPage, 'Anderweitig gelöst');
    await openAufgaben(adminPage);
    await expect(
      attentionTaskLink(adminPage, `Anfrage ANF-${world.runId}-GG02 öffnen`)
    ).toHaveCount(0);

    // The employee never sees office request tasks (role boundary) and gets
    // exactly one notification per decided request — none for withdrawn ones.
    // The expected count is derived from the database, so this holds in the
    // inherited full suite (three decided requests) and focused (none) alike.
    const decidedEmployee = await getDecidedRequestCount(
      world.orgId,
      world.users.employee.id
    );
    await openAufgaben(employeePage);
    await expect(
      employeePage.getByTestId('attention-request-tasks')
    ).toHaveCount(0);
    await expect(
      employeePage.locator('[data-notification-source]')
    ).toHaveCount(decidedEmployee);
    if (decidedEmployee > 1) {
      await markAllAttentionNotificationsReadViaButton(employeePage);
    } else if (decidedEmployee === 1) {
      const sourceId = await employeePage
        .locator('[data-notification-source]')
        .getAttribute('data-notification-source');
      await markAttentionNotificationReadViaButton(employeePage, sourceId!);
    }
    const employeePatternState = await getAttentionPatternStateForUser(
      world.orgId,
      world.users.employee.id
    );
    expect(employeePatternState.readStates.length).toBe(decidedEmployee);
    expect(
      employeePatternState.events.filter(
        (event) => event.eventType === 'marked_read'
      ).length
    ).toBe(decidedEmployee);
    // Nothing actionable, nothing unread: no badge at all for the employee.
    await expect(aufgabenSidebarBadge(employeePage)).toHaveCount(0, {
      timeout: 15_000,
    });

    // Büro reads their inherited notification (if any) through the per-item
    // action; afterwards their badge counts exactly the open requests.
    const decidedBuero = await getDecidedRequestCount(
      world.orgId,
      world.users.buero.id
    );
    await openAufgaben(bueroPage);
    await expect(
      bueroPage.locator('[data-notification-source]')
    ).toHaveCount(decidedBuero);
    if (decidedBuero > 1) {
      await markAllAttentionNotificationsReadViaButton(bueroPage);
    } else if (decidedBuero === 1) {
      const sourceId = await bueroPage
        .locator('[data-notification-source]')
        .getAttribute('data-notification-source');
      await markAttentionNotificationReadViaButton(bueroPage, sourceId!);
    }
    const openRequests = await countOpenClientRequests(world.orgId);
    if (openRequests > 0) {
      await expect(aufgabenSidebarBadge(bueroPage)).toHaveText(
        String(openRequests),
        { timeout: 15_000 }
      );
    } else {
      await expect(aufgabenSidebarBadge(bueroPage)).toHaveCount(0, {
        timeout: 15_000,
      });
    }
  });

  test('Vollzeit- und Teilzeit-Wochenpläne ändern die Sollstunden nachvollziehbar', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const tomorrowDigits = toDatePickerDigits(
      shiftIsoDate(berlinTodayIso(), 1)
    );

    // Part-time plan for the employee, full-time plan for Büro — both
    // date-effective from tomorrow so history keeps its old targets.
    await openMemberDetailFromList(adminPage, employeeName);
    await addWorkScheduleViaDialog(adminPage, {
      validFromDigits: tomorrowDigits,
      dayHours: ['6', '6', '6', '6', '6', '0', '0'],
      note: 'GG-02 Teilzeitplan',
    });
    await openMemberDetailFromList(adminPage, bueroName);
    await addWorkScheduleViaDialog(adminPage, {
      validFromDigits: tomorrowDigits,
      dayHours: ['8', '8', '8', '8', '8', '0', '0'],
      note: 'GG-02 Vollzeitplan',
    });

    // Expected weekly targets come from the same stored state and in-code
    // resolver the app uses (holiday-aware, mixed schedule versions). No
    // absence affects the current business week at this point in the suite.
    const weekDates = getBusinessWeekDates();
    for (const [page, user] of [
      [employeePage, world.users.employee],
      [bueroPage, world.users.buero],
    ] as const) {
      const record = await getEmployeeRecordStateByUser(world.orgId, user.id);
      const context = await getTargetContextForRecord(world.orgId, record.id);
      const expectedSollMinutes = resolveDailyTargets(weekDates, context).reduce(
        (total, target) => total + target.targetMinutes,
        0
      );
      if (expectedSollMinutes % 60 === 0) {
        await page.goto('/zeiterfassung');
        await expectVisibleAfterSave(
          page,
          `Soll: ${expectedSollMinutes / 60} Std.`
        );
      }
    }
  });

  test('Zeitfreigabe: die Aufgabe erreicht genau die verantwortliche Person und wird über den Deep-Link entschieden', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;

    // Büro's own manual entry becomes pending (P1-05). time_approval is held
    // by THE EMPLOYEE alone — the attention item must reach the scoped
    // employee holder and must NOT appear for the admin. Yesterday because
    // future times are rejected; 10–11 stays clear of @P1-05's entries.
    await createOwnManualTimeEntry(bueroPage, {
      memberName: bueroName,
      dateDigits: toDatePickerDigits(shiftIsoDate(berlinTodayIso(), -1)),
      clockInDigits: '1000',
      clockOutDigits: '1100',
    });

    await openAufgaben(adminPage);
    await expect(adminPage.getByTestId('attention-time-tasks')).toHaveCount(0);

    await openAufgaben(employeePage);
    const timeTask = attentionTaskLink(
      employeePage,
      `Zeitfreigabe von ${bueroName} öffnen`
    );
    await expect(timeTask).toHaveCount(1);
    await expect(aufgabenSidebarBadge(employeePage)).toHaveText('1', {
      timeout: 15_000,
    });

    // Deep link into the owning surface; the decision runs through the SAME
    // reviewSession action as always.
    await timeTask.click();
    await employeePage.waitForURL('**/zeiterfassung?tab=approvals', {
      timeout: 20_000,
    });
    await expect(
      employeePage.getByTestId('pending-approvals-panel')
    ).toHaveAttribute('data-loaded', 'true', { timeout: 15_000 });
    await approvePendingTimeEntry(employeePage, world.users.buero.id);

    expect(
      (
        await getLatestManualTimeEntryState(world.orgId, world.users.buero.id)
      ).status
    ).toBe('approved');

    // Resolved means gone from the surface — and the badge follows.
    await openAufgaben(employeePage);
    await expect(
      employeePage.getByTestId('attention-time-tasks')
    ).toHaveCount(0);
    await expect(aufgabenSidebarBadge(employeePage)).toHaveCount(0, {
      timeout: 15_000,
    });
  });

  test('Überschneidender Urlaub bleibt blockiert; Zurückziehen bleibt transparent und vorläufige Einträge verschwinden', async ({
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const dayIso = requestDayIso();

    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: toDatePickerDigits(dayIso),
      endDigits: toDatePickerDigits(dayIso),
      comment: 'GG-02 Antrag',
    });

    // Provisional availability: the pending request is visible to planning as
    // a clearly provisional entry.
    await openCalendarMonthOf(employeePage, dayIso);
    await expect(
      visibleText(employeePage, `Urlaub – ${employeeName} (angefragt)`)
    ).toBeVisible({ timeout: 15_000 });

    // Overlapping own leave is impossible (database exclusion constraint).
    await expectVacationOverlapRejectedViaDialog(employeePage, {
      startDigits: toDatePickerDigits(dayIso),
      endDigits: toDatePickerDigits(dayIso),
    });

    // Withdrawal stays traceable and removes the provisional entry.
    await withdrawOwnPendingVacationRequest(employeePage);
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );
    const state = await getLatestVacationRequestState(
      world.orgId,
      employeeRecord.id
    );
    expect(state.status).toBe('withdrawn');
    expect(state.eventTypes).toEqual(['requested', 'withdrawn']);

    await openCalendarMonthOf(employeePage, dayIso);
    await expect(
      employeePage.getByText(`Urlaub – ${employeeName} (angefragt)`)
    ).toHaveCount(0, { timeout: 15_000 });
  });

  test('Vertretung: die Aufmerksamkeit folgt der Delegation ohne Duplikate und endet mit ihr', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const adminName = `${world.users.admin.firstName} ${world.users.admin.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const firstDayIso = requestDayIso();
    const secondDayIso = secondRequestDayIso();
    const todayIso = berlinTodayIso();

    // Re-submitting the withdrawn day is allowed (terminal states don't block).
    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: toDatePickerDigits(firstDayIso),
      endDigits: toDatePickerDigits(firstDayIso),
    });

    // leave_approval is held by the admin alone: only the admin sees the task.
    await openAufgaben(adminPage);
    await expect(
      attentionTaskLink(adminPage, `Urlaubsantrag von ${employeeName} öffnen`)
    ).toHaveCount(1);
    await openAufgaben(bueroPage);
    await expect(
      bueroPage.getByTestId('attention-vacation-tasks')
    ).toHaveCount(0);

    // The admin delegates leave approval to Büro for a bounded window; the
    // attention item follows the delegation — exactly once, never twice.
    await createResponsibilityDelegationViaSettings(adminPage, {
      responsibility: 'leave_approval',
      delegatorName: adminName,
      substituteName: bueroName,
      validFromDigits: toDatePickerDigits(todayIso),
      validUntilDigits: toDatePickerDigits(shiftIsoDate(todayIso, 3)),
    });

    await openAufgaben(bueroPage);
    const bueroVacationTask = attentionTaskLink(
      bueroPage,
      `Urlaubsantrag von ${employeeName} öffnen`
    );
    await expect(bueroVacationTask).toHaveCount(1);
    // Unified badge: the open requests plus exactly one delegated approval.
    const openRequests = await countOpenClientRequests(world.orgId);
    await expect(aufgabenSidebarBadge(bueroPage)).toHaveText(
      String(openRequests + 1),
      { timeout: 15_000 }
    );

    // The substitute decides over the deep link — through the very same
    // decideVacationRequest action and surface as always.
    await bueroVacationTask.click();
    await bueroPage.waitForURL('**/zeiterfassung?tab=approvals', {
      timeout: 20_000,
    });
    const approveButton = bueroPage.getByRole('button', {
      name: `Urlaubsantrag von ${employeeName} genehmigen`,
    });
    await approveButton.click();
    await expect(approveButton).toHaveCount(0, { timeout: 15_000 });

    // Approved availability: the calendar entry loses its provisional suffix.
    await openCalendarMonthOf(bueroPage, firstDayIso);
    await expect(
      visibleText(bueroPage, `Urlaub – ${employeeName}`)
    ).toBeVisible({ timeout: 15_000 });
    await expect(bueroPage.getByText('(angefragt)')).toHaveCount(0);

    // A second request while the delegation is active: both the delegator and
    // the substitute see it exactly once each (two authorization paths exist
    // org-wide; deduplication happens per viewer in the resolver).
    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: toDatePickerDigits(secondDayIso),
      endDigits: toDatePickerDigits(secondDayIso),
    });
    await openAufgaben(adminPage);
    await expect(
      attentionTaskLink(adminPage, `Urlaubsantrag von ${employeeName} öffnen`)
    ).toHaveCount(1);
    await openAufgaben(bueroPage);
    await expect(
      attentionTaskLink(bueroPage, `Urlaubsantrag von ${employeeName} öffnen`)
    ).toHaveCount(1);

    // Ending the delegation removes the substitute's attention immediately;
    // the remaining holder keeps it.
    await endResponsibilityDelegationViaSettings(
      adminPage,
      'leave_approval',
      bueroName
    );
    await openAufgaben(bueroPage);
    await expect(
      bueroPage.getByTestId('attention-vacation-tasks')
    ).toHaveCount(0, { timeout: 15_000 });
    await openAufgaben(adminPage);
    await expect(
      attentionTaskLink(adminPage, `Urlaubsantrag von ${employeeName} öffnen`)
    ).toHaveCount(1);
  });

  test('Eine Benachrichtigung pro Antrag: erneute Entscheidung macht sie wieder ungelesen statt sie zu duplizieren; das Muster-Audit ist lückenlos', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const firstDayIso = requestDayIso();
    const secondDayIso = secondRequestDayIso();
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );

    // The remaining holder rejects the second request with a reason.
    await rejectVacationRequestFor(
      adminPage,
      employeeName,
      'Personalengpass im Zeitraum'
    );

    const requestsByDay = await getVacationRequestIdsByStartDate(
      world.orgId,
      employeeRecord.id
    );
    const approvedRequest = requestsByDay.get(firstDayIso);
    const rejectedRequest = requestsByDay.get(secondDayIso);
    expect(approvedRequest?.status).toBe('approved');
    expect(rejectedRequest?.status).toBe('rejected');

    // The employee gets exactly one notification per decided request.
    await openAufgaben(employeePage);
    const approvedRow = attentionNotificationRow(
      employeePage,
      approvedRequest!.id
    );
    const rejectedRow = attentionNotificationRow(
      employeePage,
      rejectedRequest!.id
    );
    await expect(approvedRow).toHaveCount(1);
    await expect(approvedRow).toHaveAttribute('data-unread', 'true');
    await expect(rejectedRow).toHaveCount(1);
    await expect(rejectedRow.getByText('wurde abgelehnt.')).toBeVisible();
    await expect(
      rejectedRow.getByText('Personalengpass im Zeitraum')
    ).toBeVisible();

    await markAttentionNotificationReadViaButton(
      employeePage,
      approvedRequest!.id
    );
    await markAttentionNotificationReadViaButton(
      employeePage,
      rejectedRequest!.id
    );
    await expect(aufgabenSidebarBadge(employeePage)).toHaveCount(0, {
      timeout: 15_000,
    });

    // Retroactive correction: cancelling the approved request re-surfaces the
    // SAME notification as unread — never a second row. The range text
    // disambiguates from any other approved vacation of the same person.
    await cancelApprovedVacationForRangeText(
      adminPage,
      employeeName,
      formatGermanDate(firstDayIso),
      'Projekttermin verschoben'
    );

    await openAufgaben(employeePage);
    await expect(approvedRow).toHaveCount(1, { timeout: 15_000 });
    await expect(approvedRow).toHaveAttribute('data-unread', 'true', {
      timeout: 15_000,
    });
    await expect(approvedRow.getByText('wurde storniert.')).toBeVisible();
    await expect(
      approvedRow.getByText('Projekttermin verschoben')
    ).toBeVisible();
    await expect(aufgabenSidebarBadge(employeePage)).toHaveText('1', {
      timeout: 15_000,
    });
    await markAttentionNotificationReadViaButton(
      employeePage,
      approvedRequest!.id
    );

    // Domain audit: the owning tables explain every disappearance. The
    // latest-created request is the rejected one; the cancelled one keeps its
    // terminal status in the request lookup.
    const latestState = await getLatestVacationRequestState(
      world.orgId,
      employeeRecord.id
    );
    expect(latestState.eventTypes).toEqual(['requested', 'rejected']);
    const requestsAfterCancel = await getVacationRequestIdsByStartDate(
      world.orgId,
      employeeRecord.id
    );
    expect(requestsAfterCancel.get(firstDayIso)?.status).toBe('cancelled');

    // Pattern audit: the read marker moved through both versions of the
    // approved request (approved → cancelled), each transition recorded.
    const patternState = await getAttentionPatternStateForUser(
      world.orgId,
      world.users.employee.id
    );
    const approvedReadState = patternState.readStates.find(
      (readState) => readState.sourceId === approvedRequest!.id
    );
    expect(approvedReadState?.stateVersion.startsWith('cancelled:')).toBe(true);
    expect(
      patternState.events.filter(
        (event) =>
          event.sourceId === approvedRequest!.id &&
          event.eventType === 'marked_read'
      ).length
    ).toBe(2);
  });

  test('Krankmeldung und Qualifikationswarnung bleiben getrennte, nachvollziehbare Betriebsfakten', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const sicknessDayIso = shiftIsoDate(berlinTodayIso(), -2);
    const sicknessRangeText = formatGermanDate(sicknessDayIso);

    await reportOwnSicknessViaDialog(employeePage, {
      startDigits: toDatePickerDigits(sicknessDayIso),
      endDigits: toDatePickerDigits(sicknessDayIso),
    });
    await openMemberDetailFromList(adminPage, employeeName);
    await cancelSicknessReportViaMenuWithReason(
      adminPage,
      sicknessRangeText,
      'GG-02 getrennte Domänenprüfung'
    );

    const capabilityName = `GG-02 Fachkunde ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-GG02-QUAL`;
    await createCapabilityViaManagement(adminPage, {
      name: capabilityName,
      kind: 'Fähigkeit',
    });
    await createJob(adminPage, {
      jobNumber,
      title: 'GG-02 Qualifikationshinweis',
    });
    await addJobCapabilityRequirement(adminPage, {
      jobNumber,
      capabilityName,
    });
    await assignJobWithQualificationWarning(adminPage, {
      jobNumber,
      employeeName,
      expectedStatus: 'Nicht hinterlegt',
      overrideReason: 'Qualifizierte Begleitung ist eingeplant',
    });
  });

  test('RLS und Organisationsgrenzen: Lesemarken streng persönlich, Musterereignisse selbst-oder-Manager, Außenstehende sehen nichts', async ({
    outsiderPage,
    world,
  }) => {
    // Real-credential RLS: the employee sees exactly their own read markers
    // and events; the admin sees NO foreign read markers (strictly personal)
    // but does see pattern events as a manager; outsiders see nothing.
    const employeeView = await getVisibleAttentionOwnersAs(
      world.users.employee,
      world.orgId
    );
    expect(employeeView.readStateUserIds).toEqual([world.users.employee.id]);
    expect(employeeView.eventUserIds).toEqual([world.users.employee.id]);

    const adminView = await getVisibleAttentionOwnersAs(
      world.users.admin,
      world.orgId
    );
    expect(adminView.readStateUserIds).toEqual([]);
    expect(adminView.eventUserIds).toContain(world.users.employee.id);

    const outsiderView = await getVisibleAttentionOwnersAs(
      world.outsider.admin,
      world.orgId
    );
    expect(outsiderView.readStateUserIds).toEqual([]);
    expect(outsiderView.eventUserIds).toEqual([]);

    // The outsider organization's surface is honestly empty — the calm
    // deploy-day state every real organization starts in.
    await openAufgaben(outsiderPage);
    await expect(
      visibleText(outsiderPage, 'Keine offenen Aufgaben.')
    ).toBeVisible();
    await expect(
      visibleText(outsiderPage, 'Keine Benachrichtigungen.')
    ).toBeVisible();
    await expect(aufgabenSidebarBadge(outsiderPage)).toHaveCount(0);
  });
});
