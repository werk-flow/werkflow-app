import { expect, test, type Page } from '@playwright/test';
import { clockDock, clockStatus } from '../golden/support/steps/time-tracking';
import type { TimeTransitionResult } from '@/lib/time-tracking/types';
import { CLOCK_ORGANIZATION_ID, CLOCK_USER_ID, RUNNING_CLOCK_STATE } from './clock-state-fixture';
import {
  ACCEPTED,
  CLOCKED_OUT_STATE,
  holdDeviceStore,
  mountClock,
  recorded,
  setNetwork,
  startWithoutNetwork,
  unsentBadge,
  unsentOnDevice,
  unsentSection,
  withoutSentAt,
} from './clock-unsent-support';

// The clock's states for time events a phone holds unsent, and the choices a
// sign-out offers over them (werk-flow/werkflow-planning#319; decision record
// 0010, the amendment "the time outbox"). The server is the route in
// clock-unsent-support.ts: every envelope it received and the answer it gives.

test('a page whose device holds nothing unsent never runs the outbox code at its start', async ({ page }) => {
  await mountClock(page, CLOCKED_OUT_STATE);
  await expect(page.getByRole('button', { name: 'Zeiterfassung starten', exact: true })).toBeEnabled();

  // The outbox opens its database with its first read: no database, no outbox code at the start.
  const databases = await page.evaluate(async () => (await indexedDB.databases()).map((info) => info.name));
  expect(databases).not.toContain('werkflow-time-outbox');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test('a clock action without network is kept on the phone, shows the running clock as waiting, and is sent once at its captured time', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  const before = Date.now();

  await startWithoutNetwork(page, server);

  await expect(unsentBadge(clockDock(page))).toHaveText('Wartet auf Netz');
  await expect(clockDock(page)).toHaveAttribute('data-clock-state', 'pending');
  expect(await page.evaluate(() => window.clockContract.transitions)).toEqual([]);
  expect(server.sent).toEqual([]);
  await expect.poll(async () => (await unsentOnDevice(page)).map((event) => event.action)).toEqual(['start']);
  const [kept] = await unsentOnDevice(page);
  const after = Date.now();

  server.state = { ...RUNNING_CLOCK_STATE, sessionId: ACCEPTED.state?.sessionId ?? null, sessionVersion: 1 };
  await setNetwork(page, server, true);

  await expect.poll(() => recorded(server).length).toBe(1);
  expect(new Set(server.authorization)).toEqual(new Set(['Bearer contract-access-token']));
  const [envelope] = recorded(server);
  expect(envelope).toMatchObject({
    operationId: kept?.operationId,
    kind: 'time.transition',
    organizationId: CLOCK_ORGANIZATION_ID,
    payload: { action: 'start', expectedSessionId: null, expectedVersion: null },
  });
  const capturedAt = Date.parse(envelope?.capturedAt ?? '');
  expect(capturedAt).toBeGreaterThanOrEqual(before);
  expect(capturedAt).toBeLessThanOrEqual(after);
  await expect(unsentBadge(page)).toHaveCount(0);
  await expect(clockDock(page)).toHaveAttribute('data-clock-state', 'in');
  await expect.poll(() => unsentOnDevice(page)).toEqual([]);
  // A second `online` sends nothing again.
  const requests = server.sent.length;
  await setNetwork(page, server, true);
  await expect(page.getByLabel('Zeitstatus')).toHaveText('Bereit: 1');
  expect(server.sent).toHaveLength(requests);
});

test('actions kept one after the other are sent in that order, each naming the session the one before it left', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await startWithoutNetwork(page, server);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(clockStatus(page)).toHaveText('Pause');
  await expect
    .poll(async () => (await unsentOnDevice(page)).map((event) => event.action))
    .toEqual(['start', 'switch']);

  await setNetwork(page, server, true);

  await expect.poll(() => recorded(server).length).toBe(2);
  const [start, pause] = recorded(server);
  expect([start?.payload, pause?.payload]).toMatchObject([
    { action: 'start', expectedSessionId: null, expectedVersion: null },
    { action: 'switch', expectedSessionId: ACCEPTED.state?.sessionId, expectedVersion: 1 },
  ]);
  // The pause left only after the start was recorded: no request of it before the start's last.
  expect(server.sent.findIndex((envelope) => envelope.operationId === pause?.operationId)).toBeGreaterThan(
    server.sent.findLastIndex((envelope) => envelope.operationId === start?.operationId),
  );
  expect(Date.parse(start?.capturedAt ?? '')).toBeLessThanOrEqual(Date.parse(pause?.capturedAt ?? ''));
});

test('a refused event whose clock read then fails shows the server’s confirmed clock, never the phone’s kept one', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  server.verdict = { outcome: 'rejected', code: 'closed_period' };
  await startWithoutNetwork(page, server);
  server.stateFails = true;
  await setNetwork(page, server, true);

  await expect(unsentBadge(clockDock(page))).toHaveText('Nicht übertragen');
  // No confirmed clock could be read again: the clock waits for it instead of showing the phone's start.
  await expect(page.getByLabel('Zeitstatus')).toHaveText('Nicht bereit');
  await expect(clockStatus(page)).toHaveCount(0);
});

test('a refused event shows „Nicht übertragen“ with its reason, is sent again unchanged on request, and leaves only after a confirmed deletion', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  server.verdict = { outcome: 'rejected', code: 'closed_period' };
  await startWithoutNetwork(page, server);
  await setNetwork(page, server, true);

  await expect(unsentBadge(clockDock(page))).toHaveText('Nicht übertragen');
  // The server recorded nothing, so the clock shows the server's state again.
  await expect(clockStatus(page)).toHaveText('Nicht eingestempelt');
  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  const section = unsentSection(page);
  await expect(section).toContainText('Der Monat dieser Zeiten ist bereits abgeschlossen.');
  await expect(section.getByRole('listitem')).toHaveText(/^Arbeit gestartet/);

  // The refusal settled every send: only the person's request sends it again.
  expect(recorded(server)).toHaveLength(1);
  const requests = server.sent.length;
  await section.getByRole('button', { name: 'Erneut senden', exact: true }).click();
  await expect.poll(() => server.sent.length).toBe(requests + 1);
  expect(withoutSentAt(server.sent.at(-1))).toEqual(withoutSentAt(server.sent[0]));
  await expect(section.getByRole('button', { name: 'Erneut senden', exact: true })).toBeEnabled();

  await section.getByRole('button', { name: 'Löschen', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Nicht übertragene Zeiten löschen?' });
  await expect(confirmation).toContainText(
    'Die Stempelzeit wird von diesem Gerät gelöscht und nicht erfasst.',
  );
  await confirmation.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  expect(await unsentOnDevice(page)).toHaveLength(1);

  await section.getByRole('button', { name: 'Löschen', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Endgültig löschen', exact: true }).click();
  await expect(section).toHaveCount(0);
  await expect(unsentBadge(page)).toHaveCount(0);
  expect(await unsentOnDevice(page)).toEqual([]);
  expect(server.sent).toHaveLength(requests + 1);
});

test('while refused events wait for the person, a clock action without network is refused instead of kept behind them', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  server.verdict = { outcome: 'rejected', code: 'forbidden' };
  await startWithoutNetwork(page, server);
  await setNetwork(page, server, true);
  await expect(unsentBadge(clockDock(page))).toHaveText('Nicht übertragen');

  await setNetwork(page, server, false);
  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Fahrt starten', exact: true }).click();

  await expect(sheet).toContainText(
    'Die Aktivität konnte nicht gespeichert werden. Bitte versuche es erneut.',
  );
  await expect(clockStatus(page)).toHaveText('Nicht eingestempelt');
  expect((await unsentOnDevice(page)).map((event) => event.action)).toEqual(['start']);
});

test('the clock a page keeps for its first unsent action names no job, customer or project', async ({
  page,
}) => {
  const job = {
    id: '40000000-0000-4000-8000-000000000001',
    title: 'Heizungswartung Müller',
    jobNumber: 'A-2026-0142',
    status: 'in_bearbeitung',
    projectName: 'Neubau Musterweg',
    clientName: 'Familie Müller',
  };
  const server = await mountClock(page, {
    ...RUNNING_CLOCK_STATE,
    activeJobId: job.id,
    activeJobInfo: job,
    resumeJobInfo: job,
    currentActivity: { kind: 'work', allocationKind: 'job', jobId: job.id },
    resumeActivity: { kind: 'work', allocationKind: 'job', jobId: job.id },
  });
  await setNetwork(page, server, false);
  // As on a page whose signal is gone before the outbox code loaded: the device store is out of
  // reach, so the action stays where the page's own static write put it.
  await page.evaluate(() => {
    Object.defineProperty(window, 'indexedDB', {
      value: {
        open: () => {
          throw new Error('The outbox is out of reach.');
        },
      },
    });
  });

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(clockStatus(page)).toHaveText('Pause');
  await expect(unsentBadge(clockDock(page))).toHaveText('Wartet auf Netz');

  const kept = await page.evaluate(() =>
    Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? '')
      .filter((key) => key.startsWith('werkflow:unsent:clock:'))
      .map((key) => localStorage.getItem(key) ?? '')
      .join(''),
  );
  expect(kept).toContain(RUNNING_CLOCK_STATE.sessionId ?? 'no session');
  for (const name of [job.title, job.jobNumber, job.projectName, job.clientName])
    expect(kept).not.toContain(name);
});

test('a late event shows „Korrektur nötig“, opens the correction with its captured day and start, and leaves only after the request was filed', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  server.verdict = { outcome: 'conflict', code: 'correction_required' };
  await startWithoutNetwork(page, server);
  await setNetwork(page, server, true);

  await expect(unsentBadge(clockDock(page))).toHaveText('Korrektur nötig');
  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  const section = unsentSection(page);
  await expect(section).toContainText('älter als 24 Stunden');
  await expect(section.getByRole('button', { name: 'Erneut senden', exact: true })).toHaveCount(0);

  await section.getByRole('button', { name: 'Korrektur beantragen', exact: true }).click();
  const correction = page.getByRole('dialog', { name: 'Zeit nachtragen', exact: true });
  await expect(correction.getByLabel('Vorbelegung')).toHaveText(
    /^\d{1,2}\.\d{1,2}\.\d{4} \| \d{2}:\d{2} \| kein Ende$/,
  );
  await correction.getByRole('button', { name: 'Formular schließen', exact: true }).click();
  expect(await unsentOnDevice(page)).toHaveLength(1);

  await section.getByRole('button', { name: 'Korrektur beantragen', exact: true }).click();
  await correction.getByRole('button', { name: 'Korrektur einreichen', exact: true }).click();
  await expect(section).toHaveCount(0);
  expect(await unsentOnDevice(page)).toEqual([]);
  expect(recorded(server)).toHaveLength(1);
});

/** Keeps `chain` on the phone as kept clock actions on `base`, its first expecting `base`'s session, and goes online. */
async function keepLateChain(
  page: Page,
  base: typeof RUNNING_CLOCK_STATE,
  chain: Array<[action: 'switch' | 'end', capturedAt: string]>,
): Promise<void> {
  await page.evaluate(
    ({ userId, organizationId, base, chain }) => {
      chain.forEach(([action, capturedAt], index) => {
        const operationId = `50000000-0000-4000-8000-00000000030${index}`;
        localStorage.setItem(
          `werkflow:unsent:clock:${String(Date.parse(capturedAt)).padStart(15, '0')}:1:${operationId}`,
          JSON.stringify({
            userId,
            organizationId,
            operationId,
            action,
            selection: action === 'end' ? null : { kind: 'break', allocationKind: 'none' },
            expectedSessionId: base.sessionId,
            expectedVersion: base.sessionVersion,
            capturedAt,
            triedOnline: false,
            version: 1,
            wipeGeneration: '',
            base: index === 0 ? base : null,
            readAt: index === 0 ? '2026-11-09T08:59:00.000Z' : null,
          }),
        );
      });
      window.dispatchEvent(new Event('online'));
    },
    { userId: CLOCK_USER_ID, organizationId: CLOCK_ORGANIZATION_ID, base, chain },
  );
}

const RUNNING_SINCE_SEVEN = {
  ...RUNNING_CLOCK_STATE,
  // The segment the kept clock shows running when the late chain begins.
  currentSegmentId: 'recovered-segment',
  clockInTime: '2026-11-09T07:00:00.000Z',
  statusStartedAt: '2026-11-09T07:00:00.000Z',
};

test('a late chain without an end on a session the server still holds open offers no correction: the person keeps the times, deletes them, ends the session, then corrects', async ({
  page,
}) => {
  await mountClock(page, RUNNING_SINCE_SEVEN, () => undefined, {
    outcome: 'conflict',
    code: 'correction_required',
  });
  await keepLateChain(page, RUNNING_SINCE_SEVEN, [['switch', '2026-11-09T09:00:00.000Z']]);
  await expect(unsentBadge(clockDock(page))).toHaveText('Korrektur nötig');
  await page.getByRole('button', { name: 'Laufende Zeiterfassung öffnen', exact: true }).click();
  const section = unsentSection(page);

  // No captured end replaces the server's, and an addition would count the time twice once the session ends.
  await expect(section.getByRole('button', { name: 'Korrektur beantragen', exact: true })).toHaveCount(0);
  await expect(section.locator('[data-clock-replacement]')).toHaveCount(0);
  await expect(section.locator('[data-clock-open-session]')).toContainText('Notiere dir die Zeiten unten.');
  await expect(section.getByRole('listitem').filter({ hasText: 'Pause gestartet' })).toContainText('10:00');

  await section.getByRole('button', { name: 'Löschen', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Nicht übertragene Zeiten löschen?' });
  await expect(confirmation.getByRole('listitem').filter({ hasText: 'Pause gestartet' })).toContainText(
    '10:00',
  );
  await expect(confirmation.locator('[data-clock-open-session]')).toContainText(
    'Beende die laufende Zeiterfassung über die Uhr.',
  );
  await confirmation.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Zeit nachtragen', exact: true })).toHaveCount(0);
});
/**
 * Lets the clock's pending online call answer, as the server does after a while. It takes the call's
 * resolver as it answers, so a second answer waits for the next call instead of answering this one twice.
 */
async function answerTransition(page: Page): Promise<void> {
  await page.waitForFunction(() => window.clockContract.resolveTransition !== null);
  await page.evaluate(() => {
    const answer = window.clockContract.resolveTransition;
    window.clockContract.resolveTransition = null;
    answer?.();
  });
}

test('a late chain with a Pause before its end keeps the order that shows every captured time: one edit of the end would count the break as work', async ({
  page,
}) => {
  await mountClock(page, RUNNING_SINCE_SEVEN, () => undefined, {
    outcome: 'conflict',
    code: 'correction_required',
  });
  await keepLateChain(page, RUNNING_SINCE_SEVEN, [
    ['switch', '2026-11-09T09:00:00.000Z'],
    ['end', '2026-11-09T15:00:00.000Z'],
  ]);
  await page.getByRole('button', { name: 'Laufende Zeiterfassung öffnen', exact: true }).click();
  const section = unsentSection(page);

  await expect(section.locator('[data-clock-open-session]')).toContainText('Notiere dir die Zeiten unten.');
  await expect(section.locator('[data-clock-replacement]')).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Korrektur beantragen', exact: true })).toHaveCount(0);
  await expect(section.getByRole('listitem').filter({ hasText: 'Pause gestartet' })).toContainText('10:00');
});

test('a late chain of a session the server still holds open is settled by one guided correction: end the session, replace its end with the captured one, and only then let the events go', async ({
  page,
}) => {
  const running = RUNNING_SINCE_SEVEN;
  const server = await mountClock(page, running, () => undefined, {
    outcome: 'conflict',
    code: 'correction_required',
  });
  await keepLateChain(page, running, [['end', '2026-11-09T15:00:00.000Z']]);
  await expect(unsentBadge(clockDock(page))).toHaveText('Korrektur nötig');
  await page.getByRole('button', { name: 'Laufende Zeiterfassung öffnen', exact: true }).click();
  const section = unsentSection(page);
  const correct = section.getByRole('button', { name: 'Korrektur beantragen', exact: true });
  const form = page.getByRole('dialog', { name: 'Zeit korrigieren', exact: true });

  // The flow says what ending does and which time replaces the server's end.
  await expect(section.locator('[data-clock-replacement]')).toContainText(
    'Der Server trägt dabei die aktuelle Uhrzeit als Ende ein; deine Korrektur ersetzt dieses Ende durch deine erfasste Zeit (Mo., 09.11.2026, 16:00).',
  );
  await expect(section.locator('[data-clock-open-session]')).toHaveCount(0);

  // Step 1 fails: the server refuses the end. Nothing leaves the phone, and no form opens.
  await page.evaluate(() => {
    window.clockContract.refuse = true;
  });
  await correct.click();
  await answerTransition(page);
  await expect(section).toContainText('Die laufende Zeiterfassung konnte nicht beendet werden.');
  await expect(form).toHaveCount(0);
  expect(await unsentOnDevice(page)).toHaveLength(1);
  expect(await page.evaluate(() => window.clockContract.transitions)).toMatchObject([
    { action: 'end', expectedSessionId: running.sessionId, expectedVersion: running.sessionVersion },
  ]);

  // Step 2 fails: the session ends, but its entries cannot be read. The events stay.
  await page.evaluate(() => {
    window.clockContract.refuse = false;
    window.clockReplacement = { entries: [], readFails: true, reads: 0 };
  });
  server.state = CLOCKED_OUT_STATE;
  await correct.click();
  await answerTransition(page);
  await expect(section).toContainText('Deine erfassten Zeiten konnten nicht geladen werden.');
  await expect(clockStatus(page)).toHaveText('Nicht eingestempelt');
  await expect(form).toHaveCount(0);
  expect(await unsentOnDevice(page)).toHaveLength(1);

  // The session no longer runs: the flow goes on with step 2 alone and ends nothing again.
  await expect(section.locator('[data-clock-replacement]')).toContainText(
    'Deine Korrektur ersetzt das Ende deiner Zeiterfassung durch deine erfasste Zeit (Mo., 09.11.2026, 16:00).',
  );
  await page.evaluate(() => {
    window.clockReplacement = { entries: [], readFails: false, reads: 0 };
  });
  await correct.click();
  await expect(section).toContainText('Die Zeiterfassung, die diese Zeiten ersetzen, wurde nicht gefunden.');
  expect(await unsentOnDevice(page)).toHaveLength(1);

  // The recovered segment: its end, recorded the next day, is what the correction replaces.
  await page.evaluate(
    ({ userId, organizationId }) => {
      const piece = (entryType: 'clock_in' | 'clock_out', timestamp: string) => ({
        id: `piece-${entryType}-${timestamp}`,
        userId,
        organizationId,
        entryType,
        timestamp,
        isManual: false,
        jobId: null,
        status: 'approved' as const,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        sourceKind: 'canonical_segment' as const,
        canonicalSegmentId: 'recovered-segment',
      });
      window.clockReplacement = {
        entries: [
          piece('clock_in', '2026-11-09T07:00:00.000Z'),
          piece('clock_out', '2026-11-09T23:00:00.000Z'),
          piece('clock_in', '2026-11-09T23:00:00.000Z'),
          piece('clock_out', '2026-11-10T10:00:00.000Z'),
        ],
        readFails: false,
        reads: 0,
      };
    },
    { userId: CLOCK_USER_ID, organizationId: CLOCK_ORGANIZATION_ID },
  );
  await correct.click();
  await expect(form.getByLabel('Vorbelegung')).toHaveText(
    'recovered-segment | clock_out | 2026-11-09T15:00:00.000Z',
  );
  // Closing the form files nothing: the events stay.
  await form.getByRole('button', { name: 'Formular schließen', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(await unsentOnDevice(page)).toHaveLength(1);

  await correct.click();
  await form.getByRole('button', { name: 'Korrektur einreichen', exact: true }).click();
  await expect(section).toHaveCount(0);
  await expect.poll(() => unsentOnDevice(page)).toEqual([]);
  // Two online ends: the refused one and the one that ended the session. The kept end reached the
  // server once, which answered that it needs a correction, and was never sent again.
  expect(await page.evaluate(() => window.clockContract.transitions.map((call) => call.action))).toEqual([
    'end',
    'end',
  ]);
  expect(server.sent.map((envelope) => envelope.payload.action)).toEqual(['end']);
});

test('while the guided correction ends the session, the sheet stays open, so its answer and the next step are not lost', async ({
  page,
}) => {
  const running = RUNNING_SINCE_SEVEN;
  await mountClock(page, running, () => undefined, {
    outcome: 'conflict',
    code: 'correction_required',
  });
  await keepLateChain(page, running, [['end', '2026-11-09T15:00:00.000Z']]);
  await page.getByRole('button', { name: 'Laufende Zeiterfassung öffnen', exact: true }).click();
  const sheet = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Laufende Zeiterfassung' }) });
  const section = unsentSection(page);
  await page.evaluate(() => {
    window.clockContract.refuse = true;
  });

  await section.getByRole('button', { name: 'Korrektur beantragen', exact: true }).click();
  await page.waitForFunction(() => window.clockContract.resolveTransition !== null);
  // The end waits for the server: the sheet shows it busy and refuses its dismissal.
  await expect(sheet).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeVisible();

  await answerTransition(page);
  await expect(section).toContainText('Die laufende Zeiterfassung konnte nicht beendet werden.');
  // Once the end answered, the sheet closes as usual.
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('a guided correction filed as another kind than an edit leaves the recorded end, so the events stay and the flow says so', async ({
  page,
}) => {
  const running = RUNNING_SINCE_SEVEN;
  // The session ended meanwhile: the flow goes on with the correction alone.
  await mountClock(page, CLOCKED_OUT_STATE, () => undefined, {
    outcome: 'conflict',
    code: 'correction_required',
  });
  await keepLateChain(page, running, [['end', '2026-11-09T15:00:00.000Z']]);
  await page.evaluate(
    ({ userId, organizationId }) => {
      const piece = (entryType: 'clock_in' | 'clock_out', timestamp: string) => ({
        id: `piece-${entryType}-${timestamp}`,
        userId,
        organizationId,
        entryType,
        timestamp,
        isManual: false,
        jobId: null,
        status: 'approved' as const,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        sourceKind: 'canonical_segment' as const,
        canonicalSegmentId: 'recovered-segment',
      });
      window.clockReplacement = {
        entries: [
          piece('clock_in', '2026-11-09T07:00:00.000Z'),
          piece('clock_out', '2026-11-10T10:00:00.000Z'),
        ],
        readFails: false,
        reads: 0,
      };
    },
    { userId: CLOCK_USER_ID, organizationId: CLOCK_ORGANIZATION_ID },
  );
  await expect(unsentBadge(clockDock(page))).toHaveText('Korrektur nötig');
  await expect(clockStatus(page)).toHaveText('Nicht eingestempelt');
  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  const section = unsentSection(page);
  const form = page.getByRole('dialog', { name: 'Zeit korrigieren', exact: true });

  await section.getByRole('button', { name: 'Korrektur beantragen', exact: true }).click();
  await form.getByRole('button', { name: 'Andere Korrektur einreichen', exact: true }).click();
  await expect(section).toContainText('Deine Korrektur ändert nicht das Ende deiner Zeiterfassung');
  expect(await unsentOnDevice(page)).toHaveLength(1);
  expect(await page.evaluate(() => window.clockContract.transitions)).toEqual([]);
});

test('the guided correction replays an end only after a lost answer: a request at a new version, or after the server answered, is a new operation', async ({
  page,
}) => {
  const running = RUNNING_SINCE_SEVEN;
  const server = await mountClock(page, running, () => undefined, {
    outcome: 'conflict',
    code: 'correction_required',
  });
  await keepLateChain(page, running, [['end', '2026-11-09T15:00:00.000Z']]);
  await page.getByRole('button', { name: 'Laufende Zeiterfassung öffnen', exact: true }).click();
  const section = unsentSection(page);
  const correct = section.getByRole('button', { name: 'Korrektur beantragen', exact: true });
  const recovery = (version: number): TimeTransitionResult & { success: true } => ({
    success: true,
    outcome: 'recovery_required',
    sessionId: running.sessionId,
    segmentId: running.currentSegmentId,
    version,
    recoveryReason: 'open_too_long',
    replayed: false,
    legacyBridged: false,
  });

  const recoveryThenRefusal: TimeTransitionResult[] = [
    recovery(9),
    { success: false, error: 'time_transition_failed' },
  ];
  const recoveryThenEnd: TimeTransitionResult[] = [
    recovery(9),
    { ...recovery(10), outcome: 'ended', recoveryReason: null },
  ];

  // The end's answer is lost on its way: the retry sends the same request under the same id.
  await page.evaluate(() => {
    window.clockContract.failTransition = true;
  });
  await correct.click();
  await answerTransition(page);
  await expect(section).toContainText('Die laufende Zeiterfassung konnte nicht beendet werden.');

  // The server moved the session to recovery (version 9), and the recovery is refused.
  await page.evaluate((answers) => {
    window.clockContract.failTransition = false;
    window.clockContract.answers = answers;
  }, recoveryThenRefusal);
  server.state = { ...running, sessionVersion: 9, recoveryReason: 'open_too_long' };
  await correct.click();
  await answerTransition(page);
  await answerTransition(page);
  await expect(section).toContainText('Die laufende Zeiterfassung konnte nicht beendet werden.');
  expect(await unsentOnDevice(page)).toHaveLength(1);
  // The clock read the server again after that answer: it holds the session at version 9 now.
  await expect(page.getByLabel('Zeitstatus', { exact: true })).toHaveText('Bereit: 9');

  // The next attempt ends at the version the clock now reads and recovers, both as new operations.
  await page.evaluate((answers) => {
    window.clockContract.answers = answers;
    window.clockReplacement = { entries: [], readFails: false, reads: 0 };
  }, recoveryThenEnd);
  server.state = CLOCKED_OUT_STATE;
  await correct.click();
  await answerTransition(page);
  await answerTransition(page);
  await expect(section).toContainText('Die Zeiterfassung, die diese Zeiten ersetzen, wurde nicht gefunden.');

  const calls = await page.evaluate(() =>
    window.clockContract.transitions.map(({ action, operationId, expectedVersion }) => ({
      action,
      operationId,
      expectedVersion,
    })),
  );
  expect(calls.map(({ action, expectedVersion }) => [action, expectedVersion])).toEqual([
    ['end', running.sessionVersion],
    ['end', running.sessionVersion],
    ['recover_end', 9],
    ['end', 9],
    ['recover_end', 9],
  ]);
  const [lost, replayed, refusedRecovery, newEnd, newRecovery] = calls.map(({ operationId }) => operationId);
  expect(replayed).toBe(lost);
  expect(newEnd).not.toBe(replayed);
  expect(newRecovery).not.toBe(refusedRecovery);
});

test('a correction covers the first day only: the next day’s events stay on the phone, shown, and go on from the server’s clock', async ({
  page,
}) => {
  const days = [
    ['start', '2026-11-09T06:00:00.000Z'],
    ['end', '2026-11-09T15:00:00.000Z'],
    ['start', '2026-11-10T06:30:00.000Z'],
    ['end', '2026-11-10T14:00:00.000Z'],
  ];
  const server = await mountClock(page, CLOCKED_OUT_STATE, () => undefined, {
    outcome: 'conflict',
    code: 'correction_required',
  });
  await page.evaluate(
    ({ kept, userId, organizationId, base }) => {
      kept.forEach(([action, capturedAt], index) => {
        const operationId = `50000000-0000-4000-8000-00000000010${index}`;
        localStorage.setItem(
          `werkflow:unsent:clock:${String(Date.parse(capturedAt ?? '')).padStart(15, '0')}:1:${operationId}`,
          JSON.stringify({
            userId,
            organizationId,
            operationId,
            action,
            selection: action === 'end' ? null : { kind: 'work', allocationKind: 'unallocated', jobId: null },
            expectedSessionId: null,
            expectedVersion: null,
            capturedAt,
            triedOnline: false,
            version: 1,
            wipeGeneration: '',
            base: index === 0 ? base : null,
            readAt: index === 0 ? '2026-11-09T05:59:00.000Z' : null,
          }),
        );
      });
      window.dispatchEvent(new Event('online'));
    },
    { kept: days, userId: CLOCK_USER_ID, organizationId: CLOCK_ORGANIZATION_ID, base: CLOCKED_OUT_STATE },
  );
  await expect(unsentBadge(clockDock(page))).toHaveText('Korrektur nötig');
  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  const section = unsentSection(page);

  await section.getByRole('button', { name: 'Korrektur beantragen', exact: true }).click();
  const correction = page.getByRole('dialog', { name: 'Zeit nachtragen', exact: true });
  // Monday's start and end, never Tuesday's end.
  await expect(correction.getByLabel('Vorbelegung')).toHaveText('9.11.2026 | 07:00 | 16:00');
  await correction.getByRole('button', { name: 'Korrektur einreichen', exact: true }).click();

  await expect(section.getByRole('listitem')).toHaveCount(2);
  expect((await unsentOnDevice(page)).map((event) => event.operationId)).toEqual([
    '50000000-0000-4000-8000-000000000102',
    '50000000-0000-4000-8000-000000000103',
  ]);
  // Tuesday's start goes on from the server's clock: no session open.
  await expect.poll(() => server.sent.length).toBe(2);
  expect(withoutSentAt(server.sent.at(-1))).toEqual(
    expect.objectContaining({
      operationId: '50000000-0000-4000-8000-000000000102',
      payload: expect.objectContaining({ expectedSessionId: null, expectedVersion: null }),
    }),
  );
});

test('a request filed for a colleague never removes the person’s own unsent events', async ({ page }) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  server.verdict = { outcome: 'conflict', code: 'correction_required' };
  await startWithoutNetwork(page, server);
  await setNetwork(page, server, true);
  await expect(unsentBadge(clockDock(page))).toHaveText('Korrektur nötig');
  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  const section = unsentSection(page);

  await section.getByRole('button', { name: 'Korrektur beantragen', exact: true }).click();
  const correction = page.getByRole('dialog', { name: 'Zeit nachtragen', exact: true });
  await correction.getByRole('button', { name: 'Für Kollegin einreichen', exact: true }).click();

  await expect(correction).toHaveCount(0);
  await expect(section).toBeVisible();
  expect(await unsentOnDevice(page)).toHaveLength(1);
});

test('a conflict shows what changed and the server’s clock, never the phone’s, and the event is not sent again', async ({
  page,
}) => {
  const server = await mountClock(page, RUNNING_CLOCK_STATE);
  server.verdict = { outcome: 'conflict', code: 'version_conflict' };
  await setNetwork(page, server, false);
  await page.getByRole('button', { name: 'Laufende Zeiterfassung öffnen', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Erfassung beenden', exact: true }).click();
  await expect(clockStatus(page)).toHaveText('Nicht eingestempelt');

  await setNetwork(page, server, true);

  await expect(unsentBadge(clockDock(page))).toHaveText('Konflikt');
  // The server still runs the session: the phone's end changed nothing.
  await expect(clockStatus(page)).toHaveText('Arbeit');
  expect(recorded(server).map((envelope) => envelope.payload)).toMatchObject([
    { action: 'end', expectedSessionId: RUNNING_CLOCK_STATE.sessionId, expectedVersion: 7 },
  ]);
  const requests = server.sent.length;
  await page.getByRole('button', { name: 'Laufende Zeiterfassung öffnen', exact: true }).click();
  const section = unsentSection(page);
  await expect(section).toContainText('Deine Zeiterfassung wurde inzwischen geändert');
  await expect(
    section.getByRole('list', { name: 'Nicht übertragene Zeiten' }).getByRole('listitem'),
  ).toHaveText(/^Erfassung beendet/);
  await expect(section.getByRole('button', { name: 'Erneut senden', exact: true })).toHaveCount(0);
  // The end belongs to the session the server still runs: deleted, ended through the clock, then corrected.
  await expect(section.getByRole('button', { name: 'Korrektur beantragen', exact: true })).toHaveCount(0);
  await expect(section.locator('[data-clock-open-session]')).toBeVisible();
  await setNetwork(page, server, true);
  await expect(section).toBeVisible();
  expect(server.sent).toHaveLength(requests);
});

test('an online clock call that fails late is kept at the time of the tap, under its operation id, and never cleared on a guess', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-12T07:00:00.000Z') });
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  // The failed call had reached the server: it holds the id and refuses the resend as a reuse.
  server.verdict = { outcome: 'rejected', code: 'idempotency_conflict' };
  await page.evaluate(() => {
    window.clockContract.failTransition = true;
  });

  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Arbeit starten', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.clockContract.transitions.length)).toBe(1);
  // The connection drops only a minute after the tap.
  await page.clock.fastForward(60_000);
  await page.evaluate(() => window.clockContract.resolveTransition?.());

  await expect.poll(() => server.sent.length).toBe(1);
  const [online] = await page.evaluate(() => window.clockContract.transitions);
  expect(server.sent[0]?.operationId).toBe(online?.operationId);
  // Recorded at the tap, seconds after the clock started, not at the failure a minute later.
  const capturedAt = Date.parse(server.sent[0]?.capturedAt ?? '');
  expect(capturedAt - Date.parse('2026-11-12T07:00:00.000Z')).toBeLessThan(30_000);
  // The server may hold the start or only a recovery: the person checks it.
  await expect(unsentBadge(clockDock(page))).toHaveText('Konflikt');
  expect((await unsentOnDevice(page)).map((event) => event.operationId)).toEqual([online?.operationId]);
});

test('while the first look at a device that may hold unsent work is open, no clock action starts; the clock shows with its controls once the outbox answers', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE, holdDeviceStore, ACCEPTED, /^Nicht bereit/);
  const launcher = page.getByRole('button', { name: 'Zeiterfassung starten', exact: true });

  // What the device holds is unknown: a tap would go from a clock the person never saw.
  await expect(clockDock(page)).toHaveAttribute('data-clock-state', 'loading');
  await expect(launcher).toBeDisabled();

  await page.evaluate(() => window.releaseDeviceStore?.());

  await expect(clockStatus(page)).toHaveText('Nicht eingestempelt');
  await launcher.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Arbeit starten', exact: true }).click();
  // The outbox holds nothing for the person: the start goes online, from the clock shown.
  await expect.poll(() => page.evaluate(() => window.clockContract.transitions.length)).toBe(1);
  expect(server.sent).toEqual([]);
});

test('a running job during an open first look offers no action, queues nothing, and once the outbox answers its actions go on from the running session', async ({
  page,
}) => {
  const job = {
    id: '40000000-0000-4000-8000-000000000001',
    title: 'Heizungswartung Müller',
    jobNumber: 'A-2026-0142',
    status: 'in_bearbeitung',
    projectName: 'Neubau Musterweg',
    clientName: 'Familie Müller',
  };
  const server = await mountClock(
    page,
    {
      ...RUNNING_CLOCK_STATE,
      activeJobId: job.id,
      activeJobInfo: job,
      resumeJobInfo: job,
      currentActivity: { kind: 'work', allocationKind: 'job', jobId: job.id },
      resumeActivity: { kind: 'work', allocationKind: 'job', jobId: job.id },
    },
    // The hint concerns only a report draft or another person's time: the outbox holds nothing to stop on.
    holdDeviceStore,
    ACCEPTED,
    /^Nicht bereit/,
  );

  // Nothing is shown, so nothing is offered: a start built here would be a switch that drops the job.
  await expect(clockDock(page)).toHaveAttribute('data-clock-state', 'loading');
  await expect(clockDock(page).getByRole('button')).toHaveCount(1);
  await expect(clockDock(page).getByRole('button')).toBeDisabled();
  expect(await page.evaluate(() => window.clockContract.transitions)).toEqual([]);
  expect(await unsentOnDevice(page)).toEqual([]);

  await page.evaluate(() => window.releaseDeviceStore?.());

  await expect(clockStatus(page)).toHaveText(/^Arbeit · Heizungswartung Müller/);
  await expect(clockDock(page)).toHaveAttribute('data-clock-state', 'in');
  // The sheet now offers the running session's actions; „Arbeit starten“ is gone with the unknown clock.
  await page.getByRole('button', { name: 'Laufende Zeiterfassung öffnen', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Laufende Zeiterfassung', exact: true });
  await expect(sheet.getByRole('button', { name: 'Auftrag wechseln …', exact: true })).toBeEnabled();
  await expect(sheet.getByRole('button', { name: 'Arbeit starten', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.clockContract.transitions.length)).toBe(1);
  expect(await page.evaluate(() => window.clockContract.transitions)).toEqual([
    expect.objectContaining({
      action: 'switch',
      expectedSessionId: RUNNING_CLOCK_STATE.sessionId,
      expectedVersion: RUNNING_CLOCK_STATE.sessionVersion,
      selection: expect.objectContaining({ kind: 'break' }),
    }),
  ]);
  // The server answers the online call: nothing stays on the phone for later.
  await page.evaluate(() => window.clockContract.resolveTransition?.());
  await expect.poll(() => unsentOnDevice(page)).toEqual([]);
  expect(server.sent).toEqual([]);
});

test('a first look whose device store never answers ends in the clock’s failure with „Erneut laden“, never in a clock without controls', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-12T07:00:00.000Z') });
  const server = await mountClock(
    page,
    CLOCKED_OUT_STATE,
    () => {
      localStorage.setItem('werkflow:unsent:time', '1');
      // The device store never answers.
      Object.defineProperty(window, 'indexedDB', { value: { open: () => ({}) } });
    },
    ACCEPTED,
    /^Nicht bereit/,
  );
  const failure = clockDock(page).getByText('Der Zeitstatus konnte nicht sicher geladen werden.');
  await expect(failure).toHaveCount(0);

  // One bounded wait for the outbox's answer.
  await page.clock.fastForward(10_000);

  await expect(failure).toBeVisible();
  await expect(clockDock(page).getByRole('button', { name: 'Erneut laden', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Zeiterfassung starten', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.clockContract.transitions)).toEqual([]);
  expect(server.sent).toEqual([]);
});

test('a device whose storage fails says so, and its clock actions still reach the server while it has signal', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE, () => {
    localStorage.setItem('werkflow:unsent:time', '1');
    // A full disk: the device store refuses every request.
    Object.defineProperty(window, 'indexedDB', {
      value: {
        open: () => {
          throw new DOMException('The disk is full.', 'QuotaExceededError');
        },
      },
    });
  });

  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Der Speicher deines Geräts antwortet nicht.');
  await page.getByRole('dialog').getByRole('button', { name: 'Arbeit starten', exact: true }).click();

  await expect.poll(() => page.evaluate(() => window.clockContract.transitions.length)).toBe(1);
  expect(server.sent).toEqual([]);
});

test('a sign-out with unsent events names them and offers to send, to discard or to stay; it ends only once nothing is unsent', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await startWithoutNetwork(page, server);
  const check = page.getByRole('button', { name: 'Abmelden prüfen', exact: true });
  const outcome = page.getByLabel('Abmeldung');

  await check.click();
  const dialog = page.getByRole('dialog', { name: 'Noch nicht übertragen', exact: true });
  await expect(dialog.getByRole('listitem')).toHaveText('Stempelzeiten1');
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(outcome).toHaveText('Sitzung bleibt');
  expect(await unsentOnDevice(page)).toHaveLength(1);
  // The person stays: the session-end barrier is gone, so every tab keeps actions again.
  expect(await page.evaluate(() => localStorage.getItem('werkflow:session-ending'))).toBeNull();

  await check.click();
  await dialog.getByRole('button', { name: 'Jetzt senden', exact: true }).click();
  await expect(dialog).toContainText('Noch nicht alles ist übertragen.');
  await expect(outcome).toHaveText('');

  // The network is back, and no `online` event has told the page: the dialog's own send finds out.
  server.online = true;
  await dialog.getByRole('button', { name: 'Jetzt senden', exact: true }).click();
  await expect(outcome).toHaveText('Sitzung darf enden');
  await expect(dialog).toHaveCount(0);
  expect(await unsentOnDevice(page)).toEqual([]);
});

test('„Verwerfen“ asks once more, then deletes the unsent events for good and lets the session end', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  server.verdict = { outcome: 'rejected', code: 'forbidden' };
  await startWithoutNetwork(page, server);
  await setNetwork(page, server, true);
  await expect(unsentBadge(clockDock(page))).toHaveText('Nicht übertragen');

  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Noch nicht übertragen', exact: true });
  await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Nicht Übertragenes verwerfen?' });
  await expect(confirmation).toContainText(
    'Stempelzeiten: 1. Das wird von diesem Gerät gelöscht und nie erfasst.',
  );
  await confirmation.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  expect(await unsentOnDevice(page)).toHaveLength(1);

  await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Endgültig verwerfen', exact: true }).click();
  await expect(page.getByLabel('Abmeldung')).toHaveText('Sitzung darf enden');
  expect(await unsentOnDevice(page)).toEqual([]);
  expect(recorded(server)).toHaveLength(1);
});

test('„Verwerfen“ deletes only what the person was shown: an action kept since the question stays and is asked about', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  server.verdict = { outcome: 'rejected', code: 'forbidden' };
  await startWithoutNetwork(page, server);
  await setNetwork(page, server, true);
  await expect(unsentBadge(clockDock(page))).toHaveText('Nicht übertragen');
  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Noch nicht übertragen', exact: true });
  await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click();

  // Another tab keeps an end while the question is open.
  await page.evaluate(
    ({ userId, organizationId }) => {
      const operationId = '50000000-0000-4000-8000-0000000000e1';
      localStorage.setItem(
        `werkflow:unsent:clock:${String(Date.now()).padStart(15, '0')}:1:${operationId}`,
        JSON.stringify({
          userId,
          organizationId,
          operationId,
          action: 'end',
          selection: null,
          expectedSessionId: null,
          expectedVersion: null,
          capturedAt: new Date().toISOString(),
          triedOnline: false,
          version: 1,
          wipeGeneration: '',
          base: null,
          readAt: null,
        }),
      );
    },
    { userId: CLOCK_USER_ID, organizationId: CLOCK_ORGANIZATION_ID },
  );
  const confirmation = page.getByRole('alertdialog', { name: 'Nicht Übertragenes verwerfen?' });
  await confirmation.getByRole('button', { name: 'Endgültig verwerfen', exact: true }).click();

  await expect(dialog).toContainText('Seit deiner Frage ist noch etwas dazugekommen.');
  await expect(dialog.getByRole('listitem')).toHaveText('Stempelzeiten1');
  await expect(page.getByLabel('Abmeldung')).toHaveText('');
  expect((await unsentOnDevice(page)).map((event) => event.operationId)).toEqual([
    '50000000-0000-4000-8000-0000000000e1',
  ]);
});

test('a sign-out is not asked about another person’s events, which stay on the phone unsent', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  const colleague = '10000000-0000-4000-8000-0000000000bb';
  await page.evaluate(
    ({ userId, organizationId, base }) => {
      localStorage.setItem(
        'werkflow:unsent:clock:000000000000001:1:50000000-0000-4000-8000-000000000001',
        JSON.stringify({
          userId,
          organizationId,
          operationId: '50000000-0000-4000-8000-000000000001',
          action: 'start',
          selection: { kind: 'work', allocationKind: 'unallocated', jobId: null },
          expectedSessionId: null,
          expectedVersion: null,
          capturedAt: new Date().toISOString(),
          triedOnline: false,
          version: 1,
          wipeGeneration: '',
          base,
          readAt: new Date().toISOString(),
        }),
      );
    },
    { userId: colleague, organizationId: CLOCK_ORGANIZATION_ID, base: CLOCKED_OUT_STATE },
  );

  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();

  await expect(page.getByLabel('Abmeldung')).toHaveText('Sitzung darf enden');
  await expect(page.getByRole('dialog', { name: 'Noch nicht übertragen', exact: true })).toHaveCount(0);
  expect((await unsentOnDevice(page)).map((event) => event.userId)).toEqual([colleague]);
  expect(await unsentOnDevice(page)).not.toContainEqual(expect.objectContaining({ userId: CLOCK_USER_ID }));
  await setNetwork(page, server, true);
  await expect(page.getByLabel('Zeitstatus')).toHaveText(/^Bereit/);
  expect(server.sent).toEqual([]);
});

test('a sign-out that cannot read the device’s unsent work says so and keeps the session', async ({
  page,
}) => {
  await mountClock(page, CLOCKED_OUT_STATE);
  await page.evaluate(() => {
    Object.defineProperty(window, 'indexedDB', {
      value: {
        open: () => {
          throw new Error('The browser refused the storage.');
        },
      },
    });
  });

  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();

  await expect(page.getByLabel('Abmeldung')).toHaveText(
    'Prüfung fehlgeschlagen: Wir konnten nicht prüfen, ob auf diesem Gerät noch etwas nicht übertragen ist. Lade die Seite neu und versuche es dann erneut.',
  );
});
