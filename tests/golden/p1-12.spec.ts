import { expect, test } from './support/fixtures';
import { expectLiveWithin } from './support/live';
import { getPlanningState } from './support/db/calendar';
import { getCommitmentState, getDispatchState, getParkingState } from './support/db/dispatch';
import { berlinDateAtOffset } from './support/date-ownership';
import { dispatchTaskGroup } from './support/steps/attention';
import { createPlannedCalendarEntry, editPlannedCalendarOccurrence } from './support/steps/calendar';
import {
  acknowledgeDispatchOnJobPage,
  batchPreviewNotice,
  challengeDispatchOnJobPage,
  confirmBatchReschedule,
  dispatchOccurrenceRow,
  dispatchPanelOccurrences,
  dispatchPanelRegion,
  dispatchParkedJobFromParkplatz,
  expectDispatchStateOnJobPage,
  issueDispatchForOccurrence,
  openChallengesRegion,
  openDispatchPanel,
  openParkplatzPanel,
  parkplatzCard,
  recordCommitmentForOccurrence,
  resolveDispatchChallengeInPanel,
  startBatchRescheduleInPanel,
} from './support/steps/dispatch';
import { expectGone, testData } from './support/steps/shared';
import { createJob, parkJobOnJobPage } from './support/steps/work';

// P1-12 — the dispatch journeys an office walks: parked backlog work sent and
// later scheduled, a dispatch acknowledged, invalidated and re-confirmed, a
// customer commitment kept apart from an atomic batch move, and live dispatch
// state in a second office session. Acknowledgement-without-time, commitment
// separation, batch history and dispatch privacy are database rules in
// supabase/tests/planning_dispatch.sql. Edge cases and role variants live in
// audit A7. Visits use 06:00 so they stay clear of other planned work.

const OVERRIDE_REASON = 'Betrieblich abgestimmter P1-12 Einsatz.';

test.describe('P1-12 dispatch, batch rescheduling, readiness, acknowledgement, and commitments @P1-12 @GG-03', () => {
  test('parked backlog work is dispatched unscheduled and scheduling moves the same dispatch onto the visit', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const jobNumber = `AUF-${world.runId}-P112-PARK`;
    const title = `P1-12 Rückstau ${world.runId}`;
    const reviewDate = berlinDateAtOffset(4);

    await test.step('park the job with its context', async () => {
      await createJob(adminPage, { jobNumber, title });
      // Parks with the material reason and waits until the dialog closed.
      await parkJobOnJobPage(
        adminPage,
        jobNumber,
        'Rückstau bis zur Lieferung.',
        world.users.admin.firstName,
        reviewDate,
      );

      await openParkplatzPanel(adminPage);
      const card = parkplatzCard(adminPage, title);
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.locator('[data-parking-context="set"]')).toBeVisible({ timeout: 20_000 });
      const parking = await getParkingState(world.orgId, jobNumber);
      expect(parking.context?.reason).toBe('warten_auf_material');
      expect(parking.context?.nextReviewDate).toBe(reviewDate);
    });

    await test.step('send the unscheduled dispatch from the Parkplatz', async () => {
      await dispatchParkedJobFromParkplatz(adminPage, { jobTitle: title, recipientName: employeeName });
      const state = await getDispatchState(world.orgId, jobNumber);
      expect(state.dispatches).toHaveLength(1);
      expect(state.dispatches[0]?.targetKind).toBe('job');
      expect(state.dispatches[0]?.revisionChangeKinds).toEqual(['issued']);

      // The recipient sees the pending confirmation on the shared surface.
      await employeePage.goto('/aufgaben');
      const taskGroup = dispatchTaskGroup(employeePage);
      await expect(taskGroup).toBeVisible({ timeout: 20_000 });
      await expect(taskGroup.getByText(title, { exact: true })).toBeVisible();
    });

    await test.step('schedule the job: the dispatch moves onto the visit, the parking stays', async () => {
      await createPlannedCalendarEntry(adminPage, {
        kind: 'job_visit',
        jobSearch: jobNumber,
        date: berlinDateAtOffset(3),
        time: '06:00',
        employeeNames: [employeeName],
        overrideReason: OVERRIDE_REASON,
      });
      const state = await getDispatchState(world.orgId, jobNumber);
      expect(state.dispatches).toHaveLength(1);
      expect(state.dispatches[0]?.targetKind).toBe('occurrence');
      expect(state.dispatches[0]?.revisionChangeKinds).toEqual(['issued', 'target_scheduled']);
      const parking = await getParkingState(world.orgId, jobNumber);
      expect(parking.context?.reason).toBe('warten_auf_material');
    });
  });

  test('a dispatch is acknowledged, a move invalidates it, and a kept challenge is confirmed again', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const jobNumber = `AUF-${world.runId}-P112-MAIN`;
    const title = `P1-12 Hauptbesuch ${world.runId}`;
    const visitDate = berlinDateAtOffset(5);
    const challengeReason = testData`Terminüberschneidung mit anderem Einsatz.`;

    await test.step('send the dispatch and acknowledge it', async () => {
      await createJob(adminPage, { jobNumber, title });
      await createPlannedCalendarEntry(adminPage, {
        kind: 'job_visit',
        jobSearch: jobNumber,
        date: visitDate,
        time: '06:00',
        employeeNames: [employeeName],
        overrideReason: OVERRIDE_REASON,
      });
      await openDispatchPanel(adminPage);
      await issueDispatchForOccurrence(adminPage, title);
      await acknowledgeDispatchOnJobPage(employeePage, jobNumber);
      const state = await getDispatchState(world.orgId, jobNumber);
      expect(
        state.dispatches[0]?.acknowledgements.filter(
          (ack) => ack.revisionNumber === 1 && ack.state === 'acknowledged',
        ),
      ).toHaveLength(1);
    });

    await test.step('move the visit: the worker must confirm again', async () => {
      await editPlannedCalendarOccurrence(adminPage, {
        title,
        calendarDate: visitDate,
        scope: 'one',
        date: berlinDateAtOffset(6),
        overrideReason: OVERRIDE_REASON,
      });
      await expectDispatchStateOnJobPage(employeePage, jobNumber, 'ausstehend');
      const state = await getDispatchState(world.orgId, jobNumber);
      expect(state.dispatches[0]?.revisionChangeKinds).toEqual(['issued', 'schedule_changed']);
    });

    await test.step('the worker challenges, the office keeps the plan, the worker confirms it', async () => {
      await challengeDispatchOnJobPage(employeePage, jobNumber, challengeReason);
      await openDispatchPanel(adminPage);
      await expect(openChallengesRegion(adminPage).getByText(challengeReason, { exact: false })).toBeVisible({
        timeout: 20_000,
      });
      await resolveDispatchChallengeInPanel(adminPage, 'Kunde besteht auf dem Termin, Einsatz bleibt.');

      await expectDispatchStateOnJobPage(employeePage, jobNumber, 'ausstehend');
      await acknowledgeDispatchOnJobPage(employeePage, jobNumber);
      const state = await getDispatchState(world.orgId, jobNumber);
      const acknowledgements = state.dispatches[0]?.acknowledgements ?? [];
      expect(
        acknowledgements.filter(
          (ack) =>
            ack.revisionNumber === 2 && ack.state === 'challenged' && ack.challengeResolution === 'kept',
        ),
      ).toHaveLength(1);
      expect(
        acknowledgements.filter((ack) => ack.revisionNumber === 2 && ack.state === 'acknowledged'),
      ).toHaveLength(1);
    });
  });

  test('a customer commitment stays put while a batch moves visits across jobs at once', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const mainJobNumber = `AUF-${world.runId}-P112-ZUSAGE`;
    const mainTitle = `P1-12 Zusagebesuch ${world.runId}`;
    const batchJobNumber = `AUF-${world.runId}-P112-BATCH`;
    const batchTitle = `P1-12 Serienbesuch ${world.runId}`;
    const mainDate = berlinDateAtOffset(7);

    await test.step('prepare an acknowledged visit and a two-visit series', async () => {
      await createJob(adminPage, { jobNumber: mainJobNumber, title: mainTitle });
      await createPlannedCalendarEntry(adminPage, {
        kind: 'job_visit',
        jobSearch: mainJobNumber,
        date: mainDate,
        time: '06:00',
        employeeNames: [employeeName],
        overrideReason: OVERRIDE_REASON,
      });
      await createJob(adminPage, { jobNumber: batchJobNumber, title: batchTitle });
      await createPlannedCalendarEntry(adminPage, {
        kind: 'job_visit',
        jobSearch: batchJobNumber,
        date: berlinDateAtOffset(9),
        time: '06:00',
        employeeNames: [employeeName],
        recurrence: { frequency: 'daily', count: 2 },
        overrideReason: OVERRIDE_REASON,
      });
      await openDispatchPanel(adminPage);
      await issueDispatchForOccurrence(adminPage, mainTitle);
      await acknowledgeDispatchOnJobPage(employeePage, mainJobNumber);
    });

    await test.step('record the customer commitment', async () => {
      await openDispatchPanel(adminPage);
      await recordCommitmentForOccurrence(adminPage, mainTitle);
      await expect(
        dispatchOccurrenceRow(adminPage, mainTitle).locator('[data-commitment-mismatch="false"]'),
      ).toBeVisible({ timeout: 20_000 });
      const commitments = await getCommitmentState(world.orgId, mainJobNumber);
      expect(commitments.map((commitment) => commitment.committedDate)).toEqual([mainDate]);
    });

    await test.step('preview and run the batch move of all three visits', async () => {
      const preview = await startBatchRescheduleInPanel(adminPage, {
        titles: [mainTitle, batchTitle],
        expectedCount: 3,
        dayShiftText: '1',
        reason: 'Krankheitsbedingte Umplanung der Einsatzwoche.',
      });
      // The preview names the consequences before anything moves.
      await expect(batchPreviewNotice(preview, 'commitmentMismatch')).toBeVisible();
      await expect(batchPreviewNotice(preview, 'oneConfirmationInvalidated')).toBeVisible();
      await confirmBatchReschedule(adminPage, preview, OVERRIDE_REASON);

      await expect(
        dispatchOccurrenceRow(adminPage, mainTitle).locator('[data-commitment-mismatch="true"]'),
      ).toBeVisible({ timeout: 20_000 });
      const batchPlanning = await getPlanningState(world.orgId, { jobNumber: batchJobNumber });
      // The move writes one batch event for the whole selection, on whichever
      // occurrence leads it, so the proof reads both jobs' histories.
      const mainPlanning = await getPlanningState(world.orgId, { jobNumber: mainJobNumber });
      expect([...mainPlanning.eventTypes, ...batchPlanning.eventTypes]).toContain('batch_rescheduled');
      expect(batchPlanning.occurrences.every((occurrence) => occurrence.isException)).toBe(true);
    });

    await test.step('a new commitment supersedes the old one', async () => {
      await recordCommitmentForOccurrence(adminPage, mainTitle);
      await expect(
        dispatchOccurrenceRow(adminPage, mainTitle).locator('[data-commitment-mismatch="false"]'),
      ).toBeVisible({ timeout: 20_000 });
      const commitments = await getCommitmentState(world.orgId, mainJobNumber);
      expect(commitments.map((commitment) => commitment.status)).toEqual(['superseded', 'active']);
      expect(commitments[1]?.committedDate).toBe(berlinDateAtOffset(8));
    });
  });

  test('a second office session sees a new dispatch live and field workers never see the panel @FRESHNESS', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const liveSuffix = (process.env.WERKFLOW_RUN_KEY ?? world.runId).slice(-6);
    const liveJobNumber = `AUF-${world.runId}-P112-LIVE-${liveSuffix}`;
    const liveTitle = `P1-12 Echtzeit ${world.runId} ${liveSuffix}`;

    await createJob(adminPage, { jobNumber: liveJobNumber, title: liveTitle });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: liveJobNumber,
      date: berlinDateAtOffset(11),
      time: '06:00',
      employeeNames: [employeeName],
      overrideReason: OVERRIDE_REASON,
    });

    // A second office user's open panel learns about a new dispatch live.
    await openDispatchPanel(bueroPage);
    const bueroRow = dispatchPanelOccurrences(dispatchPanelRegion(bueroPage), liveTitle);
    await expect(bueroRow).toBeVisible({ timeout: 20_000 });
    await expectGone(bueroRow.locator('[data-recipient-state]'));

    await openDispatchPanel(adminPage);
    await expectLiveWithin(bueroRow.locator('[data-recipient-state]'), {
      label: 'p1-12 dispatch state cross-session',
      actingPage: adminPage,
      mutation: (beforeSubmit) => issueDispatchForOccurrence(adminPage, liveTitle, beforeSubmit),
    });
    const state = await getDispatchState(world.orgId, liveJobNumber);
    expect(state.dispatches.map((dispatch) => dispatch.status)).toEqual(['active']);

    // Field workers never see the office dispatch surface.
    await employeePage.goto('/kalender');
    await expect(employeePage.getByTestId('dispatch-panel-toggle')).toHaveCount(0);
  });
});
