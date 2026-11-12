import { expect, test } from '../support/fixtures';
import {
  clockDock,
  clockInLauncher,
  clockStartSheet,
  clockStatus,
} from '../../golden/support/steps/time-tracking';
import { bypassHttpCache, setNetwork, waitForOfflineShell } from '../support/offline-shell';
import {
  UNSENT_COPY,
  expectOneSessionAtCapturedTimes,
  meineZeitActivity,
  expectTimeEventsOnDevice,
  offlineClock,
  offlineClockAction,
  startWorkAction,
  unsentBadge,
} from '../support/time-outbox';

// The clock keeps time events without signal (werk-flow/werkflow-planning#319;
// decision record 0010, the amendment "the time outbox"): a start captured
// without signal shows at once and survives a reload and a restart, the end
// is captured from the page a phone shows without signal, and with signal
// again the server records one session at the captured times.

// The reload and the restart without signal read what the service worker serves.
test.use({ serviceWorkers: 'allow' });

test('a clock start and end without signal are recorded once, at their captured times @AUDIT-SECURITY-OFFLINE-CLOCK', async ({
  employeePage: page,
  world,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  // The phone's clock runs a few minutes behind the server, so the session is long enough to show
  // in „Meine Zeit“, which hides spans shorter than a minute, and still lies before its receipt.
  await page.clock.install({ time: new Date(Date.now() - 4 * 60_000) });

  await test.step('the phone opens the app with signal, clocked out', async () => {
    await page.goto('/dashboard');
    await expect(clockInLauncher(page)).toBeEnabled();
    await waitForOfflineShell(page);
  });

  await test.step('a start without signal shows the running clock at once, marked as waiting', async () => {
    // Only the worker's cache may serve the page's files from here on.
    await bypassHttpCache(page);
    await setNetwork(page, 'offline');
    await clockInLauncher(page).click();
    await startWorkAction(clockStartSheet(page)).click();
    await expect(clockStatus(page)).toHaveText(UNSENT_COPY.working);
    await expect(unsentBadge(clockDock(page), UNSENT_COPY.waiting)).toBeVisible();
  });

  await test.step('a reload without signal shows the clock from the phone', async () => {
    await page.reload();
    await expect(offlineClock(page)).toContainText(UNSENT_COPY.workingSince);
    await expect(unsentBadge(offlineClock(page), UNSENT_COPY.waiting)).toBeVisible();
    await expectTimeEventsOnDevice(page, ['start']);
  });

  await test.step('after a restart the phone still holds the start', async () => {
    const restarted = await page.context().newPage();
    await bypassHttpCache(restarted);
    await restarted.goto('/dashboard');
    await expect(offlineClock(restarted)).toContainText(UNSENT_COPY.workingSince);
    await restarted.close();
  });

  await test.step('the end without signal is kept behind the start', async () => {
    await page.clock.fastForward(2 * 60_000);
    await offlineClockAction(page, UNSENT_COPY.end).click();
    await expect(offlineClock(page)).toContainText(UNSENT_COPY.clockedOut);
    await expectTimeEventsOnDevice(page, ['start', 'end']);
  });

  await test.step('with signal again, the server records one session at the captured times', async () => {
    await expectOneSessionAtCapturedTimes(page, world, async () => {
      await setNetwork(page, 'online');
      await page.goto('/dashboard');
    });
    await expectTimeEventsOnDevice(page, []);
    await expect(clockInLauncher(page)).toBeEnabled();
    await expect(unsentBadge(page, UNSENT_COPY.waiting)).toHaveCount(0);
  });

  await test.step('„Meine Zeit“ shows the session as work at the captured times', async () => {
    await expect(await meineZeitActivity(page, world)).toBeVisible();
  });
});
