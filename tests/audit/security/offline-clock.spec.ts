import { expect, test } from '../support/fixtures';
import { openPage } from '../../golden/support/streamed-content';
import {
  clockDock,
  clockInLauncher,
  clockStartSheet,
  clockStatus,
  tapClockOut,
} from '../../golden/support/steps/time-tracking';
import { bypassHttpCache, setNetwork, waitForOfflineShell } from '../support/offline-shell';
import {
  UNSENT_COPY,
  expectOneSessionAtCapturedTimes,
  meineZeitActivity,
  expectSessionsSince,
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
    const restarted = await openPage(page.context());
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

test('an online clock call whose page closed before the answer is recorded once, whether or not it reached the server @AUDIT-SECURITY-OFFLINE-CLOCK', async ({
  employeePage: page,
  world,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const before = Date.now();
  await page.goto('/dashboard');
  await expect(clockInLauncher(page)).toBeEnabled();

  await test.step('a start reaches the server, and the page closes before its answer', async () => {
    let reached = (): void => undefined;
    const atServer = new Promise<void>((resolve) => {
      reached = resolve;
    });
    await page.route('**/*', async (route) => {
      if (route.request().method() !== 'POST' || !route.request().headers()['next-action'])
        return route.fallback();
      // The server records the call; its answer never reaches the closed page.
      await route.fetch();
      reached();
    });
    await clockInLauncher(page).click();
    await startWorkAction(clockStartSheet(page)).click();
    await atServer;
    await page.close();
  });

  const next = await openPage(page.context());
  // The phone opens the app again a little later, once the closed page's call can no longer be waiting.
  await next.clock.install({ time: new Date(Date.now() + 15_000) });
  await test.step('the next start sends the kept action under the same operation id: one session, no conflict', async () => {
    await next.goto('/dashboard');
    await expect(clockStatus(next)).toHaveText(UNSENT_COPY.working);
    await expectTimeEventsOnDevice(next, []);
    await expect(unsentBadge(next, UNSENT_COPY.refused)).toHaveCount(0);
    await expectSessionsSince(world, before, [expect.objectContaining({ endedAt: null })]);
  });

  await test.step('an end never reaches the server, and the page closes while it waits', async () => {
    let held = (): void => undefined;
    const waiting = new Promise<void>((resolve) => {
      held = resolve;
    });
    await next.route('**/*', async (route) => {
      if (route.request().method() !== 'POST' || !route.request().headers()['next-action'])
        return route.fallback();
      // The request stays in a dead spot: neither the server nor the page hears of it again.
      held();
    });
    await tapClockOut(next);
    await waiting;
    await next.close();
  });

  await test.step('the next start sends the end: the session is ended once', async () => {
    const last = await openPage(page.context());
    await last.clock.install({ time: new Date(Date.now() + 15_000) });
    await last.goto('/dashboard');
    await expect(clockInLauncher(last)).toBeEnabled();
    await expectTimeEventsOnDevice(last, []);
    await expectSessionsSince(world, before, [expect.objectContaining({ endedAt: expect.any(Number) })]);
    await last.close();
  });
});
