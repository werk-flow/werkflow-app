import { expect, test } from 'bun:test';
import {
  backendDownBeforeGroupReason,
  backendHealthAfterFailureNote,
  backendHealthBeforeGroup,
  backendHealthProbes,
  backendHealthSchema,
  BACKEND_RECHECK_DELAY_MS,
  checkBackendHealth,
  type BackendHealth,
} from './backend-health';

type Answer = number | Error | 'hang';

function fakeFetch(answers: Record<string, Answer>): { fetcher: typeof fetch; requested: string[] } {
  const requested: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requested.push(`${init?.method ?? 'GET'} ${url}`);
    const answer = Object.entries(answers).find(([fragment]) => url.includes(fragment))?.[1] ?? 200;
    if (answer instanceof Error) throw answer;
    if (answer === 'hang')
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      );
    return new Response(null, { status: answer });
  }) as typeof fetch;
  return { fetcher, requested };
}

function probesWith(answers: Record<string, Answer>) {
  const fake = fakeFetch(answers);
  return {
    ...fake,
    probes: backendHealthProbes({
      appOrigin: 'http://localhost:3000',
      supabaseUrl: 'http://172.23.0.2:54321',
      publishableKey: 'sb_publishable_test',
      storageEndpoint: 'http://172.23.0.2:54321/storage/v1/s3',
      fetcher: fake.fetcher,
    }),
  };
}

test('a healthy path probes the application and the three backend services once each', async () => {
  const { probes, requested } = probesWith({ '/rest/v1/': 401, '/storage/': 403 });
  const health = await checkBackendHealth(probes);
  expect(backendHealthSchema.parse(health).healthy).toBe(true);
  expect(requested.sort()).toEqual([
    'GET http://172.23.0.2:54321/auth/v1/settings',
    'GET http://172.23.0.2:54321/rest/v1/profiles?select=id&limit=1',
    'GET http://localhost:3000/login',
    'HEAD http://172.23.0.2:54321/storage/v1/s3',
  ]);
  expect(backendHealthAfterFailureNote(health)).toBeUndefined();
});

test('a refused connection, a server error and a timeout each mark the path unhealthy with the cause', async () => {
  const { probes } = probesWith({
    'localhost:3000': new Error('connect ECONNREFUSED 127.0.0.1:3000'),
    '/rest/v1/': 503,
    '/auth/v1/': 'hang',
  });
  const health = await checkBackendHealth(probes, 20);
  expect(health.healthy).toBe(false);
  expect(health.probes.map((probe) => [probe.name, probe.ok])).toEqual([
    ['application server', false],
    ['Supabase Auth', false],
    ['Supabase data API', false],
    ['object storage', true],
  ]);
  const note = backendHealthAfterFailureNote(health);
  expect(note).toContain('application server (connect ECONNREFUSED 127.0.0.1:3000)');
  expect(note).toContain('Supabase data API (HTTP 503)');
  expect(note).toContain('Supabase Auth (no answer within 20 ms)');
  // The evidence suggests, it never classifies (P1-08 was a product defect an Auth transient exposed).
  expect(note).toContain('confirm it in the trace before you classify');
  expect(backendDownBeforeGroupReason(health)).toContain('so it did not start');
});

function health(healthy: boolean): BackendHealth {
  return {
    checkedAt: new Date().toISOString(),
    healthy,
    probes: [
      { name: 'Supabase Auth', ok: healthy, detail: healthy ? 'HTTP 200' : 'fetch failed', durationMs: 3 },
    ],
  };
}

test('a healthy backend before a group costs one check and no wait', async () => {
  const waits: number[] = [];
  let checks = 0;
  const result = await backendHealthBeforeGroup({
    check: async () => {
      checks += 1;
      return health(true);
    },
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });
  expect(result.healthy).toBe(true);
  expect(checks).toBe(1);
  expect(waits).toEqual([]);
});

test('an unhealthy first answer gets exactly one bounded recheck, which decides', async () => {
  for (const second of [true, false]) {
    const waits: number[] = [];
    const answers = [health(false), health(second)];
    let checks = 0;
    const result = await backendHealthBeforeGroup({
      check: async () => answers[checks++] ?? health(false),
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });
    expect(result.healthy).toBe(second);
    expect(checks).toBe(2);
    expect(waits).toEqual([BACKEND_RECHECK_DELAY_MS]);
  }
});
