import { expect, test } from 'bun:test';
import type { RealtimeChangeEvent } from './events';
import { createListenerRegistry } from './listener-registry';

// Tier 2 for connection catch-up (docs/technical/realtime-and-caching.md): a
// view that shows the document's server data and subscribes after database
// readiness still gets its one catch-up; nothing else gets an extra one.

const catchUp = (table: RealtimeChangeEvent['table']): RealtimeChangeEvent => ({
  table,
  eventType: 'UPDATE',
  new: null,
  old: null,
});

async function settle(): Promise<void> {
  await Promise.resolve();
}

test('readiness catches up every current listener once', async () => {
  const registry = createListenerRegistry();
  const jobs: RealtimeChangeEvent[] = [];
  const members: RealtimeChangeEvent[] = [];
  registry.subscribe('jobs', (event) => jobs.push(event), true);
  registry.subscribe('organization_members', (event) => members.push(event));
  await settle();
  expect(jobs).toEqual([]);
  registry.dispatchAll({ joined: true });
  await settle();
  expect(jobs).toEqual([catchUp('jobs')]);
  expect(members).toEqual([catchUp('organization_members')]);
});

test('a server-data view that subscribes after readiness reads once; a client view does not', async () => {
  const registry = createListenerRegistry();
  registry.dispatchAll({ joined: true });
  const hydrated: RealtimeChangeEvent[] = [];
  const clientMounted: RealtimeChangeEvent[] = [];
  registry.subscribe('jobs', (event) => hydrated.push(event), true);
  registry.subscribe('jobs', (event) => clientMounted.push(event), false);
  await settle();
  expect(hydrated).toEqual([catchUp('jobs')]);
  expect(clientMounted).toEqual([]);
});

test('a view that left before the catch-up ran, or a channel that closed, gets none', async () => {
  const registry = createListenerRegistry();
  registry.dispatchAll({ joined: true });
  const left: RealtimeChangeEvent[] = [];
  registry.subscribe('jobs', (event) => left.push(event), true)();
  registry.leave();
  const afterClose: RealtimeChangeEvent[] = [];
  registry.subscribe('jobs', (event) => afterClose.push(event), true);
  await settle();
  expect(left).toEqual([]);
  // The reconnect's readiness catches it up instead.
  expect(afterClose).toEqual([]);
  registry.dispatchAll({ joined: true });
  expect(afterClose).toEqual([catchUp('jobs')]);
});

test('a focus catch-up does not mark readiness', async () => {
  const registry = createListenerRegistry();
  registry.dispatchAll();
  const late: RealtimeChangeEvent[] = [];
  registry.subscribe('jobs', (event) => late.push(event), true);
  await settle();
  expect(late).toEqual([]);
});

test('events reach the listeners of their table only', () => {
  const registry = createListenerRegistry();
  const jobs: RealtimeChangeEvent[] = [];
  registry.subscribe('jobs', (event) => jobs.push(event));
  const event: RealtimeChangeEvent = { table: 'jobs', eventType: 'INSERT', new: { id: 'a' }, old: null };
  registry.dispatch(event);
  registry.dispatch({ ...event, table: 'clients' });
  expect(jobs).toEqual([event]);
});
