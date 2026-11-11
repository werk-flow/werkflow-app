import { expect, type Locator, type Page } from '@playwright/test';

import { createAdminClient } from '../../golden/support/db/shared';
import type { TestWorld } from '../../golden/support/world';

// The time outbox a phone keeps without signal
// (lib/field-sync/device/time-outbox-store.ts): reads and seeds of the device
// store, the server's recorded events, and the locators of the clock's unsent
// section and of the question a sign-out asks. The spec passes data; copy and
// storage names live here.

/** The IndexedDB database, its stores and the start-up hint of the time outbox. */
const TIME_OUTBOX_DATABASE = 'werkflow-time-outbox';
const UNSENT_TIME_MARK = 'werkflow:unsent:time';

export const UNSENT_COPY = {
  section: 'Noch nicht übertragen',
  waiting: 'Wartet auf Netz',
  refused: 'Nicht übertragen',
  sendNow: 'Jetzt senden',
  delete: 'Löschen',
  deleteQuestion: 'Nicht übertragene Zeiten löschen?',
  discard: 'Verwerfen',
  discardQuestion: 'Nicht Übertragenes verwerfen?',
  cancel: 'Abbrechen',
  offlineClock: 'Zeiterfassung',
  startWork: 'Arbeit starten',
  end: 'Erfassung beenden',
  clockedOut: 'Nicht eingestempelt',
  /** The dock's status line while work runs. */
  working: /^Arbeit/,
  /** The offline clock's status line while work runs, with its captured start. */
  workingSince: /Arbeit · seit \d{2}:\d{2} Uhr/,
} as const;

/** The clock's section of unsent events, in the app's clock sheet. */
function unsentSection(scope: Page | Locator): Locator {
  return scope.getByRole('region', { name: UNSENT_COPY.section, exact: true });
}

/** The badge of the unsent chain, in the dock, the sheet or the offline clock. */
export function unsentBadge(scope: Page | Locator, text: string): Locator {
  return scope.locator('[data-clock-unsent]').filter({ hasText: text });
}

/** „Löschen“ of a stopped chain, in the clock sheet's unsent section. */
export function unsentDeleteButton(scope: Page | Locator): Locator {
  return unsentSection(scope).getByRole('button', { name: UNSENT_COPY.delete, exact: true });
}

export function unsentDeleteConfirmation(page: Page): Locator {
  return page.getByRole('alertdialog', { name: UNSENT_COPY.deleteQuestion, exact: true });
}

/** The question a sign-out or an organization switch asks while something is unsent. */
export function unsentWorkDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: UNSENT_COPY.section, exact: true });
}

export function unsentDiscardButton(page: Page): Locator {
  return unsentWorkDialog(page).getByRole('button', { name: UNSENT_COPY.discard, exact: true });
}

export function unsentDiscardConfirmation(page: Page): Locator {
  return page.getByRole('alertdialog', { name: UNSENT_COPY.discardQuestion, exact: true });
}

/** The clock of the page a phone shows without signal. */
export function offlineClock(page: Page): Locator {
  return page.getByRole('region', { name: UNSENT_COPY.offlineClock, exact: true });
}

/** One of the next actions of the clock without signal, by its label. */
export function offlineClockAction(page: Page, name: string): Locator {
  return offlineClock(page).getByRole('button', { name, exact: true });
}

/** „Arbeit starten“ in the app's clock sheet. */
export function startWorkAction(sheet: Locator): Locator {
  return sheet.getByRole('button', { name: UNSENT_COPY.startWork, exact: true });
}

type DeviceTimeEvent = { operationId: string; capturedAt: string; action: string };

/** The unsent events the device holds, in their order; empty when it holds none. */
async function readTimeEventsOnDevice(page: Page): Promise<DeviceTimeEvent[]> {
  return page.evaluate(async (name) => {
    const names = (await indexedDB.databases()).map((info) => info.name);
    if (!names.includes(name)) return [];
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise<
        { sequence: number; operationId: string; capturedAt: string; action: string }[]
      >((resolve, reject) => {
        const request = database.transaction('events').objectStore('events').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return rows
        .toSorted((left, right) => left.sequence - right.sequence)
        .map(({ operationId, capturedAt, action }) => ({ operationId, capturedAt, action }));
    } finally {
      database.close();
    }
  }, TIME_OUTBOX_DATABASE);
}

/** Waits until the device holds exactly these unsent actions, in this order. */
export async function expectTimeEventsOnDevice(page: Page, actions: readonly string[]): Promise<void> {
  await expect
    .poll(async () => (await readTimeEventsOnDevice(page)).map((event) => event.action), {
      message: `The device holds the unsent clock events ${actions.join(', ') || '(none)'}`,
    })
    .toEqual([...actions]);
}

/**
 * Puts one clock start the server refused on the device for the world's employee, as a phone
 * holds it after the answer, and loads the page again so the clock shows it. The device then
 * holds a stopped chain: nothing of it is sent again without the person.
 */
export async function seedRefusedTimeEvent(page: Page, world: TestWorld): Promise<void> {
  await page.evaluate(
    async ({ name, mark, userId, organizationId }) => {
      const response = await fetch(`/api/time-tracking-state?organizationId=${organizationId}&kind=clock`);
      const answer: unknown = await response.json();
      const state: unknown =
        typeof answer === 'object' && answer !== null && 'state' in answer ? answer.state : null;
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('events', { keyPath: 'operationId' });
          request.result.createObjectStore('clocks', { keyPath: 'holder' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = database.transaction(['events', 'clocks'], 'readwrite');
        transaction.objectStore('events').put({
          operationId: crypto.randomUUID(),
          userId,
          organizationId,
          sequence: 1,
          capturedAt: new Date().toISOString(),
          action: 'start',
          selection: { kind: 'work', allocationKind: 'unallocated', jobId: null },
          expected: { sessionId: null, version: null },
          triedOnline: false,
          verdict: { outcome: 'rejected', code: 'closed_period' },
        });
        transaction.objectStore('clocks').put({
          holder: `${userId}:${organizationId}`,
          userId,
          organizationId,
          base: state,
          wipeGeneration: localStorage.getItem('werkflow:today-wiped') ?? '',
        });
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
      localStorage.setItem(mark, '1');
    },
    {
      name: TIME_OUTBOX_DATABASE,
      mark: UNSENT_TIME_MARK,
      userId: world.users.employee.id,
      organizationId: world.orgId,
    },
  );
  await page.reload();
  await expect(unsentBadge(page, UNSENT_COPY.refused)).toBeVisible();
}

type RecordedSession = { startedAt: number; endedAt: number | null };

/** The employee's recorded clock sessions in the world's organization, oldest first, as instants. */
async function recordedSessions(world: TestWorld): Promise<RecordedSession[]> {
  const { data } = await createAdminClient()
    .from('time_sessions')
    .select('started_at, ended_at')
    .eq('organization_id', world.orgId)
    .eq('user_id', world.users.employee.id)
    .order('started_at', { ascending: true })
    .throwOnError();
  return data.map((row) => ({
    startedAt: Date.parse(row.started_at),
    endedAt: row.ended_at === null ? null : Date.parse(row.ended_at),
  }));
}

/**
 * Reads the start and the end the device holds unsent, lets `reconnect` bring the signal back,
 * and waits until the server holds exactly one session of the employee, started and ended at
 * those captured times and not at the later time it received them.
 */
export async function expectOneSessionAtCapturedTimes(
  page: Page,
  world: TestWorld,
  reconnect: () => Promise<void>,
): Promise<void> {
  const [start, end, ...rest] = await readTimeEventsOnDevice(page);
  expect([start?.action, end?.action, rest.length]).toEqual(['start', 'end', 0]);
  await reconnect();
  const startedAt = Date.parse(start?.capturedAt ?? '');
  await expect
    .poll(async () => (await recordedSessions(world)).filter((session) => session.startedAt >= startedAt), {
      message: 'The server holds one session at the times the phone captured',
    })
    .toEqual([{ startedAt, endedAt: Date.parse(end?.capturedAt ?? '') }]);
}
