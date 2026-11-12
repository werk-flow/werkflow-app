import { expect, test } from '../support/fixtures';
import {
  beginWorkArtifact,
  workArtifactAction,
  workArtifactEntry,
  workArtifactField,
} from '../../golden/support/spec-helpers/work-artifact-dialog';
import { setNetwork } from '../support/offline-shell';
import {
  deviceDrafts,
  draftOnDevice,
  expectAttachedReports,
  expectDraftsOnDevice,
  photoButton,
  savedOnDeviceBanner,
  takeSyntheticPhoto,
} from '../support/offline-drafts';
import { seedTodayAssignment, todayJobNumber } from '../support/offline-today';

// A report with photos survives signal loss and a restart
// (werk-flow/werkflow-planning#320; decision record 0010, the report draft
// amendment): the field worker writes it without signal, the phone keeps the
// text and both photos when the page goes, and with the signal back the next
// page sends them: the server gets one draft revision with two photos, never a
// second. Browser tests run without the service worker (#365), so the restart
// is the tab leaving the app while offline and a new load once the signal is
// back, not an offline reload.

test('a report with two photos written without signal survives a restart and arrives once @AUDIT-SECURITY-OFFLINE-DRAFTS', async ({
  employeePage: page,
  world,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const jobTitle = `Heizung warten ${world.runId}`;
  const reportTitle = `Wartungsbericht ${world.runId}`;
  await seedTodayAssignment(world, { title: jobTitle, instruction: `Brenner prüfen ${world.runId}` });
  const jobNumber = todayJobNumber(world);

  const dialog = await test.step('the field worker opens the job and starts a report', async () => {
    await page.goto(`/auftraege/${jobNumber}`);
    return beginWorkArtifact(page, {
      kind: 'work_report',
      title: reportTitle,
      summary: 'Jahreswartung der Heizung.',
      strict: true,
    });
  });

  await test.step('the signal goes: the report and two photos are saved on the phone', async () => {
    // The dialog keeps its draft on the device from here on.
    await expect(photoButton(dialog)).toBeVisible();
    await setNetwork(page, 'offline');
    await workArtifactField(dialog, 'performedWork').fill('Brenner gereinigt, Druck geprüft.');
    await takeSyntheticPhoto(dialog, 1);
    await takeSyntheticPhoto(dialog, 2);
    await workArtifactAction(dialog, 'saveDraft').click();
    await expect(savedOnDeviceBanner(page)).toBeVisible();
    await expect(draftOnDevice(page, reportTitle)).toBeVisible();
    await expectAttachedReports(world, reportTitle, []);
  });

  await test.step('the tab leaves the app without signal; the phone keeps the draft', async () => {
    await page.goto('about:blank');
    await expectDraftsOnDevice(page, 1);
  });

  await test.step('after the restart with the signal back, the job page sends the draft', async () => {
    await setNetwork(page, 'online');
    await page.goto(`/auftraege/${jobNumber}`);
    await expectDraftsOnDevice(page, 0);
    await page.reload();
    await expect(workArtifactEntry(page, reportTitle)).toBeVisible();
    await expect(deviceDrafts(page)).toBeHidden();
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
