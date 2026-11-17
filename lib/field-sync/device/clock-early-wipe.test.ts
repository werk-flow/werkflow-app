import 'fake-indexeddb/auto';

import { expect, setSystemTime, test } from 'bun:test';

import type { ClockDeviceView } from './time-outbox';
import {
  WORKER,
  capture,
  command,
  installTabLocks,
  keptIds,
  storage,
} from '@/lib/testing/fixtures/time-outbox';
import { TODAY_WIPE_KEY, sharedWipeGeneration } from './today-wipe';

// A wipe before this tab's clock outbox listens (werk-flow/werkflow-planning#407): another tab's
// sign-out while the outbox's code still loads reaches this tab by no storage event, so the
// attach compares the page's start signal itself. A wipe ends the module's hold for the rest of
// its process, so the file runs its test in a `bun test` process of its own.

const ISOLATED_FLAG = 'CLOCK_EARLY_WIPE_ISOLATED_RUN';

if (process.env[ISOLATED_FLAG] === '1') await isolatedTests();
else
  test('a wipe another tab gave before this tab’s outbox listened ends its hold', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      cwd: `${import.meta.dir}/../../..`,
      env: { ...process.env, [ISOLATED_FLAG]: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
  });

async function isolatedTests(): Promise<void> {
  Object.assign(globalThis, {
    window: { addEventListener: () => undefined, removeEventListener: () => undefined },
  });
  installTabLocks();
  setSystemTime(new Date('2026-11-11T12:00:00.000Z')); // The fixtures' day: a week on, they expire.

  const { clockHolder, holdClock } = await import('./clock-device');

  test('a wipe written between the page’s start and the outbox’s attach ends the hold, so the page never shows the person’s unsent events', async () => {
    const start = command('start');
    await capture(WORKER, start);
    const pageSignal = sharedWipeGeneration();
    // Another tab's sign-out while this tab's outbox code still loaded: no storage event reaches it.
    storage.set(TODAY_WIPE_KEY, 'signed-out-in-another-tab');
    const heard: { view: ClockDeviceView | null; holdEnded: boolean }[] = [];

    await holdClock(WORKER, (view, holdEnded = false) => heard.push({ view, holdEnded }), pageSignal);

    expect(heard).toEqual([{ view: null, holdEnded: true }]);
    expect(clockHolder()).toBeNull();
    // The event stays on the phone for the person's next page.
    expect(await keptIds(WORKER)).toEqual([start.operationId]);
  });
}
