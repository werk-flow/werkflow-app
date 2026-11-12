import { expect, test } from '@playwright/test';
import { clockDock, clockStatus } from '../golden/support/steps/time-tracking';
import { CLOCK_ORGANIZATION_ID, CLOCK_USER_ID, RUNNING_CLOCK_STATE } from './clock-state-fixture';
import {
  ACCEPTED,
  CLOCKED_OUT_STATE,
  mountClock,
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

  await expect.poll(() => server.sent.length).toBe(1);
  expect(server.authorization).toEqual(['Bearer contract-access-token']);
  const [envelope] = server.sent;
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
  await setNetwork(page, server, true);
  await expect(page.getByLabel('Zeitstatus')).toHaveText('Bereit: 1');
  expect(server.sent).toHaveLength(1);
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

  await expect.poll(() => server.sent.length).toBe(2);
  expect(server.sent.map((envelope) => envelope.payload)).toMatchObject([
    { action: 'start', expectedSessionId: null, expectedVersion: null },
    { action: 'switch', expectedSessionId: ACCEPTED.state?.sessionId, expectedVersion: 1 },
  ]);
  expect(Date.parse(server.sent[0]?.capturedAt ?? '')).toBeLessThanOrEqual(
    Date.parse(server.sent[1]?.capturedAt ?? ''),
  );
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

  await section.getByRole('button', { name: 'Erneut senden', exact: true }).click();
  await expect.poll(() => server.sent.length).toBe(2);
  expect(withoutSentAt(server.sent[1])).toEqual(withoutSentAt(server.sent[0]));
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
  expect(server.sent).toHaveLength(2);
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
  expect(server.sent).toHaveLength(1);
});

test('a late chain of a session the server still holds open offers no correction: the person keeps the times, deletes them, ends the session, then corrects', async ({
  page,
}) => {
  const running = {
    ...RUNNING_CLOCK_STATE,
    clockInTime: '2026-11-09T07:00:00.000Z',
    statusStartedAt: '2026-11-09T07:00:00.000Z',
  };
  await mountClock(page, running, () => undefined, { outcome: 'conflict', code: 'correction_required' });
  await page.evaluate(
    ({ userId, organizationId, base }) => {
      [
        ['switch', '2026-11-09T09:00:00.000Z'],
        ['end', '2026-11-09T15:00:00.000Z'],
      ].forEach(([action, capturedAt], index) => {
        const operationId = `50000000-0000-4000-8000-00000000030${index}`;
        localStorage.setItem(
          `werkflow:unsent:clock:${String(Date.parse(capturedAt ?? '')).padStart(15, '0')}:1:${operationId}`,
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
    { userId: CLOCK_USER_ID, organizationId: CLOCK_ORGANIZATION_ID, base: running },
  );
  await expect(unsentBadge(clockDock(page))).toHaveText('Korrektur nötig');
  await page.getByRole('button', { name: 'Laufende Zeiterfassung öffnen', exact: true }).click();
  const section = unsentSection(page);

  // A correction would add 08:00 to 16:00, and ending the open session later would count it again.
  await expect(section.getByRole('button', { name: 'Korrektur beantragen', exact: true })).toHaveCount(0);
  await expect(section.locator('[data-clock-open-session]')).toContainText('Notiere dir die Zeiten unten.');
  await expect(section.getByRole('listitem').filter({ hasText: 'Pause gestartet' })).toContainText('10:00');

  await section.getByRole('button', { name: 'Löschen', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Nicht übertragene Zeiten löschen?' });
  await expect(confirmation.getByRole('listitem').filter({ hasText: 'Erfassung beendet' })).toContainText(
    '16:00',
  );
  await expect(confirmation.locator('[data-clock-open-session]')).toContainText(
    'Beende die laufende Zeiterfassung über die Uhr.',
  );
  await confirmation.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Zeit nachtragen', exact: true })).toHaveCount(0);
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
  expect(server.sent.map((envelope) => envelope.payload)).toMatchObject([
    { action: 'end', expectedSessionId: RUNNING_CLOCK_STATE.sessionId, expectedVersion: 7 },
  ]);
  await page.getByRole('button', { name: 'Laufende Zeiterfassung öffnen', exact: true }).click();
  const section = unsentSection(page);
  await expect(section).toContainText('Deine Zeiterfassung wurde inzwischen geändert');
  await expect(section.getByRole('listitem')).toHaveText(/^Erfassung beendet/);
  await expect(section.getByRole('button', { name: 'Erneut senden', exact: true })).toHaveCount(0);
  // The end belongs to the session the server still runs: deleted, ended through the clock, then corrected.
  await expect(section.getByRole('button', { name: 'Korrektur beantragen', exact: true })).toHaveCount(0);
  await expect(section.locator('[data-clock-open-session]')).toBeVisible();
  await setNetwork(page, server, true);
  await expect(section).toBeVisible();
  expect(server.sent).toHaveLength(1);
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

test('while the outbox of a device that holds unsent work has not answered yet, a new action waits behind it instead of reaching the server first', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE, () => {
    // An earlier visit left unsent work, and the device store does not answer yet.
    localStorage.setItem('werkflow:unsent:time', '1');
    Object.defineProperty(window, 'indexedDB', { value: { open: () => ({}) } });
  });

  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Arbeit starten', exact: true }).click();

  await expect(clockStatus(page)).toHaveText('Arbeit');
  await expect(unsentBadge(clockDock(page))).toHaveText('Wartet auf Netz');
  expect(await page.evaluate(() => window.clockContract.transitions)).toEqual([]);
  expect(server.sent).toEqual([]);
  // The waiting work may be another person's: the action keeps the clock the server confirmed.
  const kept = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith('werkflow:unsent:clock:'))
      .map((key) => JSON.parse(localStorage.getItem(key) ?? 'null')),
  );
  expect(kept).toEqual([
    expect.objectContaining({
      readAt: expect.any(String),
      base: expect.objectContaining({ isClockedIn: false }),
    }),
  ]);
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
  expect(server.sent).toHaveLength(1);
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
