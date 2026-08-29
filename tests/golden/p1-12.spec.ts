import { expect, test } from './support/fixtures';
import { expectLiveWithin } from './support/live';
import {
  getCommitmentState,
  getDispatchState,
  getParkingState,
  getPlanningState,
  getVisibleDispatchStateAs,
} from './support/db';
import {
  acknowledgeDispatchOnJobPage,
  challengeDispatchOnJobPage,
  confirmBatchReschedule,
  createJob,
  createPlannedCalendarEntry,
  dispatchOccurrenceRow,
  dispatchParkedJobFromParkplatz,
  editPlannedCalendarOccurrence,
  expectDispatchStateOnJobPage,
  issueDispatchForOccurrence,
  openDispatchPanel,
  openParkplatzPanel,
  parkplatzCard,
  recordCommitmentForOccurrence,
  resolveDispatchChallengeInPanel,
  selectFromSearchable,
  startBatchRescheduleInPanel,
  typeIntoDatePickerById,
} from './support/steps';

test.describe.configure({ mode: 'serial' });

const TODAY_ISO = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10);
}

// P1-12 owns run-day+3 through run-day+10 at 06:00 Berlin (early times keep
// clear of P1-11's 09:00+ planning window when the months collide; overlap
// with inherited entries only ever produces the reasoned-override warning).
const PARK_SCHEDULE_DATE = shiftIsoDate(TODAY_ISO, 3);
const REVIEW_DATE = shiftIsoDate(TODAY_ISO, 4);
const MAIN_DATE = shiftIsoDate(TODAY_ISO, 5);
const MAIN_MOVED_DATE = shiftIsoDate(TODAY_ISO, 6);
const MAIN_BATCH_DATE = shiftIsoDate(TODAY_ISO, 7);
const BATCH_DATE = shiftIsoDate(TODAY_ISO, 8);

const OVERRIDE_REASON = 'Betrieblich abgestimmter P1-12 Einsatz.';

function parkJobNumber(runId: string): string {
  return `AUF-${runId}-P112-PARK`;
}
function mainJobNumber(runId: string): string {
  return `AUF-${runId}-P112-MAIN`;
}
function batchJobNumber(runId: string): string {
  return `AUF-${runId}-P112-BATCH`;
}

test.describe('P1-12 dispatch, batch rescheduling, readiness, acknowledgement, and commitments @GG-03', () => {
  test('parked backlog work gains context and an honest unscheduled dispatch', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const title = `P1-12 Rückstau ${world.runId}`;
    await createJob(adminPage, {
      jobNumber: parkJobNumber(world.runId),
      title,
    });

    await adminPage.goto(`/auftraege/${parkJobNumber(world.runId)}`);
    const lifecycle = adminPage.getByTestId('work-lifecycle-card');
    await lifecycle.getByRole('button', { name: 'Parken', exact: true }).click();
    const parkingDialog = adminPage.getByRole('dialog');
    await parkingDialog.locator('#work-blocker-reason').click();
    await adminPage.getByRole('option', { name: 'Material', exact: true }).click();
    await parkingDialog.locator('#work-blocker-details').fill('Rückstau bis zur Lieferung.');
    await selectFromSearchable(
      adminPage,
      parkingDialog.locator('#work-blocker-owner'),
      world.users.admin.firstName
    );
    await typeIntoDatePickerById(parkingDialog, 'work-blocker-review', REVIEW_DATE);
    await parkingDialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(parkingDialog).toHaveCount(0, { timeout: 20_000 });

    await openParkplatzPanel(adminPage);
    const card = parkplatzCard(adminPage, title);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.locator('[data-parking-context="set"]')).toBeVisible({
      timeout: 20_000,
    });

    const parking = await getParkingState(world.orgId, parkJobNumber(world.runId));
    expect(parking.context).not.toBeNull();
    const parkingContext = parking.context!;
    expect(parkingContext.reason).toBe('warten_auf_material');
    expect(parkingContext.nextReviewDate).toBe(REVIEW_DATE);
    expect(parkingContext.responsibleEmployeeRecordId).not.toBeNull();
    expect(parking.eventTypes).toContain('context_set');

    await dispatchParkedJobFromParkplatz(adminPage, {
      jobTitle: title,
      recipientName: employeeName,
    });
    const state = await getDispatchState(world.orgId, parkJobNumber(world.runId));
    expect(state.dispatches).toHaveLength(1);
    expect(state.dispatches[0].status).toBe('active');
    expect(state.dispatches[0].targetKind).toBe('job');
    expect(state.dispatches[0].revisionChangeKinds).toEqual(['issued']);
    expect(state.dispatches[0].currentRecipientRecordIds).toHaveLength(1);
    expect(state.dispatches[0].eventTypes).toContain('issued');

    // The recipient sees the pending confirmation on the shared surface.
    await employeePage.goto('/aufgaben');
    const taskGroup = employeePage.getByTestId('attention-dispatch-tasks');
    await expect(taskGroup).toBeVisible({ timeout: 20_000 });
    await expect(taskGroup.getByText(title, { exact: true })).toBeVisible();
  });

  test('scheduling dispatched backlog work is a traceable target transition', async ({
    adminPage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: parkJobNumber(world.runId),
      date: PARK_SCHEDULE_DATE,
      time: '06:00',
      employeeNames: [employeeName],
      overrideReason: OVERRIDE_REASON,
    });

    const state = await getDispatchState(world.orgId, parkJobNumber(world.runId));
    expect(state.dispatches).toHaveLength(1);
    expect(state.dispatches[0].status).toBe('active');
    expect(state.dispatches[0].targetKind).toBe('occurrence');
    expect(state.dispatches[0].revisionChangeKinds).toEqual(['issued', 'target_scheduled']);
    expect(state.dispatches[0].currentRevisionNumber).toBe(2);
    expect(state.dispatches[0].eventTypes).toContain('target_scheduled');

    // Planning and parking are independent P1-14 facts. Scheduling updates the
    // dispatch target without silently resolving the parking blocker.
    const parking = await getParkingState(world.orgId, parkJobNumber(world.runId));
    expect(parking.context?.reason).toBe('warten_auf_material');
    expect(parking.eventTypes).not.toContain('unparked');
  });

  test('a scheduled dispatch is acknowledged and a material move invalidates it', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const title = `P1-12 Hauptbesuch ${world.runId}`;
    await createJob(adminPage, {
      jobNumber: mainJobNumber(world.runId),
      title,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: mainJobNumber(world.runId),
      date: MAIN_DATE,
      time: '06:00',
      employeeNames: [employeeName],
      overrideReason: OVERRIDE_REASON,
    });

    await openDispatchPanel(adminPage);
    await issueDispatchForOccurrence(adminPage, title);
    await acknowledgeDispatchOnJobPage(employeePage, mainJobNumber(world.runId));

    let state = await getDispatchState(world.orgId, mainJobNumber(world.runId));
    expect(state.dispatches).toHaveLength(1);
    expect(state.dispatches[0].currentRevisionNumber).toBe(1);
    expect(
      state.dispatches[0].acknowledgements.filter(
        (ack) => ack.revisionNumber === 1 && ack.state === 'acknowledged'
      )
    ).toHaveLength(1);

    // A material schedule change supersedes the revision in the same
    // transaction — the moved visit can never appear acknowledged.
    await editPlannedCalendarOccurrence(adminPage, {
      title,
      calendarDate: MAIN_DATE,
      scope: 'one',
      date: MAIN_MOVED_DATE,
      overrideReason: OVERRIDE_REASON,
    });
    state = await getDispatchState(world.orgId, mainJobNumber(world.runId));
    expect(state.dispatches[0].currentRevisionNumber).toBe(2);
    expect(state.dispatches[0].revisionChangeKinds).toEqual(['issued', 'schedule_changed']);
    // The old acknowledgement stays verbatim on revision 1; revision 2 has none.
    expect(
      state.dispatches[0].acknowledgements.filter(
        (ack) => ack.revisionNumber === 1 && ack.state === 'acknowledged'
      )
    ).toHaveLength(1);
    expect(
      state.dispatches[0].acknowledgements.filter((ack) => ack.revisionNumber === 2)
    ).toHaveLength(0);
    await expectDispatchStateOnJobPage(employeePage, mainJobNumber(world.runId), 'ausstehend');
  });

  test('a challenge reaches the office and a kept plan is re-confirmed', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const challengeReason = 'Terminüberschneidung mit anderem Einsatz.';
    await challengeDispatchOnJobPage(employeePage, mainJobNumber(world.runId), challengeReason);

    await openDispatchPanel(adminPage);
    const panel = adminPage.getByRole('complementary', { name: 'Einsätze' });
    await expect(
      panel
        .getByRole('region', { name: 'Offene Rückfragen' })
        .getByText(challengeReason, { exact: false })
    ).toBeVisible({ timeout: 20_000 });
    await resolveDispatchChallengeInPanel(
      adminPage,
      'Kunde besteht auf dem Termin, Einsatz bleibt.'
    );

    await expectDispatchStateOnJobPage(employeePage, mainJobNumber(world.runId), 'ausstehend');
    await acknowledgeDispatchOnJobPage(employeePage, mainJobNumber(world.runId));

    const state = await getDispatchState(world.orgId, mainJobNumber(world.runId));
    const acks = state.dispatches[0].acknowledgements;
    expect(
      acks.filter(
        (ack) =>
          ack.revisionNumber === 2 &&
          ack.state === 'challenged' &&
          ack.challengeResolution === 'kept'
      )
    ).toHaveLength(1);
    expect(
      acks.filter((ack) => ack.revisionNumber === 2 && ack.state === 'acknowledged')
    ).toHaveLength(1);
    for (const expected of [
      'issued',
      'revision_superseded',
      'challenged',
      'challenge_resolved',
      'acknowledged',
    ]) {
      expect(state.dispatches[0].eventTypes).toContain(expected);
    }
  });

  test('customer commitments stay separate and batch rescheduling is atomic with history', async ({
    adminPage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const mainTitle = `P1-12 Hauptbesuch ${world.runId}`;
    const batchTitle = `P1-12 Serienbesuch ${world.runId}`;
    await createJob(adminPage, {
      jobNumber: batchJobNumber(world.runId),
      title: batchTitle,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: batchJobNumber(world.runId),
      date: BATCH_DATE,
      time: '06:00',
      employeeNames: [employeeName],
      recurrence: { frequency: 'daily', count: 2 },
      overrideReason: OVERRIDE_REASON,
    });

    await openDispatchPanel(adminPage);
    await recordCommitmentForOccurrence(adminPage, mainTitle);
    const mainRow = dispatchOccurrenceRow(adminPage, mainTitle);
    await expect(mainRow.locator('[data-commitment-mismatch="false"]')).toBeVisible({
      timeout: 20_000,
    });

    const preview = await startBatchRescheduleInPanel(adminPage, {
      titles: [mainTitle, batchTitle],
      // MAIN has one visit, the BATCH series two.
      expectedCount: 3,
      dayShiftText: '1',
      reason: 'Krankheitsbedingte Umplanung der Einsatzwoche.',
    });
    // The preview names the consequences before anything moves: the recorded
    // promise will no longer match, and the confirmation becomes invalid.
    await expect(
      preview.getByText('Kundenzusagen weichen danach ab', { exact: false })
    ).toBeVisible();
    await expect(preview.getByText(/1 Bestätigung wird ungültig/)).toBeVisible();
    await confirmBatchReschedule(adminPage, preview, OVERRIDE_REASON);

    // All-or-nothing move: every selected occurrence shifted one day.
    const mainPlanning = await getPlanningState(world.orgId, {
      jobNumber: mainJobNumber(world.runId),
    });
    const batchPlanning = await getPlanningState(world.orgId, {
      jobNumber: batchJobNumber(world.runId),
    });
    expect(batchPlanning.occurrenceCount).toBe(2);
    const allEventTypes = [...mainPlanning.eventTypes, ...batchPlanning.eventTypes];
    expect(allEventTypes).toContain('batch_rescheduled');
    expect(mainPlanning.eventTypes).toContain('edited');

    // The commitment record itself never moved — the mismatch is the visible
    // required action, and no message was sent by the move.
    let commitments = await getCommitmentState(world.orgId, mainJobNumber(world.runId));
    expect(commitments).toHaveLength(1);
    expect(commitments[0].status).toBe('active');
    expect(commitments[0].committedDate).toBe(MAIN_MOVED_DATE);
    await expect(mainRow.locator('[data-commitment-mismatch="true"]')).toBeVisible({
      timeout: 20_000,
    });

    // Re-committing supersedes the old promise traceably.
    await recordCommitmentForOccurrence(adminPage, mainTitle);
    commitments = await getCommitmentState(world.orgId, mainJobNumber(world.runId));
    expect(commitments).toHaveLength(2);
    expect(commitments[0].status).toBe('superseded');
    expect(commitments[1].status).toBe('active');
    expect(commitments[1].committedDate).toBe(MAIN_BATCH_DATE);
    expect(commitments[1].supersedesId).not.toBeNull();
    await expect(mainRow.locator('[data-commitment-mismatch="false"]')).toBeVisible({
      timeout: 20_000,
    });

    // The batch move superseded the acknowledged dispatch revision again.
    const state = await getDispatchState(world.orgId, mainJobNumber(world.runId));
    expect(state.dispatches[0].currentRevisionNumber).toBe(3);
    expect(state.dispatches[0].revisionChangeKinds).toEqual([
      'issued',
      'schedule_changed',
      'schedule_changed',
    ]);
  });

  test('privacy, isolation, Realtime freshness, and zero actual time hold', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const liveSuffix = (process.env.WERKFLOW_RUN_KEY ?? world.runId).slice(-6);
    const liveJobNumber = `AUF-${world.runId}-P112-LIVE-${liveSuffix}`;
    const liveTitle = `P1-12 Echtzeit ${world.runId} ${liveSuffix}`;

    // This terminal stage creates its own run-scoped occurrence so retained
    // diagnostics can reconstruct the pre-dispatch state without replaying
    // the five preceding scenarios.
    await createJob(adminPage, {
      jobNumber: liveJobNumber,
      title: liveTitle,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: liveJobNumber,
      date: BATCH_DATE,
      time: '08:00',
      employeeNames: [employeeName],
      overrideReason: OVERRIDE_REASON,
    });

    // A second office user's open panel learns about a new dispatch live.
    await openDispatchPanel(bueroPage);
    const bueroRow = bueroPage
      .getByRole('complementary', { name: 'Einsätze' })
      .locator('[data-dispatch-occurrence]')
      .filter({ hasText: liveTitle });
    await expect(bueroRow).toBeVisible({ timeout: 20_000 });
    await expect(bueroRow.locator('[data-recipient-state]')).toHaveCount(0);

    await openDispatchPanel(adminPage);
    await issueDispatchForOccurrence(adminPage, liveTitle);
    await expectLiveWithin(bueroRow.locator('[data-recipient-state]'), {
      label: 'p1-12 dispatch state cross-session',
    });

    // Employees never see the office dispatch surface.
    await employeePage.goto('/kalender');
    await expect(employeePage.getByTestId('dispatch-panel-toggle')).toHaveCount(0);

    // RLS matrix with real credentials: managers see the organization,
    // recipients see exactly their own rows, outsiders see nothing.
    const adminView = await getVisibleDispatchStateAs(world.users.admin, world.orgId);
    const employeeView = await getVisibleDispatchStateAs(world.users.employee, world.orgId);
    const outsiderView = await getVisibleDispatchStateAs(world.outsider.admin, world.orgId);
    expect(adminView.planning_dispatches).toBeGreaterThan(0);
    expect(adminView.planning_dispatch_events).toBeGreaterThan(0);
    expect(adminView.planning_customer_commitments).toBeGreaterThan(0);
    expect(employeeView.planning_dispatches).toBeGreaterThan(0);
    expect(employeeView.planning_dispatch_acknowledgements).toBeGreaterThan(0);
    expect(employeeView.planning_dispatch_events).toBe(0);
    expect(employeeView.planning_customer_commitments).toBe(0);
    expect(employeeView.work_blockers).toBe(1);
    for (const count of Object.values(outsiderView)) expect(count).toBe(0);

    // Dispatch, acknowledgement, commitments, and rescheduling never created
    // job-linked actual time. This persisted-state proof is independently
    // replayable and does not depend on an earlier test's process memory.
    const planningStates = await Promise.all([
      getPlanningState(world.orgId, { jobNumber: parkJobNumber(world.runId) }),
      getPlanningState(world.orgId, { jobNumber: mainJobNumber(world.runId) }),
      getPlanningState(world.orgId, { jobNumber: batchJobNumber(world.runId) }),
      getPlanningState(world.orgId, { jobNumber: liveJobNumber }),
    ]);
    expect(planningStates.map((state) => state.actualTimeCount)).toEqual([0, 0, 0, 0]);
  });
});
