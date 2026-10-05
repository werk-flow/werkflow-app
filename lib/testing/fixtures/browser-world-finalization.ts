import { expect, mock } from 'bun:test';
import { resolve } from 'node:path';

// Separate process: module replacements cannot leak into other unit tests.
const root = resolve(import.meta.dir, '../../..');
type State = { status: string; world: object | null; retainedAt: string | null; cleanedAt: string | null };
let state: State;
let events: string[] = [];
let cleanupFails = false;
let unreadable = false;
const world = { runId: 'owned-run', orgId: 'owned-org', outsider: { orgId: 'owned-outsider' } };

mock.module(resolve(root, 'tests/golden/support/env.ts'), () => ({ loadEnvLocal: () => {} }));
mock.module(resolve(root, 'tests/golden/support/world.ts'), () => ({
  loadWorld: () => {
    if (unreadable) throw new Error('Unreadable owned world');
    return world;
  },
}));
mock.module(resolve(root, 'tests/golden/support/seed.ts'), () => ({
  destroyTestWorld: async (owned: typeof world) => {
    expect(owned).toBe(world);
    events.push('destroy');
    if (cleanupFails) throw new Error('Partial cleanup');
  },
}));
mock.module(resolve(root, 'tests/golden/support/run-state.ts'), () => ({
  currentRunKey: () => 'owned-run',
  activeRunFailed: () => false, // The regression: only parent qualification fails.
  readRunManifest: () => state,
  updateRunManifest: (_key: string, patch: Partial<State> | ((current: State) => Partial<State>)) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    events.push('record');
    return state;
  },
  archiveActiveState: () => {
    events.push('archive');
  },
  markRunFailed: () => {
    events.push('failure');
  },
}));

const { default: archiveAfterPlaywright, finalizeQualifiedWorld } = await import(
  '../../../tests/golden/global-teardown'
);
for (const result of [
  'passed',
  'failed',
  'interrupted',
  'running',
  'diagnostic_passed',
  'cleanup-failed',
  'unreadable',
]) {
  delete process.env.WERKFLOW_REUSE_RUN_KEY;
  delete process.env.KEEP_WORLD;
  events = [];
  cleanupFails = result === 'cleanup-failed';
  unreadable = result === 'unreadable';
  state = { status: 'passed', world, retainedAt: null, cleanedAt: null };
  await archiveAfterPlaywright();
  expect(events).not.toContain('destroy');
  expect(state.retainedAt).not.toBeNull();
  // The reporter can pass before the parent finds invalid or slow evidence.
  state.status = ['cleanup-failed', 'unreadable'].includes(result) ? 'passed' : result;
  if (result === 'diagnostic_passed') process.env.WERKFLOW_REUSE_RUN_KEY = 'source';
  if (cleanupFails || unreadable) await expect(finalizeQualifiedWorld()).rejects.toThrow();
  else await finalizeQualifiedWorld();
  if (result === 'passed') {
    expect(events.filter((event) => event === 'destroy')).toHaveLength(1);
    expect(state.cleanedAt).not.toBeNull();
    expect(state.retainedAt).toBeNull();
  } else {
    if (!cleanupFails) expect(events).not.toContain('destroy');
    expect(state.cleanedAt).toBeNull();
    expect(state.retainedAt).not.toBeNull();
  }
}
delete process.env.WERKFLOW_REUSE_RUN_KEY;
state = { status: 'passed', world, retainedAt: null, cleanedAt: null };
events = [];
unreadable = false;
process.env.KEEP_WORLD = '1';
await archiveAfterPlaywright();
await finalizeQualifiedWorld();
expect(events).not.toContain('destroy');
expect(state.retainedAt).not.toBeNull();
