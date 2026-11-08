import { afterEach, expect, spyOn, test } from 'bun:test';
import { logError } from './logging';

const consoleError = spyOn(console, 'error').mockImplementation(() => {});

// `metric()` from @vercel/functions hands each data point to the Vercel runtime through this
// global; outside Vercel it is absent and the call does nothing. Installing it here runs the
// real package call, so the test sees exactly what would leave the function.
const VERCEL_RUNTIME_IPC = Symbol.for('@vercel/rusty-runtime-ipc');
type SentMetric = [name: string, value: number, tags: Record<string, string> | undefined];
let sentMetrics: SentMetric[] = [];

function installVercelRuntime(sendMetric: (...metric: SentMetric) => void) {
  Reflect.set(globalThis, VERCEL_RUNTIME_IPC, { sendMetric });
}

afterEach(() => {
  consoleError.mockClear();
  Reflect.deleteProperty(globalThis, VERCEL_RUNTIME_IPC);
  sentMetrics = [];
});

function logged(error: unknown): unknown {
  logError('label', error);
  return consoleError.mock.calls.at(-1)?.[1];
}

function countedTags(label: string, error?: unknown): Record<string, string> | undefined {
  sentMetrics = [];
  installVercelRuntime((...metric) => sentMetrics.push(metric));
  logError(label, error);
  expect(sentMetrics).toHaveLength(1);
  expect(sentMetrics[0]?.slice(0, 2)).toEqual(['werkflow.failure', 1]);
  return sentMetrics[0]?.[2];
}

test('a Postgres or provider error is logged by name, code and status only', () => {
  const postgresError = {
    name: 'PostgrestError',
    code: '23505',
    message: 'duplicate key value violates unique constraint, Key (email)=(max@example.test)',
    details: 'Key (email)=(max@example.test) already exists.',
    hint: null,
    status: 409,
  };
  expect(logged(postgresError)).toEqual({ name: 'PostgrestError', code: '23505', status: 409 });
  const thrown = Object.assign(new Error('fetch failed for https://x.test/?email=max@example.test'), {
    code: 'ECONNRESET',
  });
  expect(logged(thrown)).toEqual({ name: 'Error', code: 'ECONNRESET' });
});

test('free text never reaches the log, while a stable code does', () => {
  expect(logged('time_correction_not_found')).toEqual({ code: 'time_correction_not_found' });
  expect(logged('Benutzer max@example.test nicht gefunden')).toEqual({ name: 'string' });
  expect(logged({ code: 'x'.repeat(200), name: 'contains spaces and @' })).toEqual({});
  expect(logged(undefined)).toEqual({});
  expect(logged(42)).toEqual({ name: 'number' });
});

test('a logged failure counts once as werkflow.failure with its label and code only', () => {
  const postgresError = {
    name: 'PostgrestError',
    code: '23505',
    message: 'Key (email)=(max@example.test) already exists.',
    status: 409,
  };
  expect(countedTags('createClient: insert failed', postgresError)).toEqual({
    label: 'createClient_insert_failed',
    code: '23505',
  });
  expect(countedTags('auth.flash.store_failed')).toEqual({ label: 'auth.flash.store_failed', code: 'none' });
});

test('a label or code with personal data or an unsupported character never reaches the metric', () => {
  // Personal data or a link withholds the whole value; a character replacement would keep it.
  expect(countedTags('invite: mail to max@example.test failed', 'max.mustermann@example.test')).toEqual({
    label: 'withheld',
    code: 'none',
  });
  expect(countedTags('reset: https://app.test/reset?token=abc failed', 'PGRST116')).toEqual({
    label: 'withheld',
    code: 'PGRST116',
  });
  expect(countedTags('call 015112345678 failed', '015112345678')).toEqual({
    label: 'withheld',
    code: 'withheld',
  });
  expect(
    countedTags('job 3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b failed', '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'),
  ).toEqual({
    label: 'withheld',
    code: 'withheld',
  });
  // Every remaining value matches Vercel's tag rule: 1 to 63 bytes of A-Z a-z 0-9 - _ . /
  const long = countedTags(`Größe ${'überschritten '.repeat(10)}`, 'auth:session_missing');
  expect(long?.code).toBe('auth_session_missing');
  expect(long?.label).toMatch(/^[A-Za-z0-9_./-]{1,63}$/);
  expect(long?.label).toStartWith('Gr_e_berschritten_');
  expect(countedTags('::', '')).toEqual({ label: 'none', code: 'none' });
});

test('a failing or absent Vercel runtime changes nothing for the caller', () => {
  logError('createClient: insert failed', { code: '23505' });
  expect(consoleError.mock.calls.at(-1)).toEqual(['createClient: insert failed', { code: '23505' }]);

  installVercelRuntime(() => {
    throw new Error('ipc closed');
  });
  expect(() => logError('createClient: insert failed', { code: '23505' })).not.toThrow();
  expect(consoleError.mock.calls.slice(1)).toEqual([
    ['createClient: insert failed', { code: '23505' }],
    ['logError: failure metric not recorded', { name: 'Error' }],
  ]);
});
