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
