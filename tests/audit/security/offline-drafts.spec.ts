import { expect, test } from '../support/fixtures';
import {
  beginWorkArtifact,
  workArtifactAction,
  workArtifactEntry,
  workArtifactField,
} from '../../golden/support/spec-helpers/work-artifact-dialog';
import { openPage } from '../../golden/support/streamed-content';
import { bypassHttpCache, setNetwork, waitForOfflineShell } from '../support/offline-shell';
import {
  closePhoneMenu,
  deviceDraftSendButton,
  deviceDrafts,
  draftOnDevice,
  expectAttachedReports,
  expectDraftNamedInQuestion,
  expectDraftsOnDevice,
  photoButton,
  savedOnDeviceBanner,
  startSignOut,
  takeSyntheticPhoto,
  trackRequestsInFlight,
  waitUntilPageIdle,
} from '../support/offline-drafts';
import {
  offlineStand,
  seedTodayAssignment,
  todayJobNumber,
  waitForTodayOnDevice,
} from '../support/offline-today';
import { UNSENT_COPY, unsentWorkDialog } from '../support/time-outbox';

// The offline reload reads the app shell the service worker serves.
test.use({ serviceWorkers: 'allow' });

// A report with photos survives signal loss and a restart
// (werk-flow/werkflow-planning#320; decision record 0010, the report draft
// amendment): the field worker writes it without signal, the phone keeps the
// text and both photos across a reload and a new page, and with the signal
// back the server gets one draft revision with two photos, never a second.

test('a report with two photos written without signal survives a reload and arrives once @AUDIT-SECURITY-OFFLINE-DRAFTS', async ({
  employeePage: page,
  world,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const jobTitle = `Heizung warten ${world.runId}`;
  const reportTitle = `Wartungsbericht ${world.runId}`;
  await seedTodayAssignment(world, { title: jobTitle, instruction: `Brenner prüfen ${world.runId}` });
  const jobNumber = todayJobNumber(world);
  const offlineText = 'Brenner gereinigt, Druck geprüft.';

  await test.step('the field worker opens the job while the phone has signal', async () => {
    await page.goto('/dashboard');
    await waitForTodayOnDevice(page, [jobTitle]);
    await waitForOfflineShell(page);
    const inFlight = trackRequestsInFlight(page);
    await page.goto(`/auftraege/${jobNumber}`);
    // Nothing opens the report yet: what the page loads once idle is all the phone will have.
    await waitUntilPageIdle(page, inFlight);
  });

  const dialog = await test.step('the signal goes: the first open of the report still works', async () => {
    await bypassHttpCache(page);
    await setNetwork(page, 'offline');
    return beginWorkArtifact(page, {
      kind: 'work_report',
      title: reportTitle,
      summary: 'Jahreswartung der Heizung.',
      strict: true,
    });
  });

  await test.step('the report and two photos are saved on the phone', async () => {
    // The dialog keeps its draft on the device from here on.
    await expect(photoButton(dialog)).toBeVisible();
    await workArtifactField(dialog, 'performedWork').fill(offlineText);
    await takeSyntheticPhoto(dialog, 1);
    await takeSyntheticPhoto(dialog, 2);
    await workArtifactAction(dialog, 'saveDraft').click();
    await expect(savedOnDeviceBanner(page)).toBeVisible();
    await expect(draftOnDevice(page, reportTitle)).toBeVisible();
    await expectAttachedReports(world, reportTitle, []);
  });

  await test.step('a reload without network keeps the draft on the phone', async () => {
    await page.reload();
    await expect(offlineStand(page)).toBeVisible();
    await expectDraftsOnDevice(page, 1);
  });

  await test.step('after a restart with the signal back, the job page sends the draft', async () => {
    await setNetwork(page, 'online');
    const restarted = await openPage(page.context());
    await restarted.setViewportSize({ width: 375, height: 812 });
    await restarted.goto(`/auftraege/${jobNumber}`);
    await expect(deviceDrafts(restarted)).toBeHidden();
    await expectDraftsOnDevice(restarted, 0);
    await restarted.reload();
    await expect(workArtifactEntry(restarted, reportTitle)).toBeVisible();
    await restarted.close();
  });

  await test.step('the server holds one draft revision with two photos', async () => {
    // One version for the revision and one for each photo link.
    await expectAttachedReports(world, reportTitle, [
      { status: 'draft', version: 3, revisions: 1, photos: 2, operations: 1, performedWork: [offlineText] },
    ]);
  });

  await test.step('a later visit of the job page sends nothing again', async () => {
    await page.goto(`/auftraege/${jobNumber}`);
    await expect(workArtifactEntry(page, reportTitle)).toBeVisible();
    await expect(deviceDrafts(page)).toBeHidden();
    await expectAttachedReports(world, reportTitle, [
      { status: 'draft', version: 3, revisions: 1, photos: 2, operations: 1, performedWork: [offlineText] },
    ]);
  });
});

// A session end asks about an unsent report draft too (werk-flow/werkflow-planning#403; decision
// record 0010, the amendment "a session end asks about report drafts"). The draft is written without
// signal; with the signal back the sync handler still does not answer, as on a weak connection, so
// the draft is still on the phone when the person signs out. Without signal at all the question's
// code cannot load yet (werk-flow/werkflow-planning#407); lib/ui/session-end-offline-check.test.ts pins that.

test('a sign-out names an unsent report draft with its photo, keeps it on „Abbrechen“, and asks nothing once it is sent @AUDIT-SECURITY-OFFLINE-DRAFTS', async ({
  employeePage: page,
  world,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const jobTitle = `Heizung prüfen ${world.runId}`;
  const reportTitle = `Prüfbericht ${world.runId}`;
  const offlineText = 'Ausdehnungsgefäß getauscht.';
  // The spec's first test seeded today's job under todayJobNumber(world) in the same world.
  const jobNumber = `${todayJobNumber(world)}-ABMELDEN`;
  await seedTodayAssignment(world, {
    title: jobTitle,
    instruction: `Druck prüfen ${world.runId}`,
    jobNumber,
  });
  const syncPath = '**/api/field-sync/v1/operations';

  await test.step('the field worker opens the job while the phone has signal', async () => {
    await page.goto('/dashboard');
    await waitForTodayOnDevice(page, [jobTitle]);
    await waitForOfflineShell(page);
    const inFlight = trackRequestsInFlight(page);
    await page.goto(`/auftraege/${jobNumber}`);
    await waitUntilPageIdle(page, inFlight);
  });

  await test.step('without signal, the report and a photo are saved on the phone', async () => {
    await bypassHttpCache(page);
    await setNetwork(page, 'offline');
    const dialog = await beginWorkArtifact(page, {
      kind: 'work_report',
      title: reportTitle,
      summary: 'Heizung geprüft.',
      strict: true,
    });
    await expect(photoButton(dialog)).toBeVisible();
    await workArtifactField(dialog, 'performedWork').fill(offlineText);
    await takeSyntheticPhoto(dialog, 1);
    await workArtifactAction(dialog, 'saveDraft').click();
    await expect(savedOnDeviceBanner(page)).toBeVisible();
    await expect(draftOnDevice(page, reportTitle)).toBeVisible();
  });

  await test.step('the signal is back, but the sync handler does not answer yet', async () => {
    await page.route(syncPath, (route) => route.abort('connectionfailed'));
    await setNetwork(page, 'online');
    await expectDraftsOnDevice(page, 1);
  });

  await test.step('the sign-out names the draft by its title, never its text; „Abbrechen“ keeps the session and the draft', async () => {
    await startSignOut(page);
    const question = unsentWorkDialog(page);
    await expectDraftNamedInQuestion(question, reportTitle, offlineText);
    await question.getByRole('button', { name: UNSENT_COPY.cancel, exact: true }).click();
    await expect(question).toHaveCount(0);
    await closePhoneMenu(page);
    await expect(page).toHaveURL(new RegExp(`/auftraege/${jobNumber}`));
    await expectDraftsOnDevice(page, 1);
  });

  await test.step('with the handler answering, the person sends the draft', async () => {
    await page.unroute(syncPath);
    await deviceDraftSendButton(page, reportTitle).click();
    await expectDraftsOnDevice(page, 0);
    await expectAttachedReports(world, reportTitle, [
      { status: 'draft', version: 2, revisions: 1, photos: 1, operations: 1, performedWork: [offlineText] },
    ]);
  });

  await test.step('the next sign-out asks nothing and ends the session', async () => {
    await startSignOut(page);
    await page.waitForURL('**/login**');
    await expect(unsentWorkDialog(page)).toHaveCount(0);
  });
});
