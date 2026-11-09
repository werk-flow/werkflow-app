import { expect, test } from '../support/fixtures';
import { signOutViaUi } from '../../golden/support/steps/organization';
import { bypassHttpCache, offlineFallback, setNetwork, waitForOfflineShell } from '../support/offline-shell';
import {
  changeInstruction,
  expectNoTodayOnDevice,
  offlineBackToList,
  offlineListEntry,
  offlinePackText,
  offlineStand,
  offlineTodayList,
  seedTodayAssignment,
  todayJobNumber,
  wipeTodayFromPage,
  waitForTodayOnDevice,
} from '../support/offline-today';

// Today's assignments stay readable without signal (werk-flow/werkflow-planning#318;
// decision record 0010, "Device data"): the start page stores the field
// worker's day on the phone, a reload without network shows the work pack
// from that store with its „Stand“, a restart reads it again, a changed office
// instruction arrives with the next refresh, and sign-out leaves nothing.

test("today's work pack reads without signal and leaves the phone on sign-out @AUDIT-SECURITY-OFFLINE-TODAY", async ({
  employeePage: page,
  world,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const title = `Heizung tauschen ${world.runId}`;
  const instruction = `Druckprobe dokumentieren ${world.runId}`;
  await seedTodayAssignment(world, { title, instruction });
  const jobNumber = todayJobNumber(world);

  await test.step('the start page stores the day on the phone', async () => {
    await page.goto('/dashboard');
    await waitForTodayOnDevice(page, [title, instruction]);
    await waitForOfflineShell(page);
  });

  await test.step('a reload without network shows the work pack from the phone with its „Stand“', async () => {
    await page.goto(`/auftraege/${jobNumber}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    // Only the worker's cache may serve the page's files.
    await bypassHttpCache(page);
    await setNetwork(page, 'offline');
    await page.reload();
    await expect(offlineStand(page)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(offlinePackText(page, instruction)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/auftraege/${jobNumber}$`));
  });

  await test.step("the day's list links to the pack without signal", async () => {
    await offlineBackToList(page).click();
    await expect(offlineTodayList(page)).toBeVisible();
    await offlineListEntry(page, title).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(offlineStand(page)).toBeVisible();
  });

  await test.step('after a restart the phone still reads the pack', async () => {
    const restarted = await page.context().newPage();
    await bypassHttpCache(restarted);
    await restarted.goto(`/auftraege/${jobNumber}`);
    await expect(restarted.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(offlineStand(restarted)).toBeVisible();

    // A wipe in another tab, as a sign-out there does, empties the pack still open here.
    await wipeTodayFromPage(restarted);
    await expect(offlineFallback(page)).toBeVisible();
    await expect(offlineStand(page)).toBeHidden();
    await restarted.close();
  });

  await test.step('a changed office instruction arrives with the next refresh', async () => {
    const changed = `Druckprobe mit 6 bar dokumentieren ${world.runId}`;
    await changeInstruction(world, changed);
    await setNetwork(page, 'online');
    await page.goto('/dashboard');
    await waitForTodayOnDevice(page, [title, changed]);
  });

  await test.step('sign-out leaves no day on the phone', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signOutViaUi(page);
    await expectNoTodayOnDevice(page);
  });
});
