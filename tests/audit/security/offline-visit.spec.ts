import { expect, test } from '../support/fixtures';
import {
  beginWorkArtifact,
  workArtifactAction,
  workArtifactEntry,
  workArtifactField,
} from '../../golden/support/spec-helpers/work-artifact-dialog';
import { openPage } from '../../golden/support/streamed-content';
import { loginViaUi } from '../../golden/support/steps/organization';
import { clockDock, clockInLauncher, clockStartSheet } from '../../golden/support/steps/time-tracking';
import { changeTimeOnWorkPack, jobInstructionItem } from '../../golden/support/steps/work';
import { bypassHttpCache, setNetwork, waitForOfflineShell } from '../support/offline-shell';
import {
  deviceDrafts,
  draftOnDevice,
  expectAttachedReports,
  expectDraftsOnDevice,
  photoButton,
  savedOnDeviceBanner,
  takeSyntheticPhoto,
  trackRequestsInFlight,
  waitUntilPageIdle,
} from '../support/offline-drafts';
import {
  changeInstruction,
  offlinePackText,
  offlineStand,
  seedTodayAssignment,
  todayJobNumber,
  waitForTodayOnDevice,
} from '../support/offline-today';
import {
  UNSENT_COPY,
  expectStartRecordedAtCapturedTime,
  expectTimeEventsOnDevice,
  offlineClock,
  offlineClockAction,
  startWorkAction,
  unsentBadge,
  unsentSection,
} from '../support/time-outbox';
import {
  OFFLINE_VISIT_COPY,
  blockJobStart,
  closeCurrentMonth,
  expectRecordedClock,
  openUnsentSection,
  removeMember,
  reopenCurrentMonth,
  unsentReason,
  unsentResendButton,
} from '../support/offline-visit';

// A field visit without signal, end to end (werk-flow/werkflow-planning#321;
// decision record 0010): the technician's phone keeps today's assignment, the
// clock and a report with photos across signal loss and a restart, while the
// office changes the job. With the signal back everything the server can take
// arrives once, and what it refuses stays on the phone with its reason. The
// office's side: a replay into a closed month and a replay after the person's
// membership was removed both reach the real handler and fail safely.

// The reload and the restart without signal read what the service worker serves.
test.use({ serviceWorkers: 'allow' });

test('E7-F01 a visit without signal survives a restart, and with signal everything arrives once while the conflict stays shown @AUDIT-SECURITY-OFFLINE-VISIT', async ({
  employeePage: page,
  world,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const title = `Heizung tauschen ${world.runId}`;
  const instruction = `Druckprobe dokumentieren ${world.runId}`;
  const changedInstruction = `Druckprobe mit 6 bar dokumentieren ${world.runId}`;
  const reportTitle = `Besuchsbericht ${world.runId}`;
  const performedWork = 'Alte Pumpe ausgebaut, Leitungen gespült.';
  await seedTodayAssignment(world, { title, instruction });
  const jobNumber = todayJobNumber(world);
  const technician = world.users.employee;

  await test.step("with signal, the phone keeps today's assignment and opens the job", async () => {
    await page.goto('/dashboard');
    await waitForTodayOnDevice(page, [title, instruction]);
    await waitForOfflineShell(page);
    const inFlight = trackRequestsInFlight(page);
    await page.goto(`/auftraege/${jobNumber}`);
    await expect(jobInstructionItem(page, instruction)).toBeVisible();
    // What the job page loads once idle is all the phone will have without signal.
    await waitUntilPageIdle(page, inFlight);
  });

  await test.step('the signal goes: the clock starts, and the report with two photos stays on the phone', async () => {
    // Only the worker's cache may serve the page's files from here on.
    await bypassHttpCache(page);
    await setNetwork(page, 'offline');
    await clockInLauncher(page).click();
    await startWorkAction(clockStartSheet(page)).click();
    await expect(unsentBadge(clockDock(page), UNSENT_COPY.waiting)).toBeVisible();

    const dialog = await beginWorkArtifact(page, {
      kind: 'work_report',
      title: reportTitle,
      summary: 'Umwälzpumpe getauscht.',
      strict: true,
    });
    await expect(photoButton(dialog)).toBeVisible();
    await workArtifactField(dialog, 'performedWork').fill(performedWork);
    await takeSyntheticPhoto(dialog, 1);
    await takeSyntheticPhoto(dialog, 2);
    await workArtifactAction(dialog, 'saveDraft').click();
    await expect(savedOnDeviceBanner(page)).toBeVisible();
    await expect(draftOnDevice(page, reportTitle)).toBeVisible();

    // The work moves onto the job; the page keeps the switch behind the start.
    await changeTimeOnWorkPack(page, 'switch');
  });

  await test.step('a reload without signal shows the assignment, the running clock and keeps the report', async () => {
    await page.reload();
    await expect(offlineStand(page)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(offlinePackText(page, instruction)).toBeVisible();
    await expect(unsentBadge(offlineClock(page), UNSENT_COPY.waiting)).toBeVisible();
    await expectTimeEventsOnDevice(page, ['start', 'switch']);
    await expectDraftsOnDevice(page, 1);
  });

  const restarted =
    await test.step('after a restart the phone still holds everything and ends the work', async () => {
      const next = await openPage(page.context());
      await next.setViewportSize({ width: 375, height: 812 });
      await bypassHttpCache(next);
      await next.goto(`/auftraege/${jobNumber}`);
      await expect(next.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(offlineStand(next)).toBeVisible();
      await offlineClockAction(next, UNSENT_COPY.end).click();
      await expect(offlineClock(next)).toContainText(UNSENT_COPY.clockedOut);
      await expectTimeEventsOnDevice(next, ['start', 'switch', 'end']);
      await expectDraftsOnDevice(next, 1);
      return next;
    });
  await page.close();

  await test.step('meanwhile the office changes the instruction and holds the job for a delivery', async () => {
    await changeInstruction(world, changedInstruction);
    await blockJobStart(world, `Pumpe kommt erst morgen ${world.runId}`);
  });

  // The start alone is recorded, once, as work without a job (its captured time is checked as it arrives).
  const startRecorded = {
    operations: [{ kind: 'start', captured: true }],
    sessions: [{ open: true, segments: [{ kind: 'work', onJob: false }] }],
  };

  await test.step('with signal again, the start arrives once and the switch stays shown as a conflict', async () => {
    await expectStartRecordedAtCapturedTime(restarted, world, async () => {
      await setNetwork(restarted, 'online');
      await restarted.goto('/dashboard');
    });
    await expect(unsentBadge(clockDock(restarted), OFFLINE_VISIT_COPY.conflict)).toBeVisible();
    await expectTimeEventsOnDevice(restarted, ['switch', 'end']);
    await expectRecordedClock(world, technician, startRecorded);
    const section = await openUnsentSection(restarted, true);
    await expect(unsentReason(section, OFFLINE_VISIT_COPY.officeChanged)).toBeVisible();
  });

  await test.step('the changed instruction reaches the phone', async () => {
    await waitForTodayOnDevice(restarted, [title, changedInstruction]);
    await restarted.goto(`/auftraege/${jobNumber}`);
    await expect(jobInstructionItem(restarted, changedInstruction)).toBeVisible();
  });

  await test.step('the report arrives once: one revision with two photos', async () => {
    await expect(deviceDrafts(restarted)).toBeHidden();
    await expectDraftsOnDevice(restarted, 0);
    await restarted.reload();
    await expect(workArtifactEntry(restarted, reportTitle)).toBeVisible();
    await expectAttachedReports(world, reportTitle, [
      { status: 'draft', version: 3, revisions: 1, photos: 2, operations: 1, performedWork: [performedWork] },
    ]);
  });

  await test.step('a later start sends nothing again and keeps the conflict shown', async () => {
    const later = await openPage(restarted.context());
    await later.setViewportSize({ width: 375, height: 812 });
    await later.goto('/dashboard');
    await expect(unsentBadge(clockDock(later), OFFLINE_VISIT_COPY.conflict)).toBeVisible();
    await expectTimeEventsOnDevice(later, ['switch', 'end']);
    await expectRecordedClock(world, technician, startRecorded);
    await expectAttachedReports(world, reportTitle, [
      { status: 'draft', version: 3, revisions: 1, photos: 2, operations: 1, performedWork: [performedWork] },
    ]);
    await later.close();
  });
});

test('E7-F01 a replay into a closed month and a replay after the membership was removed fail safely and stay on the phone @AUDIT-SECURITY-OFFLINE-VISIT', async ({
  browser,
  world,
}) => {
  // A member of its own, so the removal takes nobody another journey of this world needs.
  const member = world.removableEmployee;
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await openPage(context);

  await test.step('the phone opens the app with signal', async () => {
    await loginViaUi(page, member);
    await expect(clockInLauncher(page)).toBeEnabled();
  });

  await test.step('a start without signal is kept on the phone', async () => {
    await setNetwork(page, 'offline');
    await clockInLauncher(page).click();
    await startWorkAction(clockStartSheet(page)).click();
    await expect(unsentBadge(clockDock(page), UNSENT_COPY.waiting)).toBeVisible();
  });

  await test.step('the office closes the month: the replay is refused and stays on the phone', async () => {
    await closeCurrentMonth(world);
    await setNetwork(page, 'online');
    await page.goto('/dashboard');
    await expect(unsentBadge(clockDock(page), UNSENT_COPY.refused)).toBeVisible();
    await expect(
      unsentReason(await openUnsentSection(page, false), OFFLINE_VISIT_COPY.closedPeriod),
    ).toBeVisible();
    await expectTimeEventsOnDevice(page, ['start']);
    await expectRecordedClock(world, member, { operations: [], sessions: [] });
  });

  await test.step('the office reopens the month and removes the member: a resend is refused and stays', async () => {
    await reopenCurrentMonth(world);
    await removeMember(world, member);
    const section = unsentSection(page);
    await unsentResendButton(section).click();
    await expect(unsentReason(section, OFFLINE_VISIT_COPY.noAccess)).toBeVisible();
    await expectTimeEventsOnDevice(page, ['start']);
    await expectRecordedClock(world, member, { operations: [], sessions: [] });
  });

  await context.close();
});
