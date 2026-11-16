// Pins today's behavior of a session end on a phone without signal whose question code never
// loaded (decision record 0010, the time outbox's invariant 5 and the amendment "a session end asks
// about report drafts"): the service worker caches only the offline shell, so the question's lazy
// chunk cannot load, and the flow fails closed. The session stays and the person reads the
// check-failed sentence with its reload; nothing unsent is deleted or left unnamed. Closing the gap
// is werk-flow/werkflow-planning#407. The file spawns itself, so the module mock stays in the child.
import { expect, mock, test } from 'bun:test';

const FIXTURE_FLAG = 'SESSION_END_OFFLINE_CHECK_FIXTURE';

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
  Object.assign(globalThis, {
    window: {
      setTimeout: () => 1,
      setInterval: () => 2,
      clearTimeout: () => undefined,
      clearInterval: () => undefined,
    },
  });
  // A report draft waits on the phone: the device mark is set.
  values.set('werkflow:drafts-on-device', '1');
  // Without signal the question's chunk never arrives, as the browser rejects a dynamic import.
  void mock.module('@/components/shared/unsent-work-prompt', () => {
    throw new TypeError('Failed to fetch dynamically imported module');
  });
  const { endSessionAfterCheck } = await import('@/components/shared/unsent-work-gate');

  const failures: string[] = [];
  let ended = false;
  const answer = await endSessionAfterCheck(
    (message) => failures.push(message),
    async () => {
      ended = true;
    },
  );

  const expected =
    'Wir konnten nicht prüfen, ob auf diesem Gerät noch etwas nicht übertragen ist. Lade die Seite neu und versuche es dann erneut.';
  if (answer || ended || failures.length !== 1 || failures[0] !== expected)
    throw new Error(
      `expected a kept session and one check failure, got ${JSON.stringify({ answer, ended, failures })}`,
    );
  // The flow lifted its own barrier: the person keeps working on the phone.
  if ([...values.keys()].some((key) => key.startsWith('werkflow:session-ending:')))
    throw new Error('the session-end barrier stayed up');
  if (values.get('werkflow:drafts-on-device') !== '1') throw new Error('the draft mark went');
}

if (process.env[FIXTURE_FLAG] === '1')
  test('the session end, with its question code unreachable', runFixture);
else
  test('without signal and without the question code, a session end with an unsent draft keeps the session and says the check failed', async () => {
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
