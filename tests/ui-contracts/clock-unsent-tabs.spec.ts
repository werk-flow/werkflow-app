import { expect, test } from '@playwright/test';
import { clockDock } from '../golden/support/steps/time-tracking';
import { CLOCK_ORGANIZATION_ID, CLOCK_USER_ID } from './clock-state-fixture';
import {
  CLOCKED_OUT_STATE,
  mountClock,
  setNetwork,
  startWithoutNetwork,
  unsentBadge,
  unsentOnDevice,
  unsentSection,
} from './clock-unsent-support';

// What one tab learns of another tab's clock actions (werk-flow/werkflow-planning#319): an action
// another tab kept, and another tab's sign-out or switch, which ends this tab's hold.

test('a tab that started without unsent work learns of an action another tab kept, and shows it waiting', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await setNetwork(page, server, false);

  await page.evaluate(
    ({ userId, organizationId, base }) => {
      const operationId = '50000000-0000-4000-8000-0000000000f1';
      const key = `werkflow:unsent:clock:${String(Date.now()).padStart(15, '0')}:1:${operationId}`;
      const value = JSON.stringify({
        userId,
        organizationId,
        operationId,
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
      });
      window.contractOnline = false;
      localStorage.setItem(key, value);
      // The other tab's write reaches this tab as a storage event.
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
    },
    { userId: CLOCK_USER_ID, organizationId: CLOCK_ORGANIZATION_ID, base: CLOCKED_OUT_STATE },
  );

  await expect(unsentBadge(clockDock(page))).toHaveText('Wartet auf Netz');
});

test('after another tab’s sign-out ended this tab’s hold, a tap never reaches the server ahead of the person’s waiting events', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await startWithoutNetwork(page, server);
  await expect(unsentBadge(clockDock(page))).toHaveText('Wartet auf Netz');
  const waiting = (await unsentOnDevice(page)).map((event) => event.operationId);

  await page.evaluate(() => {
    localStorage.setItem('werkflow:today-wiped', 'another-tab');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'werkflow:today-wiped', newValue: 'another-tab' }),
    );
  });
  await expect(unsentBadge(clockDock(page))).toHaveCount(0);
  // The signal is back, and no `online` event told the page yet.
  server.online = true;
  await page.evaluate(() => {
    window.contractOnline = true;
  });
  // The page shows the server's clock again, so it offers a start.
  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Arbeit starten', exact: true }).click();

  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => window.clockContract.transitions)).toEqual([]);
  // Only the person's waiting start may reach the server; the new tap neither went online nor was kept.
  expect(server.sent.every((envelope) => waiting.includes(envelope.operationId))).toBe(true);
  await setNetwork(page, server, false);
});

test('a session end that fails after its check lifts its own barrier, so keeping works again', async ({
  page,
}) => {
  await mountClock(page, CLOCKED_OUT_STATE);

  await page.getByRole('button', { name: 'Abmelden mit Fehler', exact: true }).click();

  await expect(page.getByLabel('Abmeldung')).toHaveText('Abmeldung fehlgeschlagen');
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('werkflow:session-ending:')),
    ),
  ).toEqual([]);
});

test('a correction cleans up only the session its form opened for, also after another tab settled that session', async ({
  page,
}) => {
  const sessions = [
    ['start', '2026-11-09T06:00:00.000Z'],
    ['end', '2026-11-09T07:00:00.000Z'],
    ['start', '2026-11-09T12:00:00.000Z'],
    ['end', '2026-11-09T13:00:00.000Z'],
  ];
  await mountClock(page, CLOCKED_OUT_STATE, () => undefined, {
    outcome: 'conflict',
    code: 'correction_required',
  });
  await page.evaluate(
    ({ kept, userId, organizationId, base }) => {
      kept.forEach(([action, capturedAt], index) => {
        const operationId = `50000000-0000-4000-8000-00000000020${index}`;
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
    { kept: sessions, userId: CLOCK_USER_ID, organizationId: CLOCK_ORGANIZATION_ID, base: CLOCKED_OUT_STATE },
  );
  await expect(unsentBadge(clockDock(page))).toHaveText('Korrektur nötig');
  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  await page
    .getByRole('region', { name: 'Noch nicht übertragen' })
    .getByRole('button', { name: 'Korrektur beantragen', exact: true })
    .click();
  const correction = page.getByRole('dialog', { name: 'Zeit nachtragen', exact: true });
  await expect(correction.getByLabel('Vorbelegung')).toHaveText('9.11.2026 | 07:00 | 08:00');

  // Another tab settles the morning session while this form is open.
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('werkflow-time-outbox');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('events', 'readwrite');
    for (const id of ['50000000-0000-4000-8000-000000000200', '50000000-0000-4000-8000-000000000201'])
      transaction.objectStore('events').delete(id);
    await new Promise((resolve) => {
      transaction.oncomplete = resolve;
    });
    database.close();
    localStorage.setItem('werkflow:time-outbox-changed', String(Date.now()));
    window.dispatchEvent(new StorageEvent('storage', { key: 'werkflow:time-outbox-changed' }));
  });
  // This page has heard of it: only the afternoon session is listed now.
  await expect(page.getByRole('region', { name: 'Noch nicht übertragen' }).getByRole('listitem')).toHaveCount(
    2,
  );
  await correction.getByRole('button', { name: 'Korrektur einreichen', exact: true }).click();

  // The form closes once its cleanup ran. The afternoon session was never in this form: it stays.
  await expect(correction).toHaveCount(0);
  expect((await unsentOnDevice(page)).map((event) => event.operationId)).toEqual([
    '50000000-0000-4000-8000-000000000202',
    '50000000-0000-4000-8000-000000000203',
  ]);
});

test('a deletion removes only the events its question showed, never one another tab kept while it was open', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  server.verdict = { outcome: 'rejected', code: 'closed_period' };
  await startWithoutNetwork(page, server);
  await setNetwork(page, server, true);
  await expect(unsentBadge(clockDock(page))).toHaveText('Nicht übertragen');
  const section = page.getByRole('region', { name: 'Noch nicht übertragen' });
  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  await section.getByRole('button', { name: 'Löschen', exact: true }).click();
  const shown = (await unsentOnDevice(page)).map((event) => event.operationId);

  // Another tab keeps an end while the question is open; this page takes it in behind the start.
  await page.evaluate(
    ({ userId, organizationId }) => {
      const operationId = '50000000-0000-4000-8000-0000000000f9';
      const key = `werkflow:unsent:clock:${String(Date.now()).padStart(15, '0')}:1:${operationId}`;
      const value = JSON.stringify({
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
      });
      localStorage.setItem(key, value);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
    },
    { userId: CLOCK_USER_ID, organizationId: CLOCK_ORGANIZATION_ID },
  );
  await expect.poll(async () => (await unsentOnDevice(page)).length).toBe(2);
  const confirmation = page.getByRole('alertdialog', { name: 'Nicht übertragene Zeiten löschen?' });
  await confirmation.getByRole('button', { name: 'Endgültig löschen', exact: true }).click();

  await expect(confirmation).toHaveCount(0);
  expect((await unsentOnDevice(page)).map((event) => event.operationId)).toEqual([
    '50000000-0000-4000-8000-0000000000f9',
  ]);
  expect(shown).not.toContain('50000000-0000-4000-8000-0000000000f9');
});

test('a sign-out shows its question at once while it sends, and „Abbrechen“ keeps the session even if the send never answers', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await startWithoutNetwork(page, server);
  // The phone reports a connection, and the send stays in a dead spot.
  server.online = true;
  server.stalls = true;
  await page.evaluate(() => {
    window.contractOnline = true;
  });

  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Noch nicht übertragen', exact: true });
  await expect(dialog).toContainText('wird gesendet …');
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();

  await expect(page.getByLabel('Abmeldung')).toHaveText('Sitzung bleibt');
  await expect(dialog).toHaveCount(0);
});

test('a kept action this version cannot read is a stop the person sees with what to do; a tap waits behind it and is sent once they delete it', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await page.evaluate(() =>
    localStorage.setItem(
      'werkflow:unsent:clock:000000000000001:1:from-a-newer-version',
      '{"operationId":"x","kind":"new"}',
    ),
  );

  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Arbeit starten', exact: true }).click();

  await expect(unsentBadge(clockDock(page))).toHaveText('Nicht lesbar');
  expect(await page.evaluate(() => window.clockContract.transitions)).toEqual([]);
  expect(server.sent).toEqual([]);

  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  const section = unsentSection(page);
  await expect(section).toContainText('kann hier nicht gelesen werden');
  await expect(section.getByRole('listitem')).toHaveText(/^Nicht lesbare Stempelzeit/);
  await expect(section.getByRole('button', { name: 'Korrektur beantragen', exact: true })).toHaveCount(0);
  await section.getByRole('button', { name: 'Löschen', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Nicht übertragene Zeiten löschen?' })
    .getByRole('button', { name: 'Endgültig löschen', exact: true })
    .click();
  await expect(section).toHaveCount(0);

  // The tap kept behind the stop was neither shown nor deleted: once the stop is gone it is sent, at its time.
  await expect.poll(() => server.sent.map(({ payload }) => payload.action)).toEqual(['start']);
  await expect.poll(async () => (await unsentOnDevice(page)).length).toBe(0);
});

test('a session end that runs longer than ten minutes keeps its barrier fresh, so no tab keeps behind its back', async ({
  page,
}) => {
  await page.clock.install();
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await startWithoutNetwork(page, server);
  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Noch nicht übertragen', exact: true });
  await expect(dialog).toBeVisible();

  // The person thinks it over, or the flow waits on the network, for eleven minutes.
  await page.clock.fastForward('11:00');

  const ages = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith('werkflow:session-ending:'))
      .map((key) => Date.now() - Number(localStorage.getItem(key))),
  );
  expect(ages).toHaveLength(1);
  expect(ages[0]).toBeLessThan(2 * 60 * 1000);
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByLabel('Abmeldung')).toHaveText('Sitzung bleibt');
});

test('an event that waited more than seven days says it is still tried, and that a correction or a deletion settles it', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await setNetwork(page, server, false);
  await page.evaluate(
    ({ userId, organizationId, base }) => {
      const operationId = '50000000-0000-4000-8000-0000000000fb';
      const capturedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const key = `werkflow:unsent:clock:${String(Date.parse(capturedAt)).padStart(15, '0')}:1:${operationId}`;
      const value = JSON.stringify({
        userId,
        organizationId,
        operationId,
        action: 'start',
        selection: { kind: 'work', allocationKind: 'unallocated', jobId: null },
        expectedSessionId: null,
        expectedVersion: null,
        capturedAt,
        triedOnline: false,
        version: 1,
        wipeGeneration: '',
        base,
        readAt: capturedAt,
      });
      localStorage.setItem(key, value);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
    },
    { userId: CLOCK_USER_ID, organizationId: CLOCK_ORGANIZATION_ID, base: CLOCKED_OUT_STATE },
  );
  await expect(unsentBadge(clockDock(page))).toHaveText('Nicht übertragen');
  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();

  await expect(page.getByRole('region', { name: 'Noch nicht übertragen' })).toContainText(
    'WerkFlow versucht weiter, sie zu senden',
  );
});
