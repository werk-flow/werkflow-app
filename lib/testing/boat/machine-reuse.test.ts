// Rule test: a checkout's consecutive Boat runs share one machine only after a wipe, never at once,
// and only while Boat would still stop and erase it by itself; every other machine of the checkout
// is deleted. Prevents a start per run (decision 15, werk-flow/werkflow-planning#294).
import { afterAll, beforeAll, expect, setSystemTime, test } from 'bun:test';
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from '../../zod';

import { boatClient } from './boat-api';
import { acquireMachine, keepMachine, reapIdleMachine, withMachine } from './machine-reuse';

const repository = join(import.meta.dir, '../../..');
const MINUTE = 60_000;
// Boat's auto-stop times below count from this instant.
const NOW = new Date('2026-11-09T12:00:00Z');
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());

/** A Boat stand-in: machines by id with their auto-stop, every call it got, and the commands it ran. */
function fakeBoat(
  machines: Record<string, { lifeMs: number | null; state?: string }>,
  wipeExit = 0,
  /** Called as Boat reports a command finished; a test's interruption at that moment. */
  onExit: () => void = () => undefined,
  /** Calls Boat refuses with a 500, as `GET /sandboxes?…` or `GET /sandboxes/bx_…`. */
  refused: (call: string) => boolean = () => false,
) {
  const calls: string[] = [];
  const commands: string[] = [];
  const client = boatClient('boat_secret', async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    const method = init?.method ?? 'GET';
    calls.push(
      `${method} ${pathname.replace('/api/v1', '')}${method === 'GET' && searchParams.size ? `?${searchParams}` : ''}`,
    );
    if (refused(calls.at(-1) ?? '')) return Response.json({ code: 'internal' }, { status: 500 });
    const id = /\/sandboxes\/(bx_\w+)/.exec(pathname)?.[1];
    const sandbox = (key: string) => {
      const machine = machines[key];
      return {
        id: key,
        state: machine?.state ?? 'ready',
        archiveAfter: machine?.lifeMs == null ? null : new Date(NOW.getTime() + machine.lifeMs).toISOString(),
      };
    };
    if (method === 'POST' && pathname.endsWith('/sandboxes')) {
      machines.bx_created = { lifeMs: 180 * MINUTE };
      return Response.json({ sandbox: { id: 'bx_created', state: 'provisioning' } });
    }
    if (method === 'POST' && pathname.endsWith('/commands')) {
      // The script as bash reads it: runScript sends it as one quoted word after `bash -lc`.
      const { command } = z.object({ command: z.string() }).parse(JSON.parse(String(init?.body)));
      commands.push(command.slice("bash -lc '".length, -1).replaceAll(`'\\''`, "'"));
      return Response.json({ processId: 7 });
    }
    if (pathname.endsWith('/commands/7')) {
      onExit();
      return Response.json({
        status: 'exited',
        running: false,
        exitCode: wipeExit,
        stdout: wipeExit ? 'a line without its newline' : '',
        // A failing wipe names its reason; the login shell may still print after it.
        stderr: wipeExit
          ? '[boat] wipe failed: /tmp still holds: run.log \nTERM environment variable not set.\n'
          : '',
      });
    }
    if (pathname.endsWith('/usage'))
      return Response.json({ seconds: 4, dollars: 0.001, sandboxType: 'large' });
    if (method === 'DELETE') {
      if (id) Reflect.deleteProperty(machines, id);
      return Response.json({ operation: { id: 'op', status: 'pending' } });
    }
    if (pathname.endsWith('/sandboxes'))
      return Response.json({ sandboxes: Object.keys(machines).map(sandbox) });
    if (id && machines[id]) return Response.json({ sandbox: sandbox(id) });
    return Response.json({ code: 'not_found' }, { status: 404 });
  });
  return { client, calls, commands };
}

const acquire = (client: ReturnType<typeof boatClient>, records: string) =>
  acquireMachine(client, {
    repository,
    from: 'werkflow-verify',
    name: 'verify-test',
    log: () => undefined,
    signal: new AbortController().signal,
    records,
  });

test("a wiped machine serves the checkout's next run, and the run deletes every other machine of the checkout", async () => {
  const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
  const boat = fakeBoat({ bx_kept0001: { lifeMs: 120 * MINUTE }, bx_leftover: { lifeMs: 150 * MINUTE } });
  const reapers: string[] = [];
  const kept = await keepMachine(
    { id: 'bx_kept0001', client: boat.client, log: () => undefined },
    { repository, form: 'linked', signal: new AbortController().signal, records },
    (_repository, record) => reapers.push(record),
  );
  expect(kept).toBe(true);
  // The wipe runs as text: the script's own commands, with the checkout it removes.
  expect(boat.commands[0]).toContain(`set -- 'wipe' '${repository}' 'linked'`);
  expect(reapers).toHaveLength(1);

  const lease = await acquire(boat.client, records);
  expect(lease).toMatchObject({ machine: { id: 'bx_kept0001' }, reused: true });
  // The listing asks for this checkout's machines only; the leftover one is deleted, the kept one not.
  expect(boat.calls.find((call) => call.startsWith('GET /sandboxes?'))).toMatch(
    /label=checkout%3D[0-9a-f]{16}/,
  );
  expect(boat.calls.filter((call) => call.startsWith('DELETE'))).toEqual(['DELETE /sandboxes/bx_leftover']);
  expect(boat.calls.some((call) => call === 'POST /sandboxes')).toBe(false);
  // The record is taken: the reaper of the first run finds nothing and deletes nothing.
  expect(readdirSync(records)).toEqual([]);
  await reapIdleMachine(reapers[0] ?? '', 0, () => boat.client);
  expect(boat.calls.filter((call) => call === 'DELETE /sandboxes/bx_kept0001')).toEqual([]);
});

test('a kept machine nobody takes is deleted by its reaper', async () => {
  const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
  const boat = fakeBoat({ bx_kept0001: { lifeMs: 120 * MINUTE } });
  let record = '';
  await keepMachine(
    { id: 'bx_kept0001', client: boat.client, log: () => undefined },
    { repository, form: 'main', signal: new AbortController().signal, records },
    (_repository, path) => {
      record = path;
    },
  );
  await reapIdleMachine(record, 0, () => boat.client);
  expect(boat.calls).toContain('DELETE /sandboxes/bx_kept0001');
  expect(readdirSync(records)).toEqual([]);
});

test('a machine with too little life left for a run, or none Boat would end, is neither kept nor reused', async () => {
  const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
  const boat = fakeBoat({ bx_short001: { lifeMs: 59 * MINUTE } });
  const keep = (id: string) =>
    keepMachine(
      { id, client: boat.client, log: () => undefined },
      { repository, form: 'main', signal: new AbortController().signal, records },
      () => undefined,
    );
  expect(await keep('bx_short001')).toBe(false);
  expect(boat.commands).toEqual([]);

  // A record whose machine has too little life, or no auto-stop, gives way to a new machine; the
  // old ones are deleted, and the new one records its fresh state before the run.
  const machines: Record<string, { lifeMs: number | null }> = {
    bx_short001: { lifeMs: 120 * MINUTE },
    bx_endless1: { lifeMs: 120 * MINUTE },
  };
  const infinite = fakeBoat(machines);
  for (const id of Object.keys(machines))
    await keepMachine(
      { id, client: infinite.client, log: () => undefined },
      { repository, form: 'main', signal: new AbortController().signal, records },
      () => undefined,
    );
  machines.bx_short001 = { lifeMs: 59 * MINUTE };
  machines.bx_endless1 = { lifeMs: null };
  infinite.commands.length = 0;
  // A record that is not one, beside them, is ignored.
  writeFileSync(join(records, 'unrelated--bx_other001.json'), JSON.stringify({ id: 'bx_other001' }));
  const lease = await acquire(infinite.client, records);
  expect(lease).toMatchObject({ machine: { id: 'bx_created' }, reused: false });
  expect(infinite.calls).toContain('POST /sandboxes');
  expect(infinite.calls).toContain('DELETE /sandboxes/bx_short001');
  expect(infinite.calls).toContain('DELETE /sandboxes/bx_endless1');
  expect(infinite.commands[0]).toContain("set -- 'record'");
  expect(readdirSync(records)).toEqual(['unrelated--bx_other001.json']);
});

test('a failed wipe deletes the machine, and the run keeps its result', async () => {
  const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
  const boat = fakeBoat({ bx_kept0001: { lifeMs: 120 * MINUTE } }, 1);
  const machine = { id: 'bx_kept0001', client: boat.client, log: () => undefined };
  const signal = new AbortController().signal;
  await expect(
    keepMachine(machine, { repository, form: 'main', signal, records }, () => undefined),
  ).rejects.toThrow(/^\/tmp still holds: run\.log $/);
  const code = await withMachine(
    machine,
    signal,
    async () => 3,
    () => keepMachine(machine, { repository, form: 'main', signal, records }, () => undefined),
  );
  expect(code).toBe(3);
  expect(boat.calls).toContain('DELETE /sandboxes/bx_kept0001');
  expect(readdirSync(records)).toEqual([]);
});

test('a Ctrl-C or a failed run deletes the machine instead of wiping it', async () => {
  const boat = fakeBoat({ bx_kept0001: { lifeMs: 120 * MINUTE } });
  const machine = { id: 'bx_kept0001', client: boat.client, log: () => undefined };
  let asked = 0;
  const keep = async () => {
    asked++;
    return true;
  };
  const interrupt = new AbortController();
  const stopped = await withMachine(
    machine,
    interrupt.signal,
    async () => {
      interrupt.abort();
      return 0;
    },
    keep,
  ).catch((error: unknown) => error);
  expect(stopped instanceof Error && stopped.name).toBe('AbortError');
  const failed = await withMachine(
    machine,
    new AbortController().signal,
    async () => {
      throw new Error('the upload failed');
    },
    keep,
  ).catch((error: unknown) => error);
  expect(failed instanceof Error && failed.message).toBe('the upload failed');
  expect(asked).toBe(0);
  expect(boat.calls.filter((call) => call.startsWith('DELETE'))).toHaveLength(2);
  // A run that returned a result keeps the machine: no deletion.
  boat.calls.length = 0;
  expect(await withMachine(machine, new AbortController().signal, async () => 0, keep)).toBe(0);
  expect(boat.calls.filter((call) => call.startsWith('DELETE'))).toEqual([]);
});

test('a run takes the kept machine with the most life, and deletes one whose reaper died, whatever its checkout', async () => {
  const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
  const machines: Record<string, { lifeMs: number | null }> = {
    bx_young001: { lifeMs: 150 * MINUTE },
    bx_older001: { lifeMs: 70 * MINUTE },
    bx_stale001: { lifeMs: 100 * MINUTE },
  };
  const boat = fakeBoat(machines);
  const paths: Record<string, string> = {};
  for (const id of Object.keys(machines))
    await keepMachine(
      { id, client: boat.client, log: () => undefined },
      { repository, form: 'main', signal: new AbortController().signal, records },
      (_repository, record) => {
        paths[id] = record;
      },
    );
  // Records are files; their age comes from the file system, so each is set relative to NOW.
  const at = (path: string | undefined, ageMs: number) =>
    utimesSync(path ?? '', new Date(NOW.getTime() - ageMs), new Date(NOW.getTime() - ageMs));
  at(paths.bx_young001, MINUTE);
  at(paths.bx_older001, 2 * MINUTE);
  // Its reaper died: the record outlived the 15-minute window.
  at(paths.bx_stale001, 16 * MINUTE);
  // Another checkout's record past its window goes too.
  writeFileSync(join(records, 'f00dfeedf00dfeed--x.json'), JSON.stringify({ id: 'bx_other001' }));
  at(join(records, 'f00dfeedf00dfeed--x.json'), 30 * MINUTE);
  boat.calls.length = 0;
  const lease = await acquire(boat.client, records);
  expect(lease).toMatchObject({ machine: { id: 'bx_young001' }, reused: true });
  expect(boat.calls.filter((call) => call.startsWith('DELETE')).sort()).toEqual([
    'DELETE /sandboxes/bx_older001',
    'DELETE /sandboxes/bx_other001',
    'DELETE /sandboxes/bx_stale001',
  ]);
  expect(readdirSync(records)).toEqual([]);
});

test('a Ctrl-C that arrives as the wipe ends deletes the machine and keeps no record', async () => {
  const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
  const interrupt = new AbortController();
  const boat = fakeBoat({ bx_kept0001: { lifeMs: 120 * MINUTE } }, 0, () => interrupt.abort());
  const machine = { id: 'bx_kept0001', client: boat.client, log: () => undefined };
  const reapers: string[] = [];
  const stopped = await withMachine(
    machine,
    interrupt.signal,
    async () => 0,
    () =>
      keepMachine(
        machine,
        { repository, form: 'main', signal: interrupt.signal, records },
        (_repository, record) => reapers.push(record),
      ),
  ).catch((error: unknown) => error);
  expect(stopped instanceof Error && stopped.name).toBe('AbortError');
  expect(boat.calls).toContain('DELETE /sandboxes/bx_kept0001');
  expect(reapers).toEqual([]);
  expect(readdirSync(records)).toEqual([]);
});

test('a Boat refusal while a run looks for its machine falls back instead of starting a new one', async () => {
  const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
  const keepOne = async (boat: ReturnType<typeof fakeBoat>) =>
    keepMachine(
      { id: 'bx_kept0001', client: boat.client, log: () => undefined },
      { repository, form: 'main', signal: new AbortController().signal, records },
      () => undefined,
    );
  // A refused listing.
  const listing = fakeBoat(
    { bx_kept0001: { lifeMs: 120 * MINUTE } },
    0,
    () => undefined,
    (call) => call.startsWith('GET /sandboxes?'),
  );
  await keepOne(listing);
  await expect(acquire(listing.client, records)).rejects.toThrow('500');
  // A refused read of the kept machine.
  const reading = fakeBoat({ bx_kept0001: { lifeMs: 120 * MINUTE } });
  await keepOne(reading);
  const refusedRead = fakeBoat(
    { bx_kept0001: { lifeMs: 120 * MINUTE } },
    0,
    () => undefined,
    (call) => call === 'GET /sandboxes/bx_kept0001',
  );
  await expect(acquire(refusedRead.client, records)).rejects.toThrow('500');
  // Neither starts a machine, and the kept machine whose record the run took is deleted, since its
  // reaper finds no record any more.
  for (const boat of [listing, refusedRead]) {
    expect(boat.calls).not.toContain('POST /sandboxes');
    expect(boat.calls).toContain('DELETE /sandboxes/bx_kept0001');
  }
  expect(readdirSync(records)).toEqual([]);
  // A machine Boat no longer knows is gone, not a failure: the run starts a new one.
  const gone = fakeBoat({ bx_kept0001: { lifeMs: 120 * MINUTE } });
  await keepOne(gone);
  const fresh = fakeBoat({});
  expect(await acquire(fresh.client, records)).toMatchObject({
    machine: { id: 'bx_created' },
    reused: false,
  });
});
