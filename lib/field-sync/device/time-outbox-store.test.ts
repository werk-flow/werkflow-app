import { beforeEach, expect, test } from 'bun:test';

import {
  COLLEAGUE,
  TIME_OUTBOX_DATABASE,
  WORKER,
  capture,
  command,
  resetDevice,
} from '@/lib/testing/fixtures/time-outbox';
import { readTimeOutbox, readWholeTimeOutbox } from './time-outbox-store';

// One person's unreadable record in the time outbox (decision record 0010, the time outbox's
// invariant 5) fails closed for that person only: another person on the same phone keeps
// working and signs out.

beforeEach(resetDevice);

/** Puts a record a newer version wrote for the colleague, which this version cannot read. */
async function colleaguesUnreadableRecord(): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(TIME_OUTBOX_DATABASE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('events', 'readwrite');
    transaction
      .objectStore('events')
      .put({ operationId: 'from-a-newer-version', userId: COLLEAGUE.userId, kind: 'new' });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

test('an unreadable record of one person leaves another person’s outbox usable, and fails closed for its own person', async () => {
  await capture(WORKER, command('start'));
  await colleaguesUnreadableRecord();

  await capture(WORKER, command('end'));
  expect((await readTimeOutbox(WORKER)).events.map((event) => event.action)).toEqual(['start', 'end']);
  await expect(readTimeOutbox(COLLEAGUE)).rejects.toThrow();
  // A reader for the worker alone sees the worker's events; one for everybody fails closed.
  expect((await readWholeTimeOutbox(WORKER.userId)).events).toHaveLength(2);
  await expect(readWholeTimeOutbox()).rejects.toThrow();
});
