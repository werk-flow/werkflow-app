import type { Page } from '@playwright/test';

import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { VACATION_STATUS_LABELS } from '../../../lib/vacation/types';
import { expect, test } from '../support/fixtures';
import { berlinDateAtOffset, ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { getAttentionPatternStateForUser } from '../../golden/support/db/attention';
import { getPlanningState } from '../../golden/support/db/calendar';
import { getEmployeeRecordStateByUser } from '../../golden/support/db/personnel';
import { getCapabilityHistoryState, getJobQualificationState } from '../../golden/support/db/qualifications';
import { createAdminClient } from '../../golden/support/db/shared';
import { getLatestManualTimeEntryState } from '../../golden/support/db/time-tracking';
import { getVacationRequestIdsByStartDate } from '../../golden/support/db/vacation';
import {
  attentionNotificationRow,
  decisionReason,
  markAllAttentionNotificationsReadViaButton,
  markAttentionNotificationReadViaButton,
  openAufgaben,
  qualificationExpiresSoon,
  qualificationNoticeLink,
  sidebarBadge,
  type SidebarBadgeTarget,
  taskOpenSince,
  taskResponsible,
  unreadNotificationRows,
} from '../../golden/support/steps/attention';
import {
  createPlannedCalendarEntry,
  dragPlanningMonthEvent,
  openPlanningCreationDialog,
  plannedCalendarEvent,
  planningTeamSearch,
  planningWarningReason,
  planningWarningRevert,
  planningWarningSave,
  showPlanningMonth,
} from '../../golden/support/steps/calendar';
import {
  addConditionViaDialog,
  createPersonnelRecordViaDialog,
  openMemberDetailFromList,
} from '../../golden/support/steps/personnel';
import {
  addFutureTeamMemberViaManagement,
  addJobCapabilityRequirement,
  addTeamMemberViaManagement,
  apprenticeNotice,
  apprenticeWarningToggle,
  assignCapabilityViaManagement,
  assignDespiteWarningButton,
  coverageContributor,
  coverageStatusLabel,
  createCapabilityViaManagement,
  createTeamViaManagement,
  dissolveTeamViaManagement,
  missingReasonError,
  noCoveringPerson,
  openManagementTab,
  ownValidityLabel,
  renewControlText,
  setApprenticeWarningViaManagement,
  teamMemberSkippedNotice,
  teamShortcut,
} from '../../golden/support/steps/qualifications';
import { createRequestViaDialog } from '../../golden/support/steps/requests';
import { dismissDialog } from '../../golden/support/steps/interaction';
import {
  employeeAssignmentHeading,
  employeeAssignmentPicker,
  employeeAssignmentSearch,
  openEmployeeAssignmentDialog,
  planningWarningDialog,
  qualificationOverrideReason,
  qualificationWarningDialog,
  SHARED_COPY,
  testData,
  textInDom,
  visibleText,
} from '../../golden/support/steps/shared';
import {
  approvePendingTimeEntry,
  createOwnManualTimeEntry,
  pendingApprovalsPanel,
} from '../../golden/support/steps/time-tracking';
import {
  approveVacationRequestFor,
  cancelApprovedVacationForRangeText,
  createOwnVacationRequestViaDialog,
  rejectVacationRequestFor,
} from '../../golden/support/steps/vacation';
import { createJob, jobEditDialogTitle, openJobEditDialog } from '../../golden/support/steps/work';
import { monthDayShowing } from '../../golden/support/plantafel';
import {
  aufgabenDecisionButtons,
  noTeamFound,
  ownQualificationCard,
  ownRequestRow,
  pickerListbox,
  qualificationCoverageRow,
  qualificationWarningGapRow,
  taskRowByText,
  taskRows,
  teamOption,
  visibleStrongestQualificationEntry,
  visibleSearchResult,
} from '../support/a5-steps';

// A5 — Aufgaben & Qualifikationen (P1-07, P1-09). The edge cases and role
// variants around the attention and qualification goldens: request age, badge
// arithmetic, "Meine Anträge" with reasons, bulk reading, team date
// effectiveness and dissolution, the five coverage states, the apprentice
// notice and the edit and drag paths. Every test creates its own records and
// every business mutation runs through the real UI; database reads below are
// assertion state only. Owned run-day offsets: +40 … +44. The manual time
// entry lies on the previous day because the dialog rejects future times.

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

function formatGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

function isWeekday(dateIso: string): boolean {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined)
    throw new Error(`Invalid ISO date: ${dateIso}`);
  const jsWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsWeekday !== 0 && jsWeekday !== 6;
}

// The first N weekday offsets inside A5's owned +40 … +44 reserve. Vacation
// requests must land on weekdays so counting is deterministic in every run
// week (weekends never consume vacation).
function ownedWeekdayDates(count: number): string[] {
  const dates: string[] = [];
  for (let offset = 40; offset <= 44 && dates.length < count; offset += 1) {
    const dateIso = ownedBerlinDateAtOffset('a5-aufgaben-qualifikationen', offset);
    if (isWeekday(dateIso)) dates.push(dateIso);
  }
  if (dates.length < count) {
    throw new Error('A5: not enough weekdays inside the owned +40…+44 window');
  }
  return dates;
}

// Audit-local read-only database observers (A5 only).

async function getTeamStateByName(
  orgId: string,
  teamName: string,
): Promise<{
  id: string;
  dissolvedAt: string | null;
  memberships: Array<{
    employeeRecordId: string;
    validFrom: string;
    validUntil: string | null;
  }>;
  eventTypes: string[];
}> {
  const admin = createAdminClient();
  const { data: team, error } = await admin
    .from('teams')
    .select('id, dissolved_at')
    .eq('organization_id', orgId)
    .eq('name', teamName)
    .single();
  if (error || !team) {
    throw new Error(`Team lookup failed for ${teamName}: ${error?.message}`);
  }
  const [membershipsResult, eventsResult] = await Promise.all([
    admin
      .from('team_memberships')
      .select('employee_record_id, valid_from, valid_until')
      .eq('organization_id', orgId)
      .eq('team_id', team.id)
      .order('valid_from', { ascending: true }),
    admin
      .from('team_events')
      .select('event_type, created_at')
      .eq('organization_id', orgId)
      .eq('team_id', team.id)
      .order('created_at', { ascending: true }),
  ]);
  if (membershipsResult.error || eventsResult.error) {
    throw new Error('Team state lookup failed');
  }
  return {
    id: team.id as string,
    dissolvedAt: team.dissolved_at as string | null,
    memberships: (membershipsResult.data ?? []).map((row) => ({
      employeeRecordId: row.employee_record_id as string,
      validFrom: row.valid_from as string,
      validUntil: row.valid_until as string | null,
    })),
    eventTypes: (eventsResult.data ?? []).map((row) => row.event_type as string),
  };
}

async function getJobAssignmentUserIds(orgId: string, jobNumber: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select('id')
    .eq('organization_id', orgId)
    .eq('job_number', jobNumber)
    .single();
  if (jobError || !job) {
    throw new Error(`Job lookup failed for ${jobNumber}: ${jobError?.message}`);
  }
  const { data, error } = await admin.from('job_assignments').select('user_id').eq('job_id', job.id);
  if (error) throw new Error(`Assignment lookup failed: ${error.message}`);
  return (data ?? []).map((row) => row.user_id as string).sort();
}

// ---------------------------------------------------------------------------
// Sidebar badge helpers. The Aufgaben badge counts actionable items plus
// unread notifications; the Zeiterfassung badge counts pending time and
// vacation approvals for the viewer (never anything the viewer cannot decide).
// ---------------------------------------------------------------------------

async function readBadgeCount(page: Page, href: SidebarBadgeTarget): Promise<number> {
  const badge = sidebarBadge(page, href);
  if ((await badge.count()) === 0) return 0;
  const text = (await badge.textContent())?.trim() ?? '';
  return text === '' ? 0 : Number(text);
}

async function expectBadgeCount(page: Page, href: SidebarBadgeTarget, expected: number): Promise<void> {
  await expect.poll(async () => readBadgeCount(page, href), { timeout: 20_000 }).toBe(expected);
}

test.describe('A5 Aufgaben und Qualifikationen @AUDIT-W1-A5', () => {
  test('A5-01/A5-02/A5-03/A5-04: Aufgabenseite zeigt Alter und Zuständigkeit, Meine Anträge tragen Status und Gründe, Sammel-Lesen ist deterministisch und beide Badges zählen ehrlich [P1-07-F01/P1-07-F02/P1-07-F03]', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const [firstDayIso, secondDayIso] = ownedWeekdayDates(2);
    if (!firstDayIso || !secondDayIso) throw new Error('A5: expected two owned weekday dates');
    const rejectionReason = testData`A5 Personalplanung im Zeitraum ${world.runId}`;

    // Baseline before any A5 fact exists: inherited state is never assumed
    // empty, so every badge expectation is a delta from this runtime baseline.
    await adminPage.goto('/aufgaben');
    const adminZeitBaseline = await readBadgeCount(adminPage, '/zeiterfassung');

    // Büro's own manual entry becomes pending (P1-05 four-eyes). The previous
    // day 12:15–12:45 stays clear of every documented inherited slot.
    await createOwnManualTimeEntry(bueroPage, {
      memberName: `${world.users.buero.firstName} ${world.users.buero.lastName}`,
      dateDigits: toDatePickerDigits(berlinDateAtOffset(-1)),
      clockInDigits: '1215',
      clockOutDigits: '1245',
    });
    expect((await getLatestManualTimeEntryState(world.orgId, world.users.buero.id)).status).toBe('pending');
    // The Zeiterfassung badge counts the new pending TIME approval …
    await expectBadgeCount(adminPage, '/zeiterfassung', adminZeitBaseline + 1);

    // … and the new pending VACATION approval on top: both classes count.
    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: toDatePickerDigits(firstDayIso),
      endDigits: toDatePickerDigits(firstDayIso),
      comment: `A5 Antrag 1 ${world.runId}`,
    });
    await expectBadgeCount(adminPage, '/zeiterfassung', adminZeitBaseline + 2);

    // The employee can decide neither of those items: their Zeiterfassung
    // badge must not count them (it shows nothing at all for this viewer).
    await employeePage.goto('/aufgaben');
    await expect(sidebarBadge(employeePage, '/zeiterfassung')).toHaveCount(0);

    // An A5-owned request received YESTERDAY: the task row must expose the
    // derived age together with the responsible person.
    const requestNumber = `ANF-${world.runId}-A5`;
    await createRequestViaDialog(adminPage, {
      summary: `A5 Heizungswartung Rückfrage ${world.runId}`,
      requestNumber,
      receivedAtLocal: `${berlinDateAtOffset(-1)}T10:00`,
      assigneeName: `${world.users.buero.firstName} ${world.users.buero.lastName}`,
    });
    await openAufgaben(adminPage);
    const adminRequestTask = taskRowByText(adminPage, requestNumber);
    await expect(adminRequestTask).toHaveCount(1, { timeout: 15_000 });
    await expect(taskOpenSince(adminRequestTask, 1)).toBeVisible();
    await expect(
      taskResponsible(adminRequestTask, `${world.users.buero.firstName} ${world.users.buero.lastName}`),
    ).toBeVisible();

    // Decisions never happen on /aufgaben: the page offers no approve/reject
    // control anywhere — every task row is a deep link only.
    await expect(aufgabenDecisionButtons(adminPage)).toHaveCount(0);

    // The Aufgaben badge is exactly "actionable + unread" — asserted as a
    // page-internal equality that is valid in fresh and inherited runs alike.
    // The badge and the rows settle from separate reads (a notification row can render after its
    // badge count), so the equality is polled over all three together.
    await expect
      .poll(
        async () =>
          (await readBadgeCount(adminPage, '/aufgaben')) -
          (await taskRows(adminPage).count()) -
          (await unreadNotificationRows(adminPage).count()),
        { timeout: 20_000 },
      )
      .toBe(0);

    // Meine Anträge (employee transparency): the pending request is listed
    // with range, day count and status.
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const pendingRequests = await getVacationRequestIdsByStartDate(world.orgId, employeeRecord.id);
    const firstRequest = pendingRequests.get(firstDayIso);
    expect(firstRequest?.status).toBe('pending');
    await openAufgaben(employeePage);
    const firstOwnRow = ownRequestRow(employeePage, expectDefined(firstRequest, 'the first A5 request').id);
    await expect(firstOwnRow).toHaveCount(1, { timeout: 15_000 });
    await expect(firstOwnRow.getByText(formatGermanDate(firstDayIso))).toBeVisible();
    await expect(firstOwnRow.getByText(VACATION_STATUS_LABELS.pending)).toBeVisible();

    // Decide both requests sequentially (approve first, then submit and
    // reject the second) so each approver control is unambiguous.
    await approveVacationRequestFor(adminPage, employeeName);
    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: toDatePickerDigits(secondDayIso),
      endDigits: toDatePickerDigits(secondDayIso),
    });
    await rejectVacationRequestFor(adminPage, employeeName, rejectionReason);
    // Both vacation approvals are gone; only Büro's time entry remains.
    await expectBadgeCount(adminPage, '/zeiterfassung', adminZeitBaseline + 1);

    const decidedRequests = await getVacationRequestIdsByStartDate(world.orgId, employeeRecord.id);
    const approvedRequest = expectDefined(decidedRequests.get(firstDayIso), 'the approved A5 request');
    const rejectedRequest = expectDefined(decidedRequests.get(secondDayIso), 'the rejected A5 request');
    expect(approvedRequest.status).toBe('approved');
    expect(rejectedRequest.status).toBe('rejected');

    // With two unread decision notifications the bulk action is deterministically available.
    await openAufgaben(employeePage);
    const approvedRow = attentionNotificationRow(employeePage, approvedRequest.id);
    const rejectedRow = attentionNotificationRow(employeePage, rejectedRequest.id);
    await expect(approvedRow).toHaveAttribute('data-unread', 'true', { timeout: 15_000 });
    await expect(rejectedRow).toHaveAttribute('data-unread', 'true');

    // Employee badge equality: nothing actionable for this viewer, so the
    // badge equals the unread notification count. The badge and the rows
    // settle from separate reads, so both are read together in one poll.
    await expect
      .poll(
        async () => {
          const unread = await unreadNotificationRows(employeePage).count();
          const badge = await readBadgeCount(employeePage, '/aufgaben');
          return { atLeastTwoUnread: unread >= 2, badgeMinusUnread: badge - unread };
        },
        { timeout: 20_000 },
      )
      .toEqual({ atLeastTwoUnread: true, badgeMinusUnread: 0 });

    // "Alle als gelesen markieren" clears every unread row at once.
    await markAllAttentionNotificationsReadViaButton(employeePage);
    await expect(sidebarBadge(employeePage, '/aufgaben')).toHaveCount(0, {
      timeout: 15_000,
    });
    const patternState = await getAttentionPatternStateForUser(world.orgId, world.users.employee.id);
    for (const sourceId of [approvedRequest.id, rejectedRequest.id]) {
      expect(patternState.readStates.some((state) => state.sourceId === sourceId)).toBe(true);
      expect(
        patternState.events.some((event) => event.sourceId === sourceId && event.eventType === 'marked_read'),
      ).toBe(true);
    }

    // Meine Anträge carries status AND the decision reason (P1-07-F01).
    const approvedOwnRow = ownRequestRow(employeePage, approvedRequest.id);
    const rejectedOwnRow = ownRequestRow(employeePage, rejectedRequest.id);
    await expect(approvedOwnRow.getByText(VACATION_STATUS_LABELS.approved)).toBeVisible({
      timeout: 15_000,
    });
    await expect(rejectedOwnRow.getByText(VACATION_STATUS_LABELS.rejected)).toBeVisible();
    await expect(decisionReason(rejectedOwnRow, rejectionReason)).toBeVisible();

    // Retroactive correction: cancelling the approved request surfaces the
    // CANCELLATION reason in Meine Anträge (the cancelled branch of the
    // decision-reason contract).
    const cancellationReason = `A5 Projekttermin verschoben ${world.runId}`;
    await cancelApprovedVacationForRangeText(
      adminPage,
      employeeName,
      formatGermanDate(firstDayIso),
      cancellationReason,
    );
    await openAufgaben(employeePage);
    await expect(approvedOwnRow.getByText(VACATION_STATUS_LABELS.cancelled)).toBeVisible({
      timeout: 15_000,
    });
    await expect(decisionReason(approvedOwnRow, cancellationReason)).toBeVisible();
    // The re-surfaced unread notification is read again so A5 leaves no
    // unread employee state behind.
    await markAttentionNotificationReadViaButton(employeePage, approvedRequest.id);

    // Approving Büro's entry returns the Zeiterfassung badge exactly to its baseline.
    await adminPage.goto('/zeiterfassung?tab=approvals');
    await expect(pendingApprovalsPanel(adminPage)).toHaveAttribute('data-loaded', 'true', {
      timeout: 15_000,
    });
    await approvePendingTimeEntry(adminPage, world.users.buero.id);
    expect((await getLatestManualTimeEntryState(world.orgId, world.users.buero.id)).status).toBe('approved');
    await expectBadgeCount(adminPage, '/zeiterfassung', adminZeitBaseline);
  });

  test('A5-05/A5-06: Teams sind datumswirksame Planungs-Abkürzungen — Büro legt an, Ausweis ohne Zugang wird sichtbar übersprungen, der Kalender plant Personal ohne Zugang mit ein und die Auflösung erhält die Historie [P1-09-F01/P1-09-F02]', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const todayIso = berlinDateAtOffset(0);
    const teamName = testData`A5 Einsatzteam ${world.runId}`;
    const bueroSkillName = `A5 Disposition ${world.runId}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const noLoginName = `Paula Papier-${world.runId}`;
    const futureFromIso = ownedBerlinDateAtOffset('a5-aufgaben-qualifikationen', 44);
    const planningDateIso = ownedBerlinDateAtOffset('a5-aufgaben-qualifikationen', 42);
    const jobNumber = `A5-TEAM-${world.runId}`;

    // Büro/Admin maintain teams and the qualification catalog: Büro performs
    // both creations through the same management surface.
    await createTeamViaManagement(bueroPage, teamName);
    await createCapabilityViaManagement(bueroPage, {
      name: bueroSkillName,
      kind: 'skill',
    });

    // A5-owned personnel record WITHOUT login, created through the real UI —
    // A5 never relies on earlier sessions' fixtures.
    await createPersonnelRecordViaDialog(adminPage, {
      firstName: 'Paula',
      lastName: `Papier-${world.runId}`,
    });

    // Memberships: active (employee, today), active without login (Paula),
    // and future-effective (Büro from +44 — not active on any A5 date).
    await addTeamMemberViaManagement(adminPage, {
      teamName,
      employeeName,
      validFrom: todayIso,
    });
    await addTeamMemberViaManagement(adminPage, {
      teamName,
      employeeName: noLoginName,
      validFrom: todayIso,
    });
    // The management card lists only CURRENT members, so the future window is
    // added inline and verified against the persisted membership row.
    await addFutureTeamMemberViaManagement(adminPage, {
      teamName,
      employeeName: bueroName,
      validFrom: futureFromIso,
    });
    const bueroRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.buero.id);
    await expect
      .poll(
        async () =>
          (await getTeamStateByName(world.orgId, teamName)).memberships.some(
            (membership) =>
              membership.employeeRecordId === bueroRecord.id && membership.validFrom === futureFromIso,
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    // Date-effectiveness in the management view: the future member is not a
    // current member row.
    await expect(
      adminPage
        .getByTestId('team-card')
        .filter({ hasText: teamName })
        .getByTestId('team-member-row')
        .filter({ hasText: bueroName }),
    ).toHaveCount(0);

    // Job-dialog expansion: one click selects all CURRENTLY ACTIVE members;
    // the person without login is visibly skipped, the future member is not
    // yet part of the expansion.
    await createJob(adminPage, {
      jobNumber,
      title: `A5 Teamauftrag ${world.runId}`,
    });
    await adminPage.goto(`/auftraege/${jobNumber}`);
    const assignmentDialog = await openEmployeeAssignmentDialog(adminPage);
    await teamShortcut(assignmentDialog, teamName).click();
    await expect(teamMemberSkippedNotice(adminPage, noLoginName)).toBeVisible({ timeout: 15_000 });
    await expect(employeeAssignmentPicker(assignmentDialog, 1)).toBeVisible();
    await assignmentDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
    await expect(assignmentDialog).toHaveCount(0, { timeout: 15_000 });
    expect(await getJobAssignmentUserIds(world.orgId, jobNumber)).toEqual([world.users.employee.id]);

    // Calendar expansion: the planner works on employee records, so the team
    // click plans BOTH currently active members — including the person
    // without login (plannable since P1-11) — and still excludes the future
    // member on the planned date.
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: jobNumber,
      date: planningDateIso,
      time: '06:00',
      durationHours: 1,
      teamNames: [teamName],
      overrideReason: 'A5 Teamplanung bewusst bestätigt und begründet.',
    });
    const planningState = await getPlanningState(world.orgId, { jobNumber });
    expect(planningState.occurrenceCount).toBe(1);
    expect(planningState.assignmentCount).toBe(2);
    await showPlanningMonth(bueroPage, planningDateIso);
    await expect(plannedCalendarEvent(bueroPage, testData`A5 Teamauftrag ${world.runId}`)).toBeVisible({
      timeout: 20_000,
    });

    // Dissolution keeps the history: the team disappears from every picker,
    // rows/events/assignments stay durable.
    const stateBefore = await getTeamStateByName(world.orgId, teamName);
    expect(stateBefore.dissolvedAt).toBeNull();
    expect(stateBefore.memberships).toHaveLength(3);
    await dissolveTeamViaManagement(adminPage, teamName);
    await expect(visibleText(adminPage, teamName)).toBeVisible();
    await expect(adminPage.getByTestId('team-card').filter({ hasText: teamName })).toHaveCount(0);

    const stateAfter = await getTeamStateByName(world.orgId, teamName);
    expect(stateAfter.dissolvedAt).not.toBeNull();
    expect(stateAfter.memberships).toHaveLength(3);
    expect(stateAfter.eventTypes).toContain('dissolved');
    // Already-created work survives the dissolution untouched.
    expect(await getJobAssignmentUserIds(world.orgId, jobNumber)).toEqual([world.users.employee.id]);
    expect((await getPlanningState(world.orgId, { jobNumber })).assignmentCount).toBe(2);

    // No picker offers the dissolved team anymore: job assignment dialog …
    await adminPage.goto(`/auftraege/${jobNumber}`);
    const reopenedDialog = await openEmployeeAssignmentDialog(adminPage);
    await expect(reopenedDialog).toBeVisible({ timeout: 15_000 });
    await expect(teamShortcut(reopenedDialog, teamName)).toHaveCount(0);
    await dismissDialog(reopenedDialog);
    // … and the calendar planning dialog.
    const planningDialog = await openPlanningCreationDialog(adminPage);
    await expect(planningDialog.locator('#planning-date')).toBeVisible({
      timeout: 15_000,
    });
    // The team picker is a searchable multi-select; its popover portals
    // outside the dialog.
    await planningDialog.locator('#planning-teams').click();
    await planningTeamSearch(adminPage).fill(teamName);
    await expect(noTeamFound(adminPage)).toBeVisible({ timeout: 15_000 });
    await expect(teamOption(adminPage, teamName)).toHaveCount(0);
    // Escape closes the picker popover first, then the dialog.
    await dismissDialog(pickerListbox(adminPage));
    await dismissDialog(planningDialog);
  });

  test('A5-07/A5-08/A5-09/A5-10: Fünf Abdeckungszustände mit stärkster Person, Mehrfach-Warnung mit Pflichtgrund, Azubi-Standard aus, rechtzeitiger Ablaufhinweis; Bearbeitungsdialog und Kalender-Drag prüfen erneut und die Eigenansicht bleibt nur lesend [P1-09-F02/P1-09-F03/P1-09-F04/P1-09-F05/P1-09-F06]', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const plannedDateIso = ownedBerlinDateAtOffset('a5-aufgaben-qualifikationen', 43);
    const dragTargetIso = ownedBerlinDateAtOffset('a5-aufgaben-qualifikationen', 44);
    const jobNumber = `A5-QUAL-${world.runId}`;
    const accompaniedJobNumber = `A5-BEGL-${world.runId}`;

    const coveredSkill = testData`A5 Grundmontage ${world.runId}`;
    const unconfirmedCert = testData`A5 Gasgeräte ${world.runId}`;
    const expiredCert = testData`A5 Kältemittel ${world.runId}`;
    const futureSkill = testData`A5 Hydraulik ${world.runId}`;
    const missingSkill = testData`A5 Elektro ${world.runId}`;
    const approachingCert = testData`A5 Brandschutz ${world.runId}`;
    const jobTitle = testData`A5 Qualifikationsmatrix ${world.runId}`;

    await test.step('Fünf Abdeckungszustände, Mehrfach-Warnung mit Pflichtgrund, Azubi-Standard aus und rechtzeitiger Ablaufhinweis', async () => {
      // The apprentice warning is OFF by default and only the admin controls it.
      await openManagementTab(bueroPage, 'qualifications');
      await expect(apprenticeWarningToggle(bueroPage)).toBeDisabled({
        timeout: 15_000,
      });
      await openManagementTab(adminPage, 'qualifications');
      const apprenticeCheckbox = apprenticeWarningToggle(adminPage);
      await expect(apprenticeCheckbox).toBeVisible({ timeout: 15_000 });
      await expect(apprenticeCheckbox).not.toBeChecked();
      await setApprenticeWarningViaManagement(adminPage, true);

      // The employee becomes an apprentice from the planned date on (+43 —
      // clear of every earlier session's condition key).
      await openMemberDetailFromList(adminPage, employeeName);
      await addConditionViaDialog(adminPage, {
        validFromDigits: toDatePickerDigits(plannedDateIso),
        employmentTypeLabel: 'Ausbildung',
        note: `A5 Ausbildungs-Hinweis ${world.runId}`,
      });

      // Catalog and person records producing all five coverage states on the
      // planned date, plus one certification inside its expiry warning window.
      await createCapabilityViaManagement(adminPage, {
        name: coveredSkill,
        kind: 'skill',
      });
      await createCapabilityViaManagement(adminPage, {
        name: unconfirmedCert,
        kind: 'certification',
        warningDays: 30,
      });
      await createCapabilityViaManagement(adminPage, {
        name: expiredCert,
        kind: 'certification',
        warningDays: 30,
      });
      await createCapabilityViaManagement(adminPage, {
        name: futureSkill,
        kind: 'skill',
      });
      await createCapabilityViaManagement(adminPage, {
        name: missingSkill,
        kind: 'skill',
      });
      await createCapabilityViaManagement(adminPage, {
        name: approachingCert,
        kind: 'certification',
        warningDays: 30,
      });
      await assignCapabilityViaManagement(adminPage, {
        employeeName,
        capabilityName: coveredSkill,
        validFrom: berlinDateAtOffset(-30),
      });
      await assignCapabilityViaManagement(adminPage, {
        employeeName,
        capabilityName: unconfirmedCert,
        validFrom: berlinDateAtOffset(-30),
        validUntil: berlinDateAtOffset(365),
        evidence: 'pending',
      });
      await assignCapabilityViaManagement(adminPage, {
        employeeName,
        capabilityName: expiredCert,
        validFrom: berlinDateAtOffset(-60),
        validUntil: berlinDateAtOffset(-1),
      });
      await assignCapabilityViaManagement(adminPage, {
        employeeName,
        capabilityName: futureSkill,
        validFrom: dragTargetIso,
      });
      await assignCapabilityViaManagement(adminPage, {
        employeeName,
        capabilityName: approachingCert,
        validFrom: berlinDateAtOffset(-300),
        validUntil: berlinDateAtOffset(10),
        confirmed: true,
        evidence: 'received',
      });

      // Timely expiry attention: the certification is NOT expired yet, but it
      // is inside its warning window — admin AND Büro get the notice on
      // /aufgaben with a deep link into the qualification.
      const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
      const approachingHistory = await getCapabilityHistoryState(
        world.orgId,
        employeeRecord.id,
        approachingCert,
      );
      expect(approachingHistory.rows).toHaveLength(1);
      const [approachingRow] = approachingHistory.rows;
      if (!approachingRow) throw new Error('A5: expected one approaching certification row');
      const approachingRecordId = approachingRow.id;
      for (const page of [adminPage, bueroPage]) {
        await openAufgaben(page);
        const notice = attentionNotificationRow(page, approachingRecordId);
        await expect(notice).toHaveCount(1, { timeout: 15_000 });
        await expect(qualificationExpiresSoon(notice)).toBeVisible();
        await expect(notice.getByText(approachingCert)).toBeVisible();
        await expect(qualificationNoticeLink(notice)).toHaveAttribute(
          'href',
          `/mitarbeiter/${employeeRecord.id}`,
        );
      }
      await markAttentionNotificationReadViaButton(adminPage, approachingRecordId);

      // Job with five requirements evaluated on its planned date.
      await createJob(adminPage, {
        jobNumber,
        title: jobTitle,
        plannedDateDigits: toDatePickerDigits(plannedDateIso),
      });
      await addJobCapabilityRequirement(adminPage, {
        jobNumber,
        capabilityName: coveredSkill,
      });
      await addJobCapabilityRequirement(adminPage, {
        jobNumber,
        capabilityName: unconfirmedCert,
        requireConfirmation: true,
      });
      await addJobCapabilityRequirement(adminPage, {
        jobNumber,
        capabilityName: expiredCert,
      });
      await addJobCapabilityRequirement(adminPage, {
        jobNumber,
        capabilityName: futureSkill,
      });
      await addJobCapabilityRequirement(adminPage, {
        jobNumber,
        capabilityName: missingSkill,
      });

      // Assignment on the detail surface: the confirmation dialog identifies
      // EVERY uncovered requirement with its status and strongest entry, an
      // empty reason is rejected, and the apprentice-alone notice appears in
      // the same dialog (the employee is an apprentice on the planned date).
      await adminPage.goto(`/auftraege/${jobNumber}`);
      const assignDialog = await openEmployeeAssignmentDialog(adminPage);
      await employeeAssignmentPicker(assignDialog).click();
      await employeeAssignmentSearch(adminPage).fill(world.users.employee.firstName);
      await visibleSearchResult(adminPage, employeeName).click();
      await employeeAssignmentHeading(assignDialog).click();
      await assignDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
      const warningDialog = qualificationWarningDialog(adminPage);
      await expect(warningDialog).toBeVisible({ timeout: 15_000 });
      for (const [name, status] of [
        [unconfirmedCert, 'unconfirmed'],
        [expiredCert, 'expired'],
        [futureSkill, 'not_yet_valid'],
        [missingSkill, 'missing'],
      ] as const) {
        const gapRow = qualificationWarningGapRow(warningDialog, name);
        await expect(coverageStatusLabel(gapRow, status)).toBeVisible();
      }
      await expect(visibleStrongestQualificationEntry(warningDialog, employeeName)).toBeVisible();
      await expect(warningDialog.getByText(coveredSkill)).toHaveCount(0);
      await expect(apprenticeNotice(warningDialog)).toBeVisible();
      // Continuing without a reason is rejected.
      await assignDespiteWarningButton(warningDialog).click();
      await expect(missingReasonError(warningDialog)).toBeVisible();
      await qualificationOverrideReason(warningDialog).fill(
        `A5 erfahrene Begleitung ist organisiert ${world.runId}`,
      );
      await assignDespiteWarningButton(warningDialog).click();
      await expect(warningDialog).toHaveCount(0, { timeout: 15_000 });

      // The job detail distinguishes all five states and names the strongest
      // matching person per requirement.
      await expect(qualificationCoverageRow(adminPage, coveredSkill)).toBeVisible({ timeout: 15_000 });
      await expect(
        coverageStatusLabel(qualificationCoverageRow(adminPage, coveredSkill), 'covered', true),
      ).toBeVisible();
      await expect(
        coverageContributor(qualificationCoverageRow(adminPage, coveredSkill), employeeName),
      ).toBeVisible();
      await expect(
        coverageStatusLabel(qualificationCoverageRow(adminPage, unconfirmedCert), 'unconfirmed'),
      ).toBeVisible();
      await expect(
        coverageStatusLabel(qualificationCoverageRow(adminPage, expiredCert), 'expired', true),
      ).toBeVisible();
      await expect(
        coverageStatusLabel(qualificationCoverageRow(adminPage, futureSkill), 'not_yet_valid', true),
      ).toBeVisible();
      await expect(
        coverageStatusLabel(qualificationCoverageRow(adminPage, missingSkill), 'missing', true),
      ).toBeVisible();
      await expect(noCoveringPerson(qualificationCoverageRow(adminPage, missingSkill))).toBeVisible();
      const jobState = await getJobQualificationState(world.orgId, jobNumber);
      expect(jobState.requirementCount).toBe(5);
      expect(
        jobState.assessments.some(
          (assessment) =>
            assessment.overrideReason === `A5 erfahrene Begleitung ist organisiert ${world.runId}`,
        ),
      ).toBe(true);
    });

    await test.step('Bearbeitungsdialog und Kalender-Drag prüfen erneut, Abbrechen stellt still wieder her, begleitete Azubis bleiben unmarkiert und die Eigenansicht bleibt nur lesend', async () => {
      // The EDIT dialog is an assignment surface too: adding a second person
      // re-evaluates and reopens the reasoned confirmation.
      await adminPage.goto(`/auftraege/${jobNumber}`);
      const editDialog = await openJobEditDialog(adminPage);
      await expect(editDialog).toBeVisible({ timeout: 15_000 });
      await employeeAssignmentPicker(editDialog, 1).click();
      await employeeAssignmentSearch(adminPage).fill(world.users.buero.firstName);
      await visibleSearchResult(adminPage, bueroName).click();
      await jobEditDialogTitle(editDialog).click();
      await editDialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
      const editWarning = qualificationWarningDialog(adminPage);
      await expect(editWarning).toBeVisible({ timeout: 15_000 });
      await qualificationOverrideReason(editWarning).fill(
        `A5 Änderung im Bearbeitungsdialog begründet ${world.runId}`,
      );
      await assignDespiteWarningButton(editWarning).click();
      await expect(editWarning).toHaveCount(0, { timeout: 15_000 });
      expect((await getJobAssignmentUserIds(world.orgId, jobNumber)).sort()).toEqual(
        [world.users.buero.id, world.users.employee.id].sort(),
      );

      // Calendar drag: cancelling the reasoned confirmation restores the
      // calendar silently and mutates NOTHING.
      await showPlanningMonth(adminPage, plannedDateIso);
      const jobEvent = plannedCalendarEvent(adminPage, jobTitle);
      await expect(jobEvent).toBeVisible({ timeout: 20_000 });
      const stateBeforeDrag = await getPlanningState(world.orgId, { jobNumber });
      expect(stateBeforeDrag.occurrences[0]?.startDate).toBe(plannedDateIso);
      const dragWarning = planningWarningDialog(adminPage);
      await dragPlanningMonthEvent(adminPage, {
        title: jobTitle,
        sourceDate: plannedDateIso,
        targetDate: dragTargetIso,
      });
      await expect(dragWarning).toBeVisible({ timeout: 20_000 });
      await planningWarningRevert(dragWarning).click();
      await expect(dragWarning).toHaveCount(0, { timeout: 15_000 });
      await expect(monthDayShowing(adminPage, plannedDateIso, jobTitle)).toBeVisible({ timeout: 20_000 });
      const stateAfterCancel = await getPlanningState(world.orgId, { jobNumber });
      expect(stateAfterCancel.occurrences[0]?.startDate).toBe(plannedDateIso);
      expect(stateAfterCancel.occurrenceCount).toBe(stateBeforeDrag.occurrenceCount);
      expect(stateAfterCancel.eventTypes).toEqual(stateBeforeDrag.eventTypes);
      expect(stateAfterCancel.overrideReasons.length).toBe(stateBeforeDrag.overrideReasons.length);

      // The same drag with a reason persists: the drag path re-evaluates and
      // documents the deliberate exception.
      await dragPlanningMonthEvent(adminPage, {
        title: jobTitle,
        sourceDate: plannedDateIso,
        targetDate: dragTargetIso,
      });
      await expect(dragWarning).toBeVisible({ timeout: 20_000 });
      await planningWarningReason(dragWarning).fill(
        `A5 Kalenderverschiebung bewusst bestätigt ${world.runId}`,
      );
      await planningWarningSave(dragWarning).click();
      await expect(dragWarning).toHaveCount(0, { timeout: 20_000 });
      await expect
        .poll(async () => (await getPlanningState(world.orgId, { jobNumber })).occurrences[0]?.startDate, {
          timeout: 20_000,
        })
        .toBe(dragTargetIso);
      const stateAfterMove = await getPlanningState(world.orgId, { jobNumber });
      expect(stateAfterMove.overrideReasons).toContain(
        `A5 Kalenderverschiebung bewusst bestätigt ${world.runId}`,
      );

      // Accompanied apprentices are NOT marked: the companion carries a
      // non-apprentice employment type effective on the planned date (without
      // one the product honestly reports the incomplete apprentice signal), so
      // a mixed assignment on a job without requirements saves without any
      // confirmation dialog.
      await openMemberDetailFromList(adminPage, bueroName);
      await addConditionViaDialog(adminPage, {
        validFromDigits: toDatePickerDigits(plannedDateIso),
        employmentTypeLabel: 'Vollzeit',
        note: `A5 Begleitperson ${world.runId}`,
      });
      await createJob(adminPage, {
        jobNumber: accompaniedJobNumber,
        title: `A5 Begleiteter Einsatz ${world.runId}`,
        plannedDateDigits: toDatePickerDigits(plannedDateIso),
      });
      await adminPage.goto(`/auftraege/${accompaniedJobNumber}`);
      const mixedDialog = await openEmployeeAssignmentDialog(adminPage);
      await employeeAssignmentPicker(mixedDialog).click();
      for (const name of [employeeName, bueroName]) {
        await employeeAssignmentSearch(adminPage).fill(name);
        await visibleSearchResult(adminPage, name).click();
      }
      await employeeAssignmentHeading(mixedDialog).click();
      await mixedDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
      await expect(mixedDialog).toHaveCount(0, { timeout: 15_000 });
      await expect(qualificationWarningDialog(adminPage)).toHaveCount(0);
      expect((await getJobAssignmentUserIds(world.orgId, accompaniedJobNumber)).sort()).toEqual(
        [world.users.buero.id, world.users.employee.id].sort(),
      );

      // The admin turns the apprentice warning back off: it stays an optional,
      // admin-owned setting and later sessions inherit the default-off state.
      await setApprenticeWarningViaManagement(adminPage, false);

      // Employee transparency stays read-only: the own overview shows the A5
      // records with their validity states, but offers no management control.
      await employeePage.goto('/qualifikationen');
      await expect(visibleText(employeePage, coveredSkill)).toBeVisible({
        timeout: 15_000,
      });
      await expect(visibleText(employeePage, expiredCert)).toBeVisible();
      await expect(visibleText(employeePage, futureSkill)).toBeVisible();
      await expect(visibleText(employeePage, approachingCert)).toBeVisible();
      await expect(textInDom(employeePage, missingSkill)).toHaveCount(0);
      await expect(
        ownValidityLabel(ownQualificationCard(employeePage, expiredCert), 'expired'),
      ).toBeVisible();
      await expect(
        ownValidityLabel(ownQualificationCard(employeePage, futureSkill), 'notYetValid'),
      ).toBeVisible();
      await expect(employeePage.getByRole('main').getByRole('button')).toHaveCount(0);
      await expect(renewControlText(employeePage.getByRole('main'))).toHaveCount(0);
    });
  });
});
