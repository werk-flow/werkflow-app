import { expect, test, type Page } from '@playwright/test';
import { clockDock, clockStatus } from '../golden/support/steps/time-tracking';
import { RUNNING_CLOCK_STATE } from './clock-state-fixture';
import {
  ACCEPTED,
  CLOCKED_OUT_STATE,
  mountClock,
  recorded,
  type Server,
  type Verdict,
} from './clock-unsent-support';

// What the clock dock shows while the connection changes (lib/field-sync/device/shown-clock.ts;
// decision record 0010, the amendment "what the clock shows while the connection changes"). Each
// test records every distinct screen of the dock and asserts the whole sequence: the clock never
// shows a state it is not sure of, and never passes through one on its way to the server's answer.

declare global {
  interface Window {
    clockScreens: string[];
  }
}

/** The clock the server holds once it recorded the kept start. */
const RECORDED_START = {
  ...RUNNING_CLOCK_STATE,
  sessionId: ACCEPTED.state?.sessionId ?? null,
  sessionVersion: 1,
};

/** Records each distinct screen of the dock from now on: its status line and its marker, or the failure. */
async function recordScreens(page: Page): Promise<void> {
  await page.evaluate(() => {
    const screen = (): string => {
      const dock = document.querySelector('[data-clock-fab]');
      if (!dock) return 'kein Dock';
      const status = dock.querySelector('[data-clock-status]');
      const marks = Array.from(dock.querySelectorAll('[data-clock-unsent], [data-clock-offline]'), (mark) =>
        mark.textContent.trim(),
      );
      return [status ? status.textContent.trim() || 'leer' : 'Fehler', ...marks].join(' · ');
    };
    window.clockScreens = [screen()];
    new MutationObserver(() => {
      const next = screen();
      if (window.clockScreens.at(-1) !== next) window.clockScreens.push(next);
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

function screens(page: Page): Promise<string[]> {
  return page.evaluate(() => window.clockScreens);
}

/** The phone's network as the browser reports it, with the event a real browser fires. */
async function setConnection(page: Page, server: Server, online: boolean): Promise<void> {
  server.online = online;
  await page.evaluate((next) => {
    window.contractOnline = next;
    window.dispatchEvent(new Event(next ? 'online' : 'offline'));
  }, online);
}

/** Holds every send at the server until the returned call releases them. */
async function holdSends(page: Page): Promise<() => void> {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/field-sync/v1/operations', async (route) => {
    await released;
    await route.fallback();
  });
  return release;
}

/** A catch-up read, as the Realtime provider starts one on a reconnect or a return to the app. */
async function catchUpRead(page: Page): Promise<void> {
  const answered = page.waitForResponse('**/api/time-tracking-state?**');
  await page.getByRole('button', { name: 'Zeitstatus aktualisieren', exact: true }).click();
  await answered;
}

/** A clock start from the stopped clock's sheet after the network went. */
async function startOffline(page: Page, server: Server): Promise<void> {
  await setConnection(page, server, false);
  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Arbeit starten', exact: true }).click();
  await expect(clockStatus(page)).toHaveText('Arbeit');
  // The outbox took the tap in, as on a phone that regains its signal long after the tap.
  await expect
    .poll(() =>
      page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('werkflow:unsent:clock:'))),
    )
    .toBe(false);
}

/** The screens of a kept start without network, up to its marker. */
const KEPT_START = ['Nicht eingestempelt', 'Nicht eingestempelt · Ohne Netz', 'Arbeit · Wartet auf Netz'];

/** A kept start without network, then the network back with its send held at the server. */
async function keptStartBackOnline(page: Page): Promise<{ server: Server; release: () => void }> {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await recordScreens(page);
  await startOffline(page, server);
  const release = await holdSends(page);
  const sent = page.waitForRequest('**/api/field-sync/v1/operations');
  await setConnection(page, server, true);
  // The send left; the server has not recorded it yet, and a catch-up read answers its clock before it.
  await sent;
  await catchUpRead(page);
  return { server, release };
}

test('going offline keeps the confirmed clock and adds only the calm marker', async ({ page }) => {
  const server = await mountClock(page, RUNNING_CLOCK_STATE);
  await recordScreens(page);

  await setConnection(page, server, false);
  await expect(clockDock(page).locator('[data-clock-offline]')).toHaveText('Ohne Netz');
  await setConnection(page, server, true);
  await expect(clockDock(page).locator('[data-clock-offline]')).toHaveCount(0);

  expect(await screens(page)).toEqual(['Arbeit', 'Arbeit · Ohne Netz', 'Arbeit']);
});

test('back online with a kept clock-in, the clock shows it until the server confirmed it, never „Nicht eingestempelt“ in between', async ({
  page,
}) => {
  const { server, release } = await keptStartBackOnline(page);

  server.state = RECORDED_START;
  release();
  await expect(clockDock(page)).toHaveAttribute('data-clock-state', 'in');
  await expect(page.getByLabel('Zeitstatus')).toHaveText('Bereit: 1');

  expect(await screens(page)).toEqual([...KEPT_START, 'Arbeit · Wird übertragen', 'Arbeit']);
});

test('a return to the app while the kept clock-in is sent changes nothing on the clock until the server answered', async ({
  page,
}) => {
  const { server, release } = await keptStartBackOnline(page);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await catchUpRead(page);

  server.state = RECORDED_START;
  release();
  await expect(clockDock(page)).toHaveAttribute('data-clock-state', 'in');

  expect(await screens(page)).toEqual([...KEPT_START, 'Arbeit · Wird übertragen', 'Arbeit']);
});

test('a send that fails keeps the kept clock-in with its marker, and never shows the server’s clock before it', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await recordScreens(page);
  await startOffline(page, server);

  // The phone reports network again, but the send does not arrive, as in a dead spot.
  await page.evaluate(() => {
    window.contractOnline = true;
    window.dispatchEvent(new Event('online'));
  });
  await catchUpRead(page);
  await setConnection(page, server, false);
  await expect(clockDock(page).locator('[data-clock-unsent]')).toHaveText('Wartet auf Netz');

  expect(await screens(page)).toEqual([
    ...KEPT_START,
    'Arbeit · Wird übertragen',
    'Arbeit · Wartet auf Netz',
  ]);
});

test('a server answer that differs from the phone shows the server’s clock and the conflict together, nothing in between', async ({
  page,
}) => {
  const { server, release } = await keptStartBackOnline(page);

  server.verdict = { outcome: 'conflict', code: 'version_conflict' };
  release();
  await expect(clockDock(page).locator('[data-clock-unsent]')).toHaveText('Konflikt');

  expect(await screens(page)).toEqual([
    ...KEPT_START,
    'Arbeit · Wird übertragen',
    'Nicht eingestempelt · Konflikt',
  ]);
});

test('a catch-up read that failed while the kept clock-in waited never shows its error once the send was recorded', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await recordScreens(page);
  await startOffline(page, server);
  const release = await holdSends(page);
  const sent = page.waitForRequest('**/api/field-sync/v1/operations');
  await setConnection(page, server, true);
  await sent;
  server.stateFails = true;
  await catchUpRead(page);
  server.stateFails = false;

  server.state = RECORDED_START;
  release();
  await expect(clockDock(page)).toHaveAttribute('data-clock-state', 'in');

  expect(await screens(page)).toEqual([...KEPT_START, 'Arbeit · Wird übertragen', 'Arbeit']);
});

test('a clock read that fails after the send keeps the clock-in apart from the server’s older clock, also when the signal goes again', async ({
  page,
}) => {
  const { server, release } = await keptStartBackOnline(page);

  server.state = RECORDED_START;
  server.stateFails = true;
  release();
  await expect(clockDock(page).getByText('Der Zeitstatus konnte nicht sicher geladen werden.')).toBeVisible();
  // Without network the held clock stays usable: a tap goes into the outbox behind the sent start.
  await setConnection(page, server, false);
  await expect(page.getByLabel('Zeitstatus')).toHaveText(/^Bereit/);

  server.stateFails = false;
  await setConnection(page, server, true);
  await expect(clockDock(page)).toHaveAttribute('data-clock-state', 'in');

  expect(await screens(page)).toEqual([...KEPT_START, 'Arbeit · Wird übertragen', 'Fehler', 'Arbeit']);
});

test('a start whose outbox code cannot load shows its failure with a retry, no clock and no usable control', async ({
  page,
}) => {
  await mountClock(
    page,
    CLOCKED_OUT_STATE,
    () => {
      // An earlier visit left a start on the phone, and the outbox's code does not arrive.
      localStorage.setItem('werkflow:unsent:time', '1');
      window.contractOutboxGone = true;
    },
    ACCEPTED,
    /^Nicht bereit/,
  );
  await recordScreens(page);
  const failure = clockDock(page).getByText('Der Zeitstatus konnte nicht sicher geladen werden.');
  await expect(failure).toBeVisible();
  // A successful clock read never ends it: the server's clock may stand before the waiting work.
  await page.getByRole('button', { name: 'Zeitstatus aktualisieren', exact: true }).click();
  // The retry loads the outbox's code again; the harness keeps it gone.
  await clockDock(page).getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await expect(failure).toBeVisible();
  await expect(clockDock(page)).toHaveAttribute('data-clock-state', 'loading');
  // A tap would start from the server's clock, behind the start that waits on the phone.
  await expect(page.getByRole('button', { name: 'Zeiterfassung starten', exact: true })).toBeDisabled();

  expect((await screens(page)).filter((screen) => screen !== 'leer')).toEqual(['Fehler']);
});

test('taps after a send accepted just before the signal went are kept and go on from the session the send left', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  // Each recorded event answers a version of its own (1, 2, 3): a tap expects the one the event before it left.
  const sessionId = ACCEPTED.state?.sessionId ?? 'no session';
  Object.defineProperty(server, 'verdict', {
    get: (): Verdict => ({
      outcome: 'accepted',
      code: 'accepted',
      state: { sessionId, segmentId: null, version: recorded(server).length },
    }),
  });
  await recordScreens(page);
  await startOffline(page, server);
  const release = await holdSends(page);
  const sent = page.waitForRequest('**/api/field-sync/v1/operations');
  await setConnection(page, server, true);
  await sent;
  // The read after the send has no signal to answer on.
  let releaseReads = (): void => undefined;
  const readsReleased = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  await page.route('**/api/time-tracking-state?**', async (route) => {
    await readsReleased;
    if (server.online) await route.fallback();
    else await route.abort('internetdisconnected');
  });

  // A short burst of signal: the server records the start, then the signal goes before the read answers.
  server.state = RECORDED_START;
  const followUpRead = page.waitForRequest('**/api/time-tracking-state?**');
  release();
  await followUpRead;
  await setConnection(page, server, false);
  releaseReads();
  await expect(clockDock(page).locator('[data-clock-unsent]')).toHaveText('Wartet auf Netz');
  await expect(page.getByLabel('Zeitstatus')).toHaveText(/^Bereit/);

  // The taps go on from the clock shown, never from the server's clock read before the send.
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(clockStatus(page)).toHaveText('Pause');
  await page.getByRole('button', { name: 'Laufende Zeiterfassung öffnen', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Erfassung beenden', exact: true }).click();
  await expect(clockStatus(page)).toHaveText('Nicht eingestempelt');
  await expect(clockDock(page).locator('[data-clock-unsent]')).toHaveText('Wartet auf Netz');

  // The signal returns: each tap is recorded once, behind the start, the first expecting what the start left.
  // A send that left before a return may arrive again after it (decision record 0010): the server records it once.
  server.state = CLOCKED_OUT_STATE;
  await setConnection(page, server, true);
  await expect(clockDock(page).locator('[data-clock-unsent]')).toHaveCount(0);
  expect(recorded(server).map((envelope) => envelope.payload)).toMatchObject([
    { action: 'start', expectedSessionId: null, expectedVersion: null },
    { action: 'switch', expectedSessionId: sessionId, expectedVersion: 1 },
    { action: 'end', expectedSessionId: sessionId, expectedVersion: 2 },
  ]);
  expect(await screens(page)).toEqual([
    ...KEPT_START,
    'Arbeit · Wird übertragen',
    'Arbeit · Wartet auf Netz',
    'Pause · Wartet auf Netz',
    'Nicht eingestempelt · Wartet auf Netz',
    'Nicht eingestempelt · Wird übertragen',
    'Nicht eingestempelt',
  ]);
});
