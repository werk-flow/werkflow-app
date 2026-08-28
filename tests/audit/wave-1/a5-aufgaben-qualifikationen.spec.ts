import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { VACATION_STATUS_LABELS } from '../../../lib/vacation/types';
import { expect, test } from '../../golden/support/fixtures';
import { requireEnv } from '../../golden/support/env';
import {
  getAttentionPatternStateForUser,
  getCapabilityHistoryState,
  getEmployeeRecordStateByUser,
  getJobQualificationState,
  getLatestManualTimeEntryState,
  getPlanningState,
  getVacationRequestIdsByStartDate,
} from '../../golden/support/db';
import {
  addConditionViaDialog,
  addJobCapabilityRequirement,
  addTeamMemberViaManagement,
  approvePendingTimeEntry,
  approveVacationRequestFor,
  assignCapabilityViaManagement,
  cancelApprovedVacationForRangeText,
  closeRequestViaDialog,
  createCapabilityViaManagement,
  createJob,
  createOwnManualTimeEntry,
  createOwnVacationRequestViaDialog,
  createPersonnelRecordViaDialog,
  createPlannedCalendarEntry,
  createRequestViaDialog,
  createTeamViaManagement,
  markAllAttentionNotificationsReadViaButton,
  markAttentionNotificationReadViaButton,
  openAufgaben,
  openMemberDetailFromList,
  plannedCalendarEvent,
  rejectVacationRequestFor,
  selectFromSearchable,
  setApprenticeWarningViaManagement,
  showPlanningMonth,
  typeIntoDatePicker,
  visibleText,
} from '../../golden/support/steps';

// A5 — Aufgaben & Qualifikationen (P1-07, P1-09). Serial journeys over the
// shared audit world; every business mutation runs through the real UI and
// database access below is read-only assertion state. Owned run-day offsets:
// +40 … +44. The manual time entry deliberately lies on the previous day
// because the dialog rejects future times (documented fixture exception).

test.describe.configure({ mode: 'serial' });

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

function formatGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

function isWeekday(dateIso: string): boolean {
  const [year, month, day] = dateIso.split('-').map(Number);
  const jsWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsWeekday !== 0 && jsWeekday !== 6;
}

// The first N weekday offsets inside A5's owned +40 … +44 reserve. Vacation
// requests must land on weekdays so counting is deterministic in every run
// week (weekends never consume vacation).
function ownedWeekdayOffsets(count: number): number[] {
  const todayIso = berlinTodayIso();
  const offsets: number[] = [];
  for (let offset = 40; offset <= 44 && offsets.length < count; offset++) {
    if (isWeekday(shiftIsoDate(todayIso, offset))) offsets.push(offset);
  }
  if (offsets.length < count) {
    throw new Error('A5: not enough weekdays inside the owned +40…+44 window');
  }
  return offsets;
}

// ---------------------------------------------------------------------------
// Audit-local read-only database observers (A5 only — deliberately NOT part of
// the golden harness). Service-role SELECTs used exclusively for assertions.
// ---------------------------------------------------------------------------

let readOnlyAdminClient: SupabaseClient | null = null;

function createReadOnlyAdminClient(): SupabaseClient {
  readOnlyAdminClient ??= createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SECRET_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return readOnlyAdminClient;
}

async function getTeamStateByName(
  orgId: string,
  teamName: string
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
  const admin = createReadOnlyAdminClient();
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

async function getJobAssignmentUserIds(
  orgId: string,
  jobNumber: string
): Promise<string[]> {
  const admin = createReadOnlyAdminClient();
  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select('id')
    .eq('organization_id', orgId)
    .eq('job_number', jobNumber)
    .single();
  if (jobError || !job) {
    throw new Error(`Job lookup failed for ${jobNumber}: ${jobError?.message}`);
  }
  const { data, error } = await admin
    .from('job_assignments')
    .select('user_id')
    .eq('job_id', job.id);
  if (error) throw new Error(`Assignment lookup failed: ${error.message}`);
  return (data ?? []).map((row) => row.user_id as string).sort();
}

// ---------------------------------------------------------------------------
// Sidebar badge helpers. The Aufgaben badge counts actionable items plus
// unread notifications; the Zeiterfassung badge counts pending time and
// vacation approvals for the viewer (never anything the viewer cannot decide).
// ---------------------------------------------------------------------------

type RolePage = import('@playwright/test').Page;

function sidebarBadge(page: RolePage, href: '/aufgaben' | '/zeiterfassung') {
  return page.locator(`aside a[href="${href}"] [data-testid="sidebar-badge"]`);
}

async function readBadgeCount(
  page: RolePage,
  href: '/aufgaben' | '/zeiterfassung'
): Promise<number> {
  const badge = sidebarBadge(page, href);
  if ((await badge.count()) === 0) return 0;
  const text = (await badge.textContent())?.trim() ?? '';
  return text === '' ? 0 : Number(text);
}

async function expectBadgeCount(
  page: RolePage,
  href: '/aufgaben' | '/zeiterfassung',
  expected: number
): Promise<void> {
  await expect
    .poll(async () => readBadgeCount(page, href), { timeout: 20_000 })
    .toBe(expected);
}

test.describe('A5 Aufgaben und Qualifikationen @AUDIT-W1-A5', () => {
  test('A5-01/A5-02/A5-03/A5-04: Aufgabenseite zeigt Alter und Zuständigkeit, Meine Anträge tragen Status und Gründe, Sammel-Lesen ist deterministisch und beide Badges zählen ehrlich [P1-07-F01/P1-07-F02/P1-07-F03]', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    test.setTimeout(300_000);

    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const todayIso = berlinTodayIso();
    const [firstOffset, secondOffset] = ownedWeekdayOffsets(2);
    const firstDayIso = shiftIsoDate(todayIso, firstOffset);
    const secondDayIso = shiftIsoDate(todayIso, secondOffset);
    const rejectionReason = `A5 Personalplanung im Zeitraum ${world.runId}`;

    // Baseline before any A5 fact exists: inherited state is never assumed
    // empty, so every badge expectation is a delta from this runtime baseline.
    await adminPage.goto('/aufgaben');
    const adminZeitBaseline = await readBadgeCount(adminPage, '/zeiterfassung');

    // Büro's own manual entry becomes pending (P1-05 four-eyes). The previous
    // day 12:15–12:45 stays clear of every documented inherited slot.
    await createOwnManualTimeEntry(bueroPage, {
      memberName: `${world.users.buero.firstName} ${world.users.buero.lastName}`,
      dateDigits: toDatePickerDigits(shiftIsoDate(todayIso, -1)),
      clockInDigits: '1215',
      clockOutDigits: '1245',
    });
    expect(
      (await getLatestManualTimeEntryState(world.orgId, world.users.buero.id))
        .status
    ).toBe('pending');
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
      receivedAtLocal: `${shiftIsoDate(todayIso, -1)}T10:00`,
      assigneeName: `${world.users.buero.firstName} ${world.users.buero.lastName}`,
    });
    await openAufgaben(adminPage);
    const adminRequestTask = adminPage.locator('[data-task-source]').filter({
      hasText: requestNumber,
    });
    await expect(adminRequestTask).toHaveCount(1, { timeout: 15_000 });
    await expect(adminRequestTask.getByText('offen seit 1 Tag')).toBeVisible();
    await expect(
      adminRequestTask.getByText(
        `Zuständig: ${world.users.buero.firstName} ${world.users.buero.lastName}`
      )
    ).toBeVisible();

    // Decisions never happen on /aufgaben: the page offers no approve/reject
    // control anywhere — every task row is a deep link only.
    await expect(
      adminPage
        .getByTestId('aufgaben-content')
        .getByRole('button', { name: /genehmigen|ablehnen|stornieren/i })
    ).toHaveCount(0);

    // The Aufgaben badge is exactly "actionable + unread" — asserted as a
    // page-internal equality that is valid in fresh and inherited runs alike.
    const adminTaskCount = await adminPage.locator('[data-task-source]').count();
    const adminUnreadCount = await adminPage
      .locator('[data-unread="true"]')
      .count();
    await expectBadgeCount(
      adminPage,
      '/aufgaben',
      adminTaskCount + adminUnreadCount
    );

    // Meine Anträge (employee transparency): the pending request is listed
    // with range, day count and status.
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );
    const pendingRequests = await getVacationRequestIdsByStartDate(
      world.orgId,
      employeeRecord.id
    );
    const firstRequest = pendingRequests.get(firstDayIso);
    expect(firstRequest?.status).toBe('pending');
    await openAufgaben(employeePage);
    const firstOwnRow = employeePage.locator(
      `[data-own-request-source="${firstRequest!.id}"]`
    );
    await expect(firstOwnRow).toHaveCount(1, { timeout: 15_000 });
    await expect(
      firstOwnRow.getByText(formatGermanDate(firstDayIso))
    ).toBeVisible();
    await expect(
      firstOwnRow.getByText(VACATION_STATUS_LABELS.pending)
    ).toBeVisible();

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

    const decidedRequests = await getVacationRequestIdsByStartDate(
      world.orgId,
      employeeRecord.id
    );
    const approvedRequest = decidedRequests.get(firstDayIso);
    const rejectedRequest = decidedRequests.get(secondDayIso);
    expect(approvedRequest?.status).toBe('approved');
    expect(rejectedRequest?.status).toBe('rejected');

    // Exactly one unread notification per decided request; with two or more
    // unread rows the bulk action is deterministically available.
    await openAufgaben(employeePage);
    const approvedRow = employeePage.locator(
      `[data-notification-source="${approvedRequest!.id}"]`
    );
    const rejectedRow = employeePage.locator(
      `[data-notification-source="${rejectedRequest!.id}"]`
    );
    await expect(approvedRow).toHaveCount(1, { timeout: 15_000 });
    await expect(approvedRow).toHaveAttribute('data-unread', 'true');
    await expect(rejectedRow).toHaveCount(1);
    await expect(rejectedRow).toHaveAttribute('data-unread', 'true');
    await expect(rejectedRow.getByText('wurde abgelehnt.')).toBeVisible();
    await expect(rejectedRow.getByText(rejectionReason)).toBeVisible();

    // Employee badge equality: nothing actionable for this viewer, so the
    // badge equals the unread notification count.
    const employeeUnread = await employeePage
      .locator('[data-unread="true"]')
      .count();
    expect(employeeUnread).toBeGreaterThanOrEqual(2);
    await expectBadgeCount(employeePage, '/aufgaben', employeeUnread);

    // "Alle als gelesen markieren" clears every unread row at once.
    await markAllAttentionNotificationsReadViaButton(employeePage);
    await expect(sidebarBadge(employeePage, '/aufgaben')).toHaveCount(0, {
      timeout: 15_000,
    });
    const patternState = await getAttentionPatternStateForUser(
      world.orgId,
      world.users.employee.id
    );
    for (const sourceId of [approvedRequest!.id, rejectedRequest!.id]) {
      expect(
        patternState.readStates.some((state) => state.sourceId === sourceId)
      ).toBe(true);
      expect(
        patternState.events.some(
          (event) =>
            event.sourceId === sourceId && event.eventType === 'marked_read'
        )
      ).toBe(true);
    }

    // Meine Anträge carries status AND the decision reason (P1-07-F01).
    const approvedOwnRow = employeePage.locator(
      `[data-own-request-source="${approvedRequest!.id}"]`
    );
    const rejectedOwnRow = employeePage.locator(
      `[data-own-request-source="${rejectedRequest!.id}"]`
    );
    await expect(
      approvedOwnRow.getByText(VACATION_STATUS_LABELS.approved)
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      rejectedOwnRow.getByText(VACATION_STATUS_LABELS.rejected)
    ).toBeVisible();
    await expect(
      rejectedOwnRow.getByText(`Grund: ${rejectionReason}`)
    ).toBeVisible();

    // Retroactive correction: cancelling the approved request surfaces the
    // CANCELLATION reason in Meine Anträge (the cancelled branch of the
    // decision-reason contract).
    const cancellationReason = `A5 Projekttermin verschoben ${world.runId}`;
    await cancelApprovedVacationForRangeText(
      adminPage,
      employeeName,
      formatGermanDate(firstDayIso),
      cancellationReason
    );
    await openAufgaben(employeePage);
    await expect(
      approvedOwnRow.getByText(VACATION_STATUS_LABELS.cancelled)
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      approvedOwnRow.getByText(`Grund: ${cancellationReason}`)
    ).toBeVisible();
    // The re-surfaced unread notification is read again so A5 leaves no
    // unread employee state behind.
    await markAttentionNotificationReadViaButton(
      employeePage,
      approvedRequest!.id
    );

    // Resolve the remaining A5 items in their owning surfaces: close the
    // request over its deep link, approve Büro's entry. The Zeiterfassung
    // badge returns exactly to its baseline.
    await openAufgaben(adminPage);
    await adminRequestTask.click();
    await adminPage.waitForURL('**/anfragen/**', { timeout: 20_000 });
    await closeRequestViaDialog(adminPage, 'Anderweitig gelöst');
    await adminPage.goto('/zeiterfassung?tab=approvals');
    await expect(
      adminPage.getByTestId('pending-approvals-panel')
    ).toHaveAttribute('data-loaded', 'true', { timeout: 15_000 });
    await approvePendingTimeEntry(adminPage, world.users.buero.id);
    expect(
      (await getLatestManualTimeEntryState(world.orgId, world.users.buero.id))
        .status
    ).toBe('approved');
    await expectBadgeCount(adminPage, '/zeiterfassung', adminZeitBaseline);
  });

  test('A5-05/A5-06: Teams sind datumswirksame Planungs-Abkürzungen — Büro legt an, Ausweis ohne Zugang wird sichtbar übersprungen, der Kalender plant Personal ohne Zugang mit ein und die Auflösung erhält die Historie [P1-09-F01/P1-09-F02]', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const todayIso = berlinTodayIso();
    const teamName = `A5 Einsatzteam ${world.runId}`;
    const bueroSkillName = `A5 Disposition ${world.runId}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const noLoginName = `Paula Papier-${world.runId}`;
    const futureFromIso = shiftIsoDate(todayIso, 44);
    const planningDateIso = shiftIsoDate(todayIso, 42);
    const jobNumber = `A5-TEAM-${world.runId}`;

    // Büro/Admin maintain teams and the qualification catalog: Büro performs
    // both creations through the same management surface.
    await createTeamViaManagement(bueroPage, teamName);
    await createCapabilityViaManagement(bueroPage, {
      name: bueroSkillName,
      kind: 'Fähigkeit',
    });

    // A5-owned personnel record WITHOUT login, created through the real UI —
    // A5 never relies on earlier sessions' fixtures.
    const noLoginRecordId = await createPersonnelRecordViaDialog(adminPage, {
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
    await adminPage.goto('/mitarbeiter');
    await adminPage.getByRole('tab', { name: 'Teams', exact: true }).click();
    const teamCard = adminPage
      .getByTestId('team-card')
      .filter({ hasText: teamName });
    await expect(teamCard).toBeVisible({ timeout: 15_000 });
    await selectFromSearchable(
      adminPage,
      teamCard.getByRole('combobox', {
        name: `Mitglied zu ${teamName} hinzufügen`,
      }),
      bueroName
    );
    await typeIntoDatePicker(
      teamCard,
      `Teamzugehörigkeit zu ${teamName} gültig ab`,
      `${futureFromIso.slice(8, 10)}${futureFromIso.slice(5, 7)}${futureFromIso.slice(0, 4)}`
    );
    await teamCard.getByRole('button', { name: 'Hinzufügen' }).click();
    const bueroRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.buero.id
    );
    await expect
      .poll(async () =>
        (await getTeamStateByName(world.orgId, teamName)).memberships.some(
          (membership) =>
            membership.employeeRecordId === bueroRecord.id &&
            membership.validFrom === futureFromIso
        )
      , { timeout: 15_000 })
      .toBe(true);
    // Date-effectiveness in the management view: the future member is not a
    // current member row.
    await expect(
      teamCard.getByTestId('team-member-row').filter({ hasText: bueroName })
    ).toHaveCount(0);

    // Job-dialog expansion: one click selects all CURRENTLY ACTIVE members;
    // the person without login is visibly skipped, the future member is not
    // yet part of the expansion.
    await createJob(adminPage, {
      jobNumber,
      title: `A5 Teamauftrag ${world.runId}`,
    });
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await adminPage.getByRole('button', { name: 'Zuweisen', exact: true }).click();
    const assignmentDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Mitarbeiter zuweisen' }),
    });
    await assignmentDialog
      .getByRole('button', { name: teamName, exact: true })
      .click();
    await expect(
      adminPage.getByText(
        `${noLoginName} wurde nicht übernommen, da kein aktiver App-Zugang verknüpft ist.`
      )
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      assignmentDialog.getByRole('combobox').filter({ hasText: '1 Mitarbeiter' })
    ).toBeVisible();
    await assignmentDialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(assignmentDialog).toHaveCount(0, { timeout: 15_000 });
    expect(await getJobAssignmentUserIds(world.orgId, jobNumber)).toEqual([
      world.users.employee.id,
    ]);

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
    await expect(
      plannedCalendarEvent(bueroPage, `A5 Teamauftrag ${world.runId}`)
    ).toBeVisible({ timeout: 20_000 });

    // Dissolution keeps the history: the team disappears from every picker,
    // rows/events/assignments stay durable.
    const stateBefore = await getTeamStateByName(world.orgId, teamName);
    expect(stateBefore.dissolvedAt).toBeNull();
    expect(stateBefore.memberships).toHaveLength(3);
    await adminPage.goto('/mitarbeiter');
    await adminPage.getByRole('tab', { name: 'Teams', exact: true }).click();
    await adminPage
      .getByTestId('team-card')
      .filter({ hasText: teamName })
      .getByRole('button', { name: 'Auflösen' })
      .click();
    const dissolveDialog = adminPage.getByRole('alertdialog');
    await expect(
      dissolveDialog.getByText('bleibt mit seiner Historie erhalten', {
        exact: false,
      })
    ).toBeVisible();
    await dissolveDialog
      .getByRole('button', { name: 'Team auflösen', exact: true })
      .click();
    await expect(
      adminPage.getByRole('heading', { name: 'Aufgelöste Teams' })
    ).toBeVisible({ timeout: 15_000 });
    await expect(visibleText(adminPage, teamName)).toBeVisible();
    await expect(
      adminPage.getByTestId('team-card').filter({ hasText: teamName })
    ).toHaveCount(0);

    const stateAfter = await getTeamStateByName(world.orgId, teamName);
    expect(stateAfter.dissolvedAt).not.toBeNull();
    expect(stateAfter.memberships).toHaveLength(3);
    expect(stateAfter.eventTypes).toContain('dissolved');
    // Already-created work survives the dissolution untouched.
    expect(await getJobAssignmentUserIds(world.orgId, jobNumber)).toEqual([
      world.users.employee.id,
    ]);
    expect(
      (await getPlanningState(world.orgId, { jobNumber })).assignmentCount
    ).toBe(2);

    // No picker offers the dissolved team anymore: job assignment dialog …
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await adminPage.getByRole('button', { name: 'Zuweisen', exact: true }).click();
    const reopenedDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Mitarbeiter zuweisen' }),
    });
    await expect(reopenedDialog).toBeVisible({ timeout: 15_000 });
    await expect(
      reopenedDialog.getByRole('button', { name: teamName, exact: true })
    ).toHaveCount(0);
    await adminPage.keyboard.press('Escape');
    // … and the calendar planning dialog.
    await adminPage.goto('/kalender');
    await adminPage.getByRole('button', { name: 'Kalendereintrag' }).click();
    const planningDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Kalendereintrag erstellen' }),
    });
    await planningDialog.getByRole('tab', { name: 'Termin planen' }).click();
    await expect(planningDialog.locator('#planning-date')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      planningDialog.getByRole('button', { name: teamName, exact: true })
    ).toHaveCount(0);
    await adminPage.keyboard.press('Escape');

    // The no-login record remains reachable for later sessions' sanity.
    expect(noLoginRecordId).toMatch(/[0-9a-f-]{36}/);
  });

  test('A5-07/A5-08/A5-09/A5-10: Fünf Abdeckungszustände mit stärkster Person, Mehrfach-Warnung mit Pflichtgrund, Azubi-Standard aus und rechtzeitiger Ablaufhinweis [P1-09-F02/P1-09-F03/P1-09-F04/P1-09-F05/P1-09-F06]', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    // Longest single journey in the battery (6 catalog creations, 5 person
    // records, attention checks, a job with 5 requirements, and the reasoned
    // assignment). The M4 registry inputs type dates as segments instead of
    // one fill, which pushed the honest end-to-end cost past the 180 s
    // default; the flow itself was verified progressing to its final
    // assertions when the budget ran out.
    test.slow();
    const todayIso = berlinTodayIso();
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const plannedDateIso = shiftIsoDate(todayIso, 43);
    const dragTargetIso = shiftIsoDate(todayIso, 44);
    const jobNumber = `A5-QUAL-${world.runId}`;

    const coveredSkill = `A5 Grundmontage ${world.runId}`;
    const unconfirmedCert = `A5 Gasgeräte ${world.runId}`;
    const expiredCert = `A5 Kältemittel ${world.runId}`;
    const futureSkill = `A5 Hydraulik ${world.runId}`;
    const missingSkill = `A5 Elektro ${world.runId}`;
    const approachingCert = `A5 Brandschutz ${world.runId}`;

    // The apprentice warning is OFF by default and admin-controlled.
    await adminPage.goto('/mitarbeiter');
    await adminPage
      .getByRole('tab', { name: 'Qualifikationen', exact: true })
      .click();
    const apprenticeCheckbox = adminPage.getByRole('checkbox', {
      name: 'Ausbildungs-Hinweis aktivieren',
    });
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
      kind: 'Fähigkeit',
    });
    await createCapabilityViaManagement(adminPage, {
      name: unconfirmedCert,
      kind: 'Zertifizierung',
      warningDays: 30,
    });
    await createCapabilityViaManagement(adminPage, {
      name: expiredCert,
      kind: 'Zertifizierung',
      warningDays: 30,
    });
    await createCapabilityViaManagement(adminPage, {
      name: futureSkill,
      kind: 'Fähigkeit',
    });
    await createCapabilityViaManagement(adminPage, {
      name: missingSkill,
      kind: 'Fähigkeit',
    });
    await createCapabilityViaManagement(adminPage, {
      name: approachingCert,
      kind: 'Zertifizierung',
      warningDays: 30,
    });
    await assignCapabilityViaManagement(adminPage, {
      employeeName,
      capabilityName: coveredSkill,
      validFrom: shiftIsoDate(todayIso, -30),
    });
    await assignCapabilityViaManagement(adminPage, {
      employeeName,
      capabilityName: unconfirmedCert,
      validFrom: shiftIsoDate(todayIso, -30),
      validUntil: shiftIsoDate(todayIso, 365),
      evidence: 'Ausstehend',
    });
    await assignCapabilityViaManagement(adminPage, {
      employeeName,
      capabilityName: expiredCert,
      validFrom: shiftIsoDate(todayIso, -60),
      validUntil: shiftIsoDate(todayIso, -1),
    });
    await assignCapabilityViaManagement(adminPage, {
      employeeName,
      capabilityName: futureSkill,
      validFrom: dragTargetIso,
    });
    await assignCapabilityViaManagement(adminPage, {
      employeeName,
      capabilityName: approachingCert,
      validFrom: shiftIsoDate(todayIso, -300),
      validUntil: shiftIsoDate(todayIso, 10),
      confirmed: true,
      evidence: 'Erhalten',
    });

    // Timely expiry attention: the certification is NOT expired yet, but it
    // is inside its warning window — admin AND Büro get the notice on
    // /aufgaben with a deep link into the qualification.
    const employeeRecord = await getEmployeeRecordStateByUser(
      world.orgId,
      world.users.employee.id
    );
    const approachingHistory = await getCapabilityHistoryState(
      world.orgId,
      employeeRecord.id,
      approachingCert
    );
    expect(approachingHistory.rows).toHaveLength(1);
    const approachingRecordId = approachingHistory.rows[0].id;
    for (const page of [adminPage, bueroPage]) {
      await openAufgaben(page);
      const notice = page.locator(
        `[data-notification-source="${approachingRecordId}"]`
      );
      await expect(notice).toHaveCount(1, { timeout: 15_000 });
      await expect(notice.getByText('läuft bald ab')).toBeVisible();
      await expect(notice.getByText(approachingCert)).toBeVisible();
      await expect(
        notice.getByRole('link', { name: 'Qualifikation ansehen' })
      ).toHaveAttribute('href', `/mitarbeiter/${employeeRecord.id}`);
    }
    await markAttentionNotificationReadViaButton(
      adminPage,
      approachingRecordId
    );

    // Job with five requirements evaluated on its planned date.
    await createJob(adminPage, {
      jobNumber,
      title: `A5 Qualifikationsmatrix ${world.runId}`,
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
    await adminPage.getByRole('button', { name: 'Zuweisen', exact: true }).click();
    const assignDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Mitarbeiter zuweisen' }),
    });
    await assignDialog
      .getByRole('combobox')
      .filter({ hasText: 'Mitarbeiter zuweisen' })
      .click();
    await adminPage.getByPlaceholder('Mitarbeiter suchen...').fill(
      world.users.employee.firstName
    );
    await adminPage
      .getByRole('listbox')
      .getByRole('button')
      .filter({ hasText: employeeName })
      .first()
      .click();
    await assignDialog
      .getByRole('heading', { name: 'Mitarbeiter zuweisen' })
      .click();
    await assignDialog.getByRole('button', { name: 'Speichern' }).click();
    const warningDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Zuweisung prüfen' }),
    });
    await expect(warningDialog).toBeVisible({ timeout: 15_000 });
    for (const [name, status] of [
      [unconfirmedCert, 'Wirksam, intern noch nicht bestätigt'],
      [expiredCert, 'Abgelaufen'],
      [futureSkill, 'Noch nicht gültig'],
      [missingSkill, 'Nicht hinterlegt'],
    ] as const) {
      const gapRow = warningDialog
        .locator('div')
        .filter({ has: adminPage.getByText(name, { exact: true }) })
        .last();
      await expect(gapRow.getByText(status)).toBeVisible();
    }
    await expect(
      warningDialog.getByText(`stärkster Eintrag: ${employeeName}`).first()
    ).toBeVisible();
    await expect(warningDialog.getByText(coveredSkill)).toHaveCount(0);
    await expect(
      warningDialog.getByText('Ausbildungs-Hinweis', { exact: true })
    ).toBeVisible();
    // Continuing without a reason is rejected.
    await warningDialog
      .getByRole('button', { name: 'Trotz Hinweis zuweisen' })
      .click();
    await expect(
      warningDialog.getByText('Bitte gib eine kurze Begründung ein.')
    ).toBeVisible();
    await warningDialog
      .locator('#qualification-override-reason')
      .fill(`A5 erfahrene Begleitung ist organisiert ${world.runId}`);
    await warningDialog
      .getByRole('button', { name: 'Trotz Hinweis zuweisen' })
      .click();
    await expect(warningDialog).toHaveCount(0, { timeout: 15_000 });

    // The job detail distinguishes all five states and names the strongest
    // matching person per requirement.
    const coverageRow = (name: string) =>
      adminPage.locator(
        `[data-testid="qualification-coverage-row"][data-capability-name="${name}"]`
      );
    await expect(coverageRow(coveredSkill)).toBeVisible({ timeout: 15_000 });
    await expect(coverageRow(coveredSkill).getByText('Abgedeckt', { exact: true })).toBeVisible();
    await expect(
      coverageRow(coveredSkill).getByText(`Abgedeckt durch ${employeeName}`)
    ).toBeVisible();
    await expect(
      coverageRow(unconfirmedCert).getByText(
        'Wirksam, intern noch nicht bestätigt'
      )
    ).toBeVisible();
    await expect(
      coverageRow(expiredCert).getByText('Abgelaufen', { exact: true })
    ).toBeVisible();
    await expect(
      coverageRow(futureSkill).getByText('Noch nicht gültig', { exact: true })
    ).toBeVisible();
    await expect(
      coverageRow(missingSkill).getByText('Nicht hinterlegt', { exact: true })
    ).toBeVisible();
    await expect(
      coverageRow(missingSkill).getByText('Keine passende Person zugewiesen')
    ).toBeVisible();
    const jobState = await getJobQualificationState(world.orgId, jobNumber);
    expect(jobState.requirementCount).toBe(5);
    expect(
      jobState.assessments.some(
        (assessment) =>
          assessment.overrideReason ===
          `A5 erfahrene Begleitung ist organisiert ${world.runId}`
      )
    ).toBe(true);

  });

  test('A5-07/A5-08/A5-10 (Fortsetzung): Bearbeitungsdialog und Kalender-Drag prüfen erneut, Abbrechen stellt still wieder her, begleitete Azubis bleiben unmarkiert und die Eigenansicht bleibt nur lesend [P1-09-F02/P1-09-F04/P1-09-F05]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const todayIso = berlinTodayIso();
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const plannedDateIso = shiftIsoDate(todayIso, 43);
    const dragTargetIso = shiftIsoDate(todayIso, 44);
    const jobNumber = `A5-QUAL-${world.runId}`;
    const accompaniedJobNumber = `A5-BEGL-${world.runId}`;
    const coveredSkill = `A5 Grundmontage ${world.runId}`;
    const expiredCert = `A5 Kältemittel ${world.runId}`;
    const futureSkill = `A5 Hydraulik ${world.runId}`;
    const missingSkill = `A5 Elektro ${world.runId}`;
    const approachingCert = `A5 Brandschutz ${world.runId}`;

    // The EDIT dialog is an assignment surface too: adding a second person
    // re-evaluates and reopens the reasoned confirmation.
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await adminPage
      .getByRole('button', { name: 'Aktionen öffnen', exact: true })
      .click();
    await adminPage
      .getByRole('menuitem', { name: 'Bearbeiten', exact: true })
      .click();
    const editDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Auftrag bearbeiten' }),
    });
    await expect(editDialog).toBeVisible({ timeout: 15_000 });
    await editDialog
      .getByRole('combobox')
      .filter({ hasText: '1 Mitarbeiter' })
      .click();
    await adminPage.getByPlaceholder('Mitarbeiter suchen...').fill(
      world.users.buero.firstName
    );
    await adminPage
      .getByRole('listbox')
      .getByRole('button')
      .filter({ hasText: bueroName })
      .first()
      .click();
    await editDialog
      .getByRole('heading', { name: 'Auftrag bearbeiten' })
      .click();
    await editDialog
      .getByRole('button', { name: 'Speichern', exact: true })
      .click();
    const editWarning = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Zuweisung prüfen' }),
    });
    await expect(editWarning).toBeVisible({ timeout: 15_000 });
    await editWarning
      .locator('#qualification-override-reason')
      .fill(`A5 Änderung im Bearbeitungsdialog begründet ${world.runId}`);
    await editWarning
      .getByRole('button', { name: 'Trotz Hinweis zuweisen' })
      .click();
    await expect(editWarning).toHaveCount(0, { timeout: 15_000 });
    expect(
      (await getJobAssignmentUserIds(world.orgId, jobNumber)).sort()
    ).toEqual([world.users.buero.id, world.users.employee.id].sort());

    // Calendar drag: cancelling the reasoned confirmation restores the
    // calendar silently and mutates NOTHING.
    await showPlanningMonth(adminPage, plannedDateIso);
    const jobEvent = adminPage
      .locator('.fc-event-job')
      .filter({ hasText: `A5 Qualifikationsmatrix ${world.runId}` });
    await expect(jobEvent).toBeVisible({ timeout: 20_000 });
    const stateBeforeDrag = await getPlanningState(world.orgId, { jobNumber });
    expect(stateBeforeDrag.occurrences[0].startDate).toBe(plannedDateIso);
    const dragWarning = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Planungshinweise prüfen' }),
    });
    await jobEvent.dragTo(
      adminPage.locator(`.fc-daygrid-day[data-date="${dragTargetIso}"]`)
    );
    await expect(dragWarning).toBeVisible({ timeout: 20_000 });
    await dragWarning
      .getByRole('button', { name: 'Änderung zurücknehmen' })
      .click();
    await expect(dragWarning).toHaveCount(0, { timeout: 15_000 });
    await expect(
      adminPage
        .locator(`.fc-daygrid-day[data-date="${plannedDateIso}"]`)
        .filter({ hasText: `A5 Qualifikationsmatrix ${world.runId}` })
    ).toBeVisible({ timeout: 20_000 });
    const stateAfterCancel = await getPlanningState(world.orgId, { jobNumber });
    expect(stateAfterCancel.occurrences[0].startDate).toBe(plannedDateIso);
    expect(stateAfterCancel.occurrenceCount).toBe(
      stateBeforeDrag.occurrenceCount
    );
    expect(stateAfterCancel.eventTypes).toEqual(stateBeforeDrag.eventTypes);
    expect(stateAfterCancel.overrideReasons.length).toBe(
      stateBeforeDrag.overrideReasons.length
    );

    // The same drag with a reason persists: the drag path re-evaluates and
    // documents the deliberate exception.
    await jobEvent.dragTo(
      adminPage.locator(`.fc-daygrid-day[data-date="${dragTargetIso}"]`)
    );
    await expect(dragWarning).toBeVisible({ timeout: 20_000 });
    await dragWarning
      .locator('#planning-warning-reason')
      .fill(`A5 Kalenderverschiebung bewusst bestätigt ${world.runId}`);
    await dragWarning
      .getByRole('button', { name: 'Mit Begründung speichern' })
      .click();
    await expect(dragWarning).toHaveCount(0, { timeout: 20_000 });
    await expect
      .poll(async () =>
        (await getPlanningState(world.orgId, { jobNumber })).occurrences[0]
          .startDate
      , { timeout: 20_000 })
      .toBe(dragTargetIso);
    const stateAfterMove = await getPlanningState(world.orgId, { jobNumber });
    expect(stateAfterMove.overrideReasons).toContain(
      `A5 Kalenderverschiebung bewusst bestätigt ${world.runId}`
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
    await adminPage.getByRole('button', { name: 'Zuweisen', exact: true }).click();
    const mixedDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Mitarbeiter zuweisen' }),
    });
    await mixedDialog
      .getByRole('combobox')
      .filter({ hasText: 'Mitarbeiter zuweisen' })
      .click();
    for (const name of [employeeName, bueroName]) {
      await adminPage.getByPlaceholder('Mitarbeiter suchen...').fill(name);
      await adminPage
        .getByRole('listbox')
        .getByRole('button')
        .filter({ hasText: name })
        .first()
        .click();
    }
    await mixedDialog
      .getByRole('heading', { name: 'Mitarbeiter zuweisen' })
      .click();
    await mixedDialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(mixedDialog).toHaveCount(0, { timeout: 15_000 });
    await expect(
      adminPage.getByRole('dialog').filter({
        has: adminPage.getByRole('heading', { name: 'Zuweisung prüfen' }),
      })
    ).toHaveCount(0);
    expect(
      (await getJobAssignmentUserIds(world.orgId, accompaniedJobNumber)).sort()
    ).toEqual([world.users.buero.id, world.users.employee.id].sort());

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
    await expect(
      employeePage.getByText(missingSkill, { exact: true })
    ).toHaveCount(0);
    const ownCard = (name: string) =>
      employeePage.locator(
        `[data-testid="own-qualification-card"][data-capability-name="${name}"]`
      );
    await expect(ownCard(expiredCert).getByText('Abgelaufen')).toBeVisible();
    await expect(
      ownCard(futureSkill).getByText('Noch nicht gültig')
    ).toBeVisible();
    await expect(employeePage.locator('main').getByRole('button')).toHaveCount(
      0
    );
    await expect(
      employeePage.locator('main').getByText('Erneuern')
    ).toHaveCount(0);
  });
});
