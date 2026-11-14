// Rule test: a lead starts a thread on its own machine only while the machine has room for it
// (lib/testing/runner/child-start.ts); a thread placed on another machine passes.
import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { childStartRefusal, localThreadStarts, thisEnvironmentId } from './child-start';
import { admission, type Admission, type RoomReading } from './machine-room';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const GIB = 1024 ** 3;
const MAC = 'environment:mac-studio';
// This machine's own environment id, as the hook reads it from T3's data directory.
const HERE = 'environment:pc';

// PreToolUse payloads in the shape both agent tools send (`tool_name`, `tool_input`, `cwd`), with the
// arguments of T3 Code's own tool schemas. Claude names the server `t3-code`, Codex `t3_code`.
const payload = (tool_name: string, tool_input: unknown) => ({
  session_id: 'a1',
  hook_event_name: 'PreToolUse',
  cwd: repositoryRoot,
  tool_name,
  tool_input,
});
const delegate = (target?: object) =>
  payload('mcp__t3-code__delegate_task', {
    task: 'Build the thing.',
    title: 'Build',
    role: 'implementation',
    isolation: 'worktree',
    ...(target && { target }),
  });
const launch = (environmentId?: string) =>
  payload('mcp__t3_code__t3_thread_launch', {
    title: 'Review',
    message: 'Review the PR.',
    workspaceStrategy: { type: 'worktree', baseRef: 'origin/main', startFromOrigin: true },
    delegatedFrom: { environmentId: HERE, threadId: 't1', title: 'Lead' },
    ...(environmentId && { environmentId }),
  });
const create = (...targets: (object | undefined)[]) =>
  payload('mcp__t3-code__create_threads', {
    threads: targets.map((target, index) => ({
      title: `Thread ${index}`,
      prompt: 'Go.',
      ...(target && { target }),
    })),
  });

type Call = { tool_name: string; tool_input: unknown };
const starts = (call: Call) => localThreadStarts(call.tool_name, call.tool_input, HERE);
const startsWithoutIdentity = (call: Call) => localThreadStarts(call.tool_name, call.tool_input, undefined);

test('a thread starts on this machine unless the call names an environment for it', () => {
  expect(starts(delegate())).toBe(1);
  expect(starts(delegate({ model: 'claude-opus-5-5' }))).toBe(1);
  expect(starts(delegate({ model: 'claude-opus-5-5', environmentId: MAC }))).toBe(0);
  expect(starts(launch())).toBe(1);
  // `delegatedFrom.environmentId` names where the thread comes from, not where it runs.
  expect(starts(launch(MAC))).toBe(0);
  expect(starts(create(undefined, { environmentId: MAC }, { model: 'claude-fable-5-2' }))).toBe(2);
  expect(starts(create({ environmentId: MAC }))).toBe(0);
  // Both server names, and no other T3 tool.
  expect(starts(payload('mcp__t3_code__delegate_task', { task: 'x' }))).toBe(1);
  for (const tool of [
    'mcp__t3-code__t3_thread_send',
    'mcp__t3-code__task_status',
    'Bash',
    'Agent',
    'spawn_agent',
    7,
  ])
    expect(starts(payload(String(tool), {}))).toBeUndefined();
  // An input the guard cannot read is a local start, never a pass.
  expect(starts(payload('mcp__t3-code__create_threads', { threads: 'many' }))).toBe(1);
  expect(starts(payload('mcp__t3-code__delegate_task', null))).toBe(1);
});

const pc = (available: number, blocked: string | null = null): RoomReading => ({
  room: {
    available: available * GIB,
    floor: 1.56 * GIB,
    blocked,
    alerted: false,
    load: 2,
    cores: 14,
    normalLoad: 21,
  },
});
const measured =
  (reading: RoomReading, heavy: readonly number[] = []) =>
  (threads: number): Admission =>
    admission('thread', reading, heavy, threads);

test('a local start without room is refused with the numbers and the two ways on', () => {
  const reason = childStartRefusal(delegate(), measured(pc(5)), HERE);
  expect(reason).toStartWith(
    'Refused: this machine has no room to start a thread. 5.0 GiB available plus 0.0 held',
  );
  expect(reason).toContain(
    'a thread needs 6.1: the floor of 1.6, 4.0 for a check:changed and 0.5 for each agent.',
  );
  expect(reason).toContain('`t3_environment_links` lists them, then pass `target.environmentId`');
  expect(reason).toContain('run `bun run room --wait thread`');
  expect(childStartRefusal(launch(), measured(pc(5)), HERE)).toBeDefined();
  expect(
    childStartRefusal(
      delegate(),
      measured(pc(14, 'the 5-minute load is 40.0 on 14 cores, above 35.0')),
      HERE,
    ),
  ).toContain('This machine takes no start now: the 5-minute load is 40.0 on 14 cores, above 35.0.');
});

test('a local start above the load line is refused however much memory is free, and passes below it', () => {
  // The VM on 2026-11-14: 15-minute load 29 on 16 cores, 19 GiB available.
  const vm = (load: number): RoomReading => ({
    room: {
      available: 19 * GIB,
      floor: 3.2 * GIB,
      blocked: null,
      alerted: false,
      load,
      cores: 16,
      normalLoad: 24,
    },
  });
  const reason = childStartRefusal(delegate(), measured(vm(29)), HERE);
  expect(reason).toStartWith('Refused: this machine has no room to start a thread. 19.0 GiB available');
  expect(reason).toContain(
    "The 15-minute load is 29.0 on 16 cores; a thread needs it under 24.0, the load watch's normal line.",
  );
  expect(reason).toContain('`t3_environment_links` lists them, then pass `target.environmentId`');
  expect(reason).toContain('run `bun run room --wait thread`');
  expect(childStartRefusal(delegate(), measured(vm(14)), HERE)).toBeUndefined();
  expect(childStartRefusal(delegate({ environmentId: MAC }), measured(vm(55)), HERE)).toBeUndefined();
});

test('a start with room passes, and so does every thread placed on another machine', () => {
  expect(childStartRefusal(delegate(), measured(pc(6.1)), HERE)).toBeUndefined();
  expect(childStartRefusal(launch(), measured(pc(6.1)), HERE)).toBeUndefined();
  const never = (): Admission => {
    throw new Error('A thread placed elsewhere is never measured here.');
  };
  expect(childStartRefusal(delegate({ environmentId: MAC }), never, HERE)).toBeUndefined();
  expect(childStartRefusal(launch(MAC), never, HERE)).toBeUndefined();
  expect(
    childStartRefusal(create({ environmentId: MAC }, { environmentId: MAC }), never, HERE),
  ).toBeUndefined();
  expect(
    childStartRefusal(payload('mcp__t3-code__t3_thread_send', { threadId: 't', message: 'm' }), never, HERE),
  ).toBeUndefined();
});

// T3 runs a call that names this machine's own environment here (its PeerForwarding routes only another id away).
test("a call naming this machine's environment is measured, another machine's passes, and an unknown identity measures every one", () => {
  expect(starts(delegate({ environmentId: HERE }))).toBe(1);
  expect(starts(launch(HERE))).toBe(1);
  expect(starts(create({ environmentId: HERE }, { environmentId: MAC }))).toBe(1);
  expect(childStartRefusal(delegate({ environmentId: HERE }), measured(pc(5)), HERE)).toContain(
    'no room to start a thread',
  );
  // Without its own id the guard cannot tell another machine from this one, so it measures.
  expect(startsWithoutIdentity(delegate({ environmentId: MAC }))).toBe(1);
  expect(startsWithoutIdentity(launch(MAC))).toBe(1);
  expect(startsWithoutIdentity(create({ environmentId: MAC }, { environmentId: MAC }))).toBe(2);
  expect(childStartRefusal(delegate({ environmentId: MAC }), measured(pc(5)), undefined)).toContain(
    'no room to start a thread',
  );
});

test('several threads in one call each cost an agent', () => {
  // 7 GiB fits two threads (6.56 needed) and not four (7.56).
  expect(childStartRefusal(create(undefined, undefined), measured(pc(7)), HERE)).toBeUndefined();
  const reason = childStartRefusal(create(undefined, undefined, undefined, undefined), measured(pc(7)), HERE);
  expect(reason).toContain('no room to start 4 threads');
  expect(reason).toContain('4 threads need 7.6');
  expect(reason).toEndWith('Several threads fit sooner one at a time.');
  // Only the local ones count: three of these four go to the Mac.
  expect(
    childStartRefusal(
      create(undefined, { environmentId: MAC }, { environmentId: MAC }, { environmentId: MAC }),
      measured(pc(7)),
      HERE,
    ),
  ).toBeUndefined();
});

// The hook runs only before a thread start, so a payload it cannot read may be one.
test('a payload that names no tool is refused, whatever the machine has', () => {
  const roomy = measured(pc(14));
  for (const call of [
    {},
    [],
    null,
    undefined,
    'delegate_task',
    { tool_input: { task: 'x' } },
    { tool_name: 7 },
    { tool_name: '' },
    { tool_name: null, tool_input: {} },
  ])
    expect([JSON.stringify(call), childStartRefusal(call, roomy, HERE)]).toEqual([
      JSON.stringify(call),
      'Refused: the child-start guard could not read the tool call, so it cannot tell whether this machine has room.',
    ]);
  // A named tool that starts no thread passes: the wiring test keeps the hook off such calls anyway.
  expect(
    childStartRefusal({ tool_name: 'mcp__t3-code__task_status', tool_input: {} }, roomy, HERE),
  ).toBeUndefined();
});

test('a machine without the load watch starts no local thread and names the install', () => {
  const unwatched: RoomReading = {
    unwatched: 'no load watch at /nowhere',
    fix: 'Install the load watch: run X.',
  };
  const reason = childStartRefusal(delegate(), measured(unwatched), HERE);
  expect(reason).toStartWith(
    "Refused: this machine cannot start a thread. This machine's memory is not measured: no load watch at /nowhere. Install the load watch: run X.",
  );
  expect(reason).toContain('Until then, place it on a linked machine');
  // Waiting would never end there.
  expect(reason).not.toContain('--wait');
});

const scratch = mkdtempSync(join(tmpdir(), 'werkflow-child-start-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("this machine's environment id is the T3 data directory's environment-id file, and a missing or empty one is unknown", () => {
  const home = join(scratch, 't3-home');
  mkdirSync(join(home, 'userdata'), { recursive: true });
  writeFileSync(join(home, 'userdata', 'environment-id'), `${HERE}\n`);
  expect(thisEnvironmentId({ T3CODE_HOME: home })).toBe(HERE);
  expect(thisEnvironmentId({ T3CODE_HOME: join(scratch, 'no-t3-home') })).toBeUndefined();
  const empty = join(scratch, 't3-empty');
  mkdirSync(join(empty, 'userdata'), { recursive: true });
  writeFileSync(join(empty, 'userdata', 'environment-id'), '\n');
  expect(thisEnvironmentId({ T3CODE_HOME: empty })).toBeUndefined();
});

test('the hook refuses a local start without room or without a reading, and passes one with room or placed elsewhere', () => {
  // The stub names its own normal line, so the machine's real load never decides: 1000 per core
  // admits any load, 0 refuses every one.
  const watch = (name: string, available: number, normalPerCore = 1000): string => {
    const script = join(scratch, `${name}.py`);
    writeFileSync(
      script,
      `CLEAR_LOAD_PER_CORE = ${normalPerCore}\nprint('{"available": ${available * GIB}, "floor": ${1.56 * GIB}, "blocked": null, "alerted": false, "watching": true}')\n`,
    );
    return script;
  };
  const t3Home = join(scratch, 'hook-t3-home');
  mkdirSync(join(t3Home, 'userdata'), { recursive: true });
  writeFileSync(join(t3Home, 'userdata', 'environment-id'), HERE);
  const run = (input: string, loadWatch: string, home = t3Home) =>
    spawnSync(
      process.execPath,
      [resolve(repositoryRoot, '.claude/hooks/refuse-child-start-without-room.ts')],
      {
        input,
        encoding: 'utf8',
        env: {
          ...process.env,
          WERKFLOW_LOAD_WATCH: loadWatch,
          WERKFLOW_HEAVY_SLOT_DIR: join(scratch, 'slots'),
          T3CODE_HOME: home,
        },
      },
    );
  const full = watch('full', 3);
  const roomy = watch('roomy', 12);
  const busy = watch('busy', 12, 0);
  const absent = join(scratch, 'absent.py');

  const refused = run(JSON.stringify(delegate()), full);
  expect(refused.status).toBe(2);
  expect(refused.stderr).toContain('Refused: this machine has no room to start a thread. 3.0 GiB available');
  expect(run(JSON.stringify(delegate()), roomy).status).toBe(0);
  expect(run(JSON.stringify(create(undefined, undefined)), roomy).status).toBe(0);
  expect(run(JSON.stringify(delegate({ environmentId: MAC })), full).status).toBe(0);
  expect(run(JSON.stringify(delegate({ environmentId: HERE })), full).status).toBe(2);
  // Without this machine's id, a start named for the Mac is measured here too.
  expect(
    run(JSON.stringify(delegate({ environmentId: MAC })), full, join(scratch, 'no-t3-home')).status,
  ).toBe(2);
  expect(
    run(JSON.stringify(delegate({ environmentId: MAC })), roomy, join(scratch, 'no-t3-home')).status,
  ).toBe(0);
  const loaded = run(JSON.stringify(delegate()), busy);
  expect(loaded.status).toBe(2);
  expect(loaded.stderr).toContain("a thread needs it under 0.0, the load watch's normal line.");
  expect(run(JSON.stringify(delegate({ environmentId: MAC })), busy).status).toBe(0);

  const unwatched = run(JSON.stringify(launch()), absent);
  expect(unwatched.status).toBe(2);
  expect(unwatched.stderr).toContain("This machine's memory is not measured");
  expect(run(JSON.stringify(launch(MAC)), absent).status).toBe(0);

  for (const unreadable of ['not json', '{}', '[]', '{"tool_input":{"task":"x"}}', '{"tool_name":7}']) {
    const refusedCall = run(unreadable, roomy);
    expect([unreadable, refusedCall.status]).toEqual([unreadable, 2]);
    expect(refusedCall.stderr).toContain('could not read the tool call');
  }
});
