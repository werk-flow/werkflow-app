// A session end whose barrier lapsed while its tab froze asks again before it ends the session
// (decision record 0010, the time outbox's invariant 5; Sol finding S25/F1): a heartbeat that renews
// the barrier after the lapse must not hide it, since another tab may have kept a clock action
// meanwhile. The check and the heartbeat's timers are replaced; the file spawns itself, so the
// module mock stays in the child.
import { expect, mock, setSystemTime, test } from 'bun:test';

const FIXTURE_FLAG = 'SESSION_END_BARRIER_LAPSE_FIXTURE';

async function runFixture(): Promise<void> {
  const values = new Map<string, string>();
  globalThis.localStorage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
  // The heartbeat's timers, fired by hand: the alignment timeout starts the interval and ticks once.
  let alignment: (() => void) | null = null;
  Object.assign(globalThis, {
    window: {
      setTimeout: (run: () => void) => {
        alignment = run;
        return 1;
      },
      setInterval: () => 2,
      clearTimeout: () => undefined,
      clearInterval: () => undefined,
    },
  });

  const checks: string[] = [];
  void mock.module('@/components/shared/unsent-work-prompt', () => ({
    settleUnsentWork: async () => {
      checks.push('check');
      if (checks.length === 1) {
        // The tab froze mid-check for eleven minutes: the barrier lapsed, then the heartbeat renewed it.
        setSystemTime(new Date('2026-11-11T07:11:00.000Z'));
        alignment?.();
      }
      return true;
    },
  }));
  const { endSessionAfterCheck } = await import('@/components/shared/unsent-work-gate');

  setSystemTime(new Date('2026-11-11T07:00:00.000Z'));
  let ended = false;
  await endSessionAfterCheck(
    () => undefined,
    async () => {
      ended = true;
    },
  );
  setSystemTime();

  if (checks.length !== 2 || !ended)
    throw new Error(`expected a second check before the end, got ${checks.length} check(s), ended ${ended}`);
}

if (process.env[FIXTURE_FLAG] === '1')
  test('the session end, with its check and timers replaced', runFixture);
else
  test('a session end asks again when its barrier lapsed during the check, even after a later renewal', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      cwd: `${import.meta.dir}/../..`,
      env: { ...process.env, [FIXTURE_FLAG]: '1' },
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
