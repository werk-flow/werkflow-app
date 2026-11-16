import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listProductSources, repositoryRoot } from '@/lib/conventions/product-sources';

// Synthetic ids only: an allowed organization, and one standing in for a
// customer whose AVV is not signed yet.
const ALLOWED_ORG = '0a000001-0000-0000-0000-000000000001';
const UNSIGNED_ORG = '0a000002-0000-0000-0000-000000000002';
const TEST_KEY = 'phc_synthetic_test_key';

mock.module('server-only', () => ({}));
// Runs the deferred send at once, so the test sees what would leave the server.
const deferred: Array<() => Promise<void>> = [];
mock.module('next/server', () => ({ after: (task: () => Promise<void>) => deferred.push(task) }));
const { captureUsage } = await import('./capture');

type SentRequest = { url: string; body: unknown };
let sent: SentRequest[] = [];
const originalFetch = globalThis.fetch;
const CAPTURE_VARIABLES = ['POSTHOG_PROJECT_API_KEY', 'POSTHOG_ORGANIZATION_IDS'] as const;
const environment = CAPTURE_VARIABLES.map((name) => [name, process.env[name]] as const);

async function flush(): Promise<void> {
  for (const task of deferred.splice(0)) await task();
}

beforeEach(() => {
  sent = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: 200 });
    },
    { preconnect: originalFetch.preconnect },
  );
  process.env.POSTHOG_PROJECT_API_KEY = TEST_KEY;
  process.env.POSTHOG_ORGANIZATION_IDS = ` ${ALLOWED_ORG} , not-an-id`;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  // Only the keys this file sets: replacing process.env would cut later tests' TZ off the runtime.
  for (const [name, value] of environment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('an event names workflow and step, keyed by the organization, with no person and no location', async () => {
  captureUsage(ALLOWED_ORG, 'work_evidence', 'completed');
  await flush();
  expect(sent).toEqual([
    {
      url: 'https://eu.i.posthog.com/i/v0/e/',
      body: {
        api_key: TEST_KEY,
        event: 'work_evidence_completed',
        distinct_id: ALLOWED_ORG,
        properties: {
          workflow: 'work_evidence',
          step: 'completed',
          $process_person_profile: false,
          $geoip_disable: true,
        },
      },
    },
  ]);
});

test('no project key sends nothing', async () => {
  delete process.env.POSTHOG_PROJECT_API_KEY;
  captureUsage(ALLOWED_ORG, 'time_recording', 'started');
  await flush();
  expect(sent).toEqual([]);
});

test('an organization outside the allowlist, such as one whose AVV is unsigned, sends nothing', async () => {
  captureUsage(UNSIGNED_ORG, 'time_recording', 'started');
  delete process.env.POSTHOG_ORGANIZATION_IDS;
  captureUsage(ALLOWED_ORG, 'time_recording', 'started');
  await flush();
  expect(sent).toEqual([]);
});

// Rule test: an event carries only these keys; any new property, such as a person, a role,
// a record id or content, fails here first.
test('every event of every workflow carries no property beyond workflow and step', async () => {
  const workflows = [
    'work_evidence',
    'time_recording',
    'follow_up',
    'request',
    'handover',
    'maintenance_visit',
    'blocker',
  ] as const;
  const expected: SentRequest[] = [];
  for (const workflow of workflows) {
    for (const step of ['started', 'completed', 'abandoned'] as const) {
      captureUsage(ALLOWED_ORG, workflow, step);
      const properties = { workflow, step, $process_person_profile: false, $geoip_disable: true };
      const body = { api_key: TEST_KEY, event: `${workflow}_${step}`, distinct_id: ALLOWED_ORG, properties };
      expected.push({ url: 'https://eu.i.posthog.com/i/v0/e/', body });
    }
  }
  await flush();
  expect(sent).toEqual(expected);
});

test('a failed send is logged and never throws into the workflow step', async () => {
  globalThis.fetch = Object.assign(
    async () => {
      throw new Error('network down');
    },
    { preconnect: originalFetch.preconnect },
  );
  captureUsage(ALLOWED_ORG, 'blocker', 'completed');
  expect(await flush()).toBeUndefined();
});

// Rule test: PostHog is reached only through this module, so no event bypasses the guard.
test('no other product source names PostHog', () => {
  const offenders = listProductSources().filter(
    (file) =>
      file !== 'lib/usage-statistics/capture.ts' &&
      /posthog/i.test(readFileSync(resolve(repositoryRoot, file), 'utf8')),
  );
  expect(offenders).toEqual([]);
});
