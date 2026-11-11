import { expect, test } from '../support/fixtures';
import {
  beginWorkArtifact,
  workArtifactAction,
  workArtifactEntry,
  workArtifactField,
} from '../../golden/support/spec-helpers/work-artifact-dialog';
import { bypassHttpCache, setNetwork, waitForOfflineShell } from '../support/offline-shell';
import {
  deviceDrafts,
  draftOnDevice,
  expectAttachedReports,
  expectDraftsOnDevice,
  savedOnDeviceBanner,
  takeSyntheticPhoto,
} from '../support/offline-drafts';
import {
  offlineStand,
  seedTodayAssignment,
  todayJobNumber,
  waitForTodayOnDevice,
} from '../support/offline-today';

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

  const dialog = await test.step('the field worker opens the job and starts a report', async () => {
    await page.goto('/dashboard');
    await waitForTodayOnDevice(page, [jobTitle]);
    await waitForOfflineShell(page);
    await page.goto(`/auftraege/${jobNumber}`);
    return beginWorkArtifact(page, {
      kind: 'work_report',
      title: reportTitle,
      summary: 'Jahreswartung der Heizung.',
      strict: true,
    });
  });

  await test.step('the signal goes: the report and two photos are saved on the phone', async () => {
    await bypassHttpCache(page);
    await setNetwork(page, 'offline');
    await workArtifactField(dialog, 'performedWork').fill('Brenner gereinigt, Druck geprüft.');
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
    const restarted = await page.context().newPage();
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
      { status: 'draft', version: 3, revisions: 1, photos: 2, operations: 1 },
    ]);
  });

  await test.step('a later visit of the job page sends nothing again', async () => {
    await page.goto(`/auftraege/${jobNumber}`);
    await expect(workArtifactEntry(page, reportTitle)).toBeVisible();
    await expect(deviceDrafts(page)).toBeHidden();
    await expectAttachedReports(world, reportTitle, [
      { status: 'draft', version: 3, revisions: 1, photos: 2, operations: 1 },
    ]);
  });
});
