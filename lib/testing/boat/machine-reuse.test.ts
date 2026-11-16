// Rule test: a checkout's consecutive Boat runs share one machine only after a wipe, never at once,
// and only while Boat would still stop and erase it by itself; every other machine of the checkout
// is deleted. Prevents a start per run (decision 15, werk-flow/werkflow-planning#294).
import { afterAll, beforeAll, expect, setSystemTime, test } from 'bun:test';
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from '../../zod';

import { BoatError, boatClient } from './boat-api';
import { MARK_IDLE, workstationLabel } from './machine-eviction';
import { acquireMachine, keepMachine, reapIdleMachine, withMachine } from './machine-reuse';

const repository = join(import.meta.dir, '../../..');
/** origin/main's wipe script as mainWipeScript would read it; a unit test fetches nothing. */
const wipeScript = () => '# the wipe script of origin/main\n';
const MINUTE = 60_000;
// Boat's auto-stop times below count from this instant.
const NOW = new Date('2026-11-09T12:00:00Z');
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());

/** A Boat stand-in: machines by id with their auto-stop, every call it got, and the commands it ran. */
function fakeBoat(
  /** Each machine's life left, or `archiveAfter` as Boat sends it when a test needs it verbatim. */
  machines: Record<
    string,
    {
      lifeMs: number | null;
      state?: string;
      archiveAfter?: string;
      /** Labels of another workstation's machine; a machine without them is listed for any checkout. */
      workstation?: string;
      checkout?: string;
    }
  >,
  /** Every command's exit code, or each one's by its script. */
  wipeExit: number | ((script: string) => number) = 0,
  /** Called as Boat reports a command finished; a test's interruption at that moment. */
  onExit: () => void = () => undefined,
  /** Calls Boat refuses with a 500, as `GET /sandboxes?…` or `GET /sandboxes/bx_…`. */
  refused: (call: string) => boolean = () => false,
  /** Answers to the next starts (`POST /sandboxes`) before Boat accepts them, as a 429 at a limit. */
  startRefusals: Response[] = [],
) {
  const calls: string[] = [];
  const commands: string[] = [];
  /** The labels of each start Boat accepted. */
  const labels: Record<string, string>[] = [];
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
        archiveAfter:
          machine?.archiveAfter ??
          (machine?.lifeMs == null ? null : new Date(NOW.getTime() + machine.lifeMs).toISOString()),
        labels: machine?.workstation ? { workstation: machine.workstation } : {},
      };
    };
    if (method === 'POST' && pathname.endsWith('/sandboxes')) {
      const refusal = startRefusals.shift();
      if (refusal) return refusal;
      machines.bx_created = { lifeMs: 180 * MINUTE };
      labels.push(
        z.object({ labels: z.record(z.string(), z.string()) }).parse(JSON.parse(String(init?.body))).labels,
      );
      return Response.json({ sandbox: { id: 'bx_created', state: 'provisioning' } });
    }
    if (method === 'POST' && pathname.endsWith('/commands') && !machines[id ?? ''])
      return Response.json({ code: 'not_found' }, { status: 404 });
    if (method === 'POST' && pathname.endsWith('/commands')) {
      // The script as bash reads it: runScript sends it as one quoted word after `bash -lc`.
      const { command } = z.object({ command: z.string() }).parse(JSON.parse(String(init?.body)));
      commands.push(command.slice("bash -lc '".length, -1).replaceAll(`'\\''`, "'"));
      return Response.json({ processId: 7 });
    }
    if (pathname.endsWith('/commands/7')) {
      onExit();
      const exitCode = typeof wipeExit === 'number' ? wipeExit : wipeExit(commands.at(-1) ?? '');
      return Response.json({
        status: 'exited',
        running: false,
        exitCode,
        stdout: exitCode ? 'a line without its newline' : '',
        // A failing wipe names its reason; the login shell may still print after it.
        stderr: exitCode
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
    if (pathname.endsWith('/sandboxes')) {
      const checkout = searchParams.getAll('label').find((label) => label.startsWith('checkout='));
      return Response.json({
        sandboxes: Object.keys(machines)
          .filter(
            (key) =>
              !checkout || !machines[key]?.checkout || checkout === `checkout=${machines[key].checkout}`,
          )
          .map(sandbox),
      });
    }
    if (id && machines[id]) return Response.json({ sandbox: sandbox(id) });
    return Response.json({ code: 'not_found' }, { status: 404 });
  });
  return { client, calls, commands, labels };
}

const acquire = (client: ReturnType<typeof boatClient>, records: string) =>
  acquireMachine(client, {
    repository,
    from: 'werkflow-verify',
    name: 'verify-test',
    log: () => undefined,
    signal: new AbortController().signal,
    records,
    wipeScript,
  });

test("a wiped machine serves the checkout's next run, and the run deletes every other machine of the checkout", async () => {
  const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
  const boat = fakeBoat({ bx_kept0001: { lifeMs: 120 * MINUTE }, bx_leftover: { lifeMs: 150 * MINUTE } });
  const reapers: string[] = [];
  const kept = await keepMachine(
    { id: 'bx_kept0001', client: boat.client, log: () => undefined },
    { repository, form: 'linked', signal: new AbortController().signal, records, wipeScript },
    (_repository, record) => reapers.push(record),
  );
  expect(kept).toBe(true);
  // The wipe runs as text: origin/main's script, never the checkout's file, with the checkout it
  // removes, and a passed wipe marks the machine idle.
  expect(boat.commands[0]).toBe(`set -- 'wipe' '${repository}' 'linked'\n${wipeScript()}${MARK_IDLE}`);
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
    { repository, form: 'main', signal: new AbortController().signal, records, wipeScript },
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
      { repository, form: 'main', signal: new AbortController().signal, records, wipeScript },
      () => undefined,
    );
  expect(await keep('bx_short001')).toBe('under an hour of its life left');
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
      { repository, form: 'main', signal: new AbortController().signal, records, wipeScript },
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
  const lines: string[] = [];
  const machine = { id: 'bx_kept0001', client: boat.client, log: (line: string) => lines.push(line) };
  const signal = new AbortController().signal;
  await expect(
    keepMachine(machine, { repository, form: 'main', signal, records, wipeScript }, () => undefined),
  ).rejects.toThrow(/^\/tmp still holds: run\.log $/);
  const code = await withMachine(
    machine,
    signal,
    async () => 3,
    () => keepMachine(machine, { repository, form: 'main', signal, records, wipeScript }, () => undefined),
  );
  expect(code).toBe(3);
  expect(boat.calls).toContain('DELETE /sandboxes/bx_kept0001');
  expect(readdirSync(records)).toEqual([]);
  // The run's last Boat line names why the machine went, so a run of deletions can be diagnosed.
  expect(lines.at(-1)).toBe(
    'Boat machine bx_kept0001 deleted: wipe failed: /tmp still holds: run.log ; 2 s of large, $0.0010.',
  );
});

test('a wipe script that cannot be read from origin/main deletes the machine, and starts none', async () => {
  const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
  const unreadable = () => {
    throw new Error("origin/main's wipe script cannot be read: fatal: unable to access the remote");
  };
  // After a run: no wipe runs, the machine is deleted and the last line says why.
  const boat = fakeBoat({ bx_kept0001: { lifeMs: 120 * MINUTE } });
  const lines: string[] = [];
  const machine = { id: 'bx_kept0001', client: boat.client, log: (line: string) => lines.push(line) };
  const signal = new AbortController().signal;
  await withMachine(
    machine,
    signal,
    async () => 0,
    () =>
      keepMachine(machine, { repository, form: 'main', signal, records, wipeScript: unreadable }, () => {
        throw new Error('no reaper starts for a machine that was not wiped');
      }),
  );
  expect(boat.commands).toEqual([]);
  expect(boat.calls).toContain('DELETE /sandboxes/bx_kept0001');
  expect(lines.at(-1)).toMatch(
    /^Boat machine bx_kept0001 deleted: wipe failed: origin\/main's wipe script cannot be read: fatal: /,
  );
  // Before a run: a new machine needs the script for its record, so the refusal comes before the start.
  const fresh = fakeBoat({});
  await expect(
    acquireMachine(fresh.client, {
      repository,
      from: 'werkflow-verify',
      name: 'verify-test',
      log: () => undefined,
      signal,
      records,
      wipeScript: unreadable,
    }),
  ).rejects.toThrow("origin/main's wipe script cannot be read");
  expect(fresh.calls).not.toContain('POST /sandboxes');
});

test('a run that ended without a result, or was interrupted, says so as its machine is deleted', async () => {
  const boat = fakeBoat({ bx_kept0001: { lifeMs: 120 * MINUTE } });
  const lines: string[] = [];
  const machine = { id: 'bx_kept0001', client: boat.client, log: (line: string) => lines.push(line) };
  await withMachine(
    machine,
    new AbortController().signal,
    async () => undefined,
    async () => 'no exit code',
  );
  expect(lines.at(-1)).toBe('Boat machine bx_kept0001 deleted: no exit code; 2 s of large, $0.0010.');
  await expect(
    withMachine(machine, new AbortController().signal, async () => {
      throw new Error('the upload failed');
    }),
  ).rejects.toThrow('the upload failed');
  expect(lines.at(-1)).toBe(
    'Boat machine bx_kept0001 deleted: the run ended without a result; 2 s of large, $0.0010.',
  );
  const interrupt = new AbortController();
  await expect(
    withMachine(machine, interrupt.signal, async () => {
      interrupt.abort();
      return 0;
    }),
  ).rejects.toThrow('aborted');
  expect(lines.at(-1)).toBe('Boat machine bx_kept0001 deleted: interrupted; 2 s of large, $0.0010.');
});

test('a Ctrl-C or a failed run deletes the machine instead of wiping it', async () => {
  const boat = fakeBoat({ bx_kept0001: { lifeMs: 120 * MINUTE } });
  const machine = { id: 'bx_kept0001', client: boat.client, log: () => undefined };
  let asked = 0;
  const keep = async (): Promise<true> => {
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
      { repository, form: 'main', signal: new AbortController().signal, records, wipeScript },
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
        { repository, form: 'main', signal: interrupt.signal, records, wipeScript },
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
      { repository, form: 'main', signal: new AbortController().signal, records, wipeScript },
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

test('a start refused at the machine limit evicts idle machines, oldest first, and starts once more', async () => {
  const atLimit = () => Response.json({ error: { code: 'member_limit_reached' } }, { status: 429 });
  const evicting = async (refusals: Response[], idle: Record<string, number>, taken: string[] = []) => {
    const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
    for (const [id, ageMinutes] of Object.entries(idle)) {
      const path = join(records, `f00dfeedf00dfeed--${id}.json`);
      writeFileSync(path, JSON.stringify({ id }));
      utimesSync(
        path,
        new Date(NOW.getTime() - ageMinutes * MINUTE),
        new Date(NOW.getTime() - ageMinutes * MINUTE),
      );
    }
    // A record a running run took is renamed away; its machine serves that run.
    for (const id of taken)
      writeFileSync(join(records, `f00dfeedf00dfeed--${id}.json.taken-run`), JSON.stringify({ id }));
    // The idle machines live on Boat under the other checkout their records name.
    const boat = fakeBoat(
      Object.fromEntries(
        Object.keys(idle).map((id) => [id, { lifeMs: 120 * MINUTE, checkout: 'f00dfeedf00dfeed' }]),
      ),
      0,
      () => undefined,
      () => false,
      refusals,
    );
    const outcome = await acquire(boat.client, records).catch((error: unknown) => error);
    const deleted = boat.calls
      .filter((call) => call.startsWith('DELETE'))
      .map((call) => call.slice('DELETE /sandboxes/'.length));
    return {
      outcome,
      deleted,
      starts: boat.calls.filter((call) => call === 'POST /sandboxes').length,
      records,
    };
  };
  // Idle machines of other checkouts go, oldest first, and the second start succeeds.
  const evicted = await evicting([atLimit()], { bx_newer001: 5, bx_older001: 10 }, ['bx_inuse001']);
  expect(evicted.outcome).toMatchObject({ machine: { id: 'bx_created' }, reused: false });
  expect(evicted.deleted).toEqual(['bx_older001', 'bx_newer001']);
  expect(evicted.starts).toBe(2);
  // The machine a running run took is never evicted.
  expect(readdirSync(evicted.records)).toEqual(['f00dfeedf00dfeed--bx_inuse001.json.taken-run']);
  // Without an idle machine, the refusal stands: the run reports Boat unavailable.
  const none = await evicting([atLimit()], {}, ['bx_inuse001']);
  expect(none.outcome instanceof BoatError && none.outcome.code).toBe('member_limit_reached');
  expect(none.deleted).toEqual([]);
  expect(none.starts).toBe(1);
  // A second refusal after the eviction stands too: one more start, not a loop.
  const twice = await evicting([atLimit(), atLimit()], { bx_older001: 10 });
  expect(twice.outcome instanceof BoatError && twice.outcome.code).toBe('member_limit_reached');
  expect(twice.starts).toBe(2);
  // Boat out of capacity is not a limit of ours: nothing is evicted.
  const capacity = await evicting([Response.json({ error: { code: 'out_of_capacity' } }, { status: 503 })], {
    bx_older001: 10,
  });
  expect(capacity.outcome instanceof BoatError && capacity.outcome.code).toBe('out_of_capacity');
  expect(capacity.deleted).toEqual([]);
});

test('a machine whose auto-stop time does not parse is neither wiped nor kept', async () => {
  const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
  const boat = fakeBoat({ bx_garbled1: { lifeMs: 120 * MINUTE, archiveAfter: 'not a date' } });
  const kept = await keepMachine(
    { id: 'bx_garbled1', client: boat.client, log: () => undefined },
    { repository, form: 'main', signal: new AbortController().signal, records, wipeScript },
    () => undefined,
  );
  // A run could never take it (acquireMachine needs a known hour of life), so it is deleted instead.
  expect(kept).toBe('under an hour of its life left');
  expect(boat.commands).toEqual([]);
  expect(readdirSync(records)).toEqual([]);
});

test("at the limit without an idle machine of its own, a run evicts another workstation's long-idle one", async () => {
  const atLimit = Response.json({ error: { code: 'member_limit_reached' } }, { status: 429 });
  const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
  const boat = fakeBoat(
    { bx_otherws1: { lifeMs: 120 * MINUTE, workstation: 'f00dfeedf00dfeed', checkout: 'deadbeefdeadbeef' } },
    0,
    () => undefined,
    () => false,
    [atLimit],
  );
  expect(await acquire(boat.client, records)).toMatchObject({ machine: { id: 'bx_created' }, reused: false });
  // The machine's own mark decided it: the eviction renamed it, then the run deleted the machine.
  expect(boat.commands[0]).toContain('-mmin +10');
  expect(boat.calls).toContain('DELETE /sandboxes/bx_otherws1');
  expect(boat.calls.filter((call) => call === 'POST /sandboxes')).toHaveLength(2);
  // The new machine carries its workstation beside its checkout, so the others can evict it too.
  expect(boat.labels).toHaveLength(1);
  expect(boat.labels[0]).toMatchObject({ workstation: workstationLabel(), purpose: 'werkflow-verify' });
  expect(boat.labels[0]?.checkout).toMatch(/^[0-9a-f]{16}$/);
});

test('a kept machine another workstation evicted meanwhile is not reused: the run starts a new one', async () => {
  const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
  const keeping = fakeBoat({ bx_kept0001: { lifeMs: 120 * MINUTE } });
  await keepMachine(
    { id: 'bx_kept0001', client: keeping.client, log: () => undefined },
    { repository, form: 'main', signal: new AbortController().signal, records, wipeScript },
    () => undefined,
  );
  // The wipe's command marks the machine idle only once the wipe passed.
  expect(keeping.commands[0]).toContain('sudo touch /var/lib/werkflow-pristine/idle');
  const lines: string[] = [];
  const evicted = fakeBoat({ bx_kept0001: { lifeMs: 120 * MINUTE } }, (script) =>
    script.includes('/taken') ? 1 : 0,
  );
  const lease = await acquireMachine(evicted.client, {
    repository,
    from: 'werkflow-verify',
    name: 'verify-test',
    log: (line) => lines.push(line),
    signal: new AbortController().signal,
    records,
    wipeScript,
  });
  expect(lease).toMatchObject({ machine: { id: 'bx_created' }, reused: false });
  expect(lines).toContain('Boat machine bx_kept0001 was taken by another workstation at the machine limit.');
});

test('a kept machine another workstation deleted between its read and its claim gives way to a new one', async () => {
  const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
  const machines: Record<string, { lifeMs: number | null }> = { bx_kept0001: { lifeMs: 120 * MINUTE } };
  const keeping = fakeBoat(machines);
  await keepMachine(
    { id: 'bx_kept0001', client: keeping.client, log: () => undefined },
    { repository, form: 'main', signal: new AbortController().signal, records, wipeScript },
    () => undefined,
  );
  // The evicting workstation deletes the machine right after this run read its life left.
  const raced = fakeBoat(
    machines,
    0,
    () => undefined,
    (call) => {
      if (call === 'POST /sandboxes/bx_kept0001/commands') Reflect.deleteProperty(machines, 'bx_kept0001');
      return false;
    },
  );
  expect(await acquire(raced.client, records)).toMatchObject({
    machine: { id: 'bx_created' },
    reused: false,
  });
});

test('an idle record whose machine another workstation evicted frees nothing, so the run evicts elsewhere', async () => {
  const atLimit = Response.json({ error: { code: 'member_limit_reached' } }, { status: 429 });
  const records = mkdtempSync(join(tmpdir(), 'boat-idle-'));
  // Another checkout's record on this workstation; its machine is already gone.
  writeFileSync(join(records, 'f00dfeedf00dfeed--gone.json'), JSON.stringify({ id: 'bx_gone0001' }));
  const boat = fakeBoat(
    { bx_otherws1: { lifeMs: 120 * MINUTE, workstation: 'f00dfeedf00dfeed', checkout: 'deadbeefdeadbeef' } },
    0,
    () => undefined,
    () => false,
    [atLimit],
  );
  expect(await acquire(boat.client, records)).toMatchObject({ machine: { id: 'bx_created' }, reused: false });
  expect(boat.calls).toContain('DELETE /sandboxes/bx_otherws1');
  expect(boat.calls).not.toContain('DELETE /sandboxes/bx_gone0001');
  expect(readdirSync(records)).toEqual([]);
});
