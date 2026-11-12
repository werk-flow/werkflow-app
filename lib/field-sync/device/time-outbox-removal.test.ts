import { beforeEach, describe, expect, test } from 'bun:test';

import {
  CLOCKED_OUT,
  SESSION_ID,
  WORKER,
  WORKING,
  capture,
  command,
  resetDevice,
  result,
  server,
} from '@/lib/testing/fixtures/time-outbox';
import { clockDeviceView, correctionScope, removeTimeEvents } from './time-outbox';
import { sendTimeOutbox } from './time-outbox-send';
import { readTimeOutbox } from './time-outbox-store';

// What leaves the time outbox when the person settles a stopped chain (werk-flow/werkflow-planning#319):
// a correction or a deletion removes exactly the events the person saw, and the rest goes on.

beforeEach(resetDevice);

describe('removing events the person settled', () => {
  /** Monday's start and end and Tuesday's start and end, kept without signal; Monday's start met a conflict. */
  async function twoDaysStopped(): Promise<string[]> {
    const kept = [
      [command('start'), '2026-11-09T07:00:00.000Z'],
      [command('end'), '2026-11-09T16:00:00.000Z'],
      [command('start'), '2026-11-10T07:00:00.000Z'],
      [command('end'), '2026-11-10T15:00:00.000Z'],
    ] as const;
    for (const [action, at] of kept) await capture(WORKER, action, { at });
    const { options } = server((envelope) =>
      result(envelope, { outcome: 'conflict', code: 'stale_version' }),
    );
    await sendTimeOutbox(WORKER, options);
    return kept.map(([action]) => action.operationId);
  }

  test('a correction never reaches into the next Berlin day', async () => {
    const ids = await twoDaysStopped();
    const view = clockDeviceView(await readTimeOutbox(WORKER), new Date('2026-11-11T09:00:00.000Z'));
    if (!view) throw new Error('the chain is shown');

    expect(correctionScope(view).map((event) => event.operationId)).toEqual(ids.slice(0, 2));
  });

  test('a correction covers one session: two sessions of one day are two corrections, so the break between them is never filed as work', async () => {
    const kept = [
      [command('start'), '2026-11-09T07:00:00.000Z'],
      [command('end'), '2026-11-09T08:00:00.000Z'],
      [command('start'), '2026-11-09T13:00:00.000Z'],
      [command('end'), '2026-11-09T14:00:00.000Z'],
    ] as const;
    for (const [action, at] of kept) await capture(WORKER, action, { at });
    const view = clockDeviceView(await readTimeOutbox(WORKER), new Date('2026-11-11T09:00:00.000Z'));
    if (!view) throw new Error('the chain is shown');

    expect(correctionScope(view).map((event) => event.operationId)).toEqual(
      kept.slice(0, 2).map(([action]) => action.operationId),
    );
  });

  test('removing the events a correction covers keeps the rest, which goes on from the server’s current state', async () => {
    const ids = await twoDaysStopped();
    await removeTimeEvents(WORKER, ids.slice(0, 2), WORKING);

    const outbox = await readTimeOutbox(WORKER);
    expect(outbox.events.map((event) => event.operationId)).toEqual(ids.slice(2));
    expect(outbox.events[0]?.expected).toEqual({ sessionId: SESSION_ID, version: 3 });
    expect(outbox.events[0]?.verdict).toBeNull();
    const view = clockDeviceView(outbox, new Date('2026-11-11T09:00:00.000Z'));
    expect(view?.events.map((event) => event.status)).toEqual(['pending', 'pending']);
  });

  test('deleting removes exactly the events the person was shown; one kept after the question stays', async () => {
    const ids = await twoDaysStopped();
    const later = command('start');
    await capture(WORKER, later, { at: '2026-11-11T07:00:00.000Z' });
    await removeTimeEvents(WORKER, ids, CLOCKED_OUT);

    const outbox = await readTimeOutbox(WORKER);
    expect(outbox.events.map((event) => event.operationId)).toEqual([later.operationId]);
    expect(outbox.events[0]?.expected).toEqual({ sessionId: null, version: null });
  });
});
