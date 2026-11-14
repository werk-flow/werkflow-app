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
const { captureUsage, carriesOnlyAllowedProperties } = await import('./capture');

type SentRequest = { url: string; body: unknown };
let sent: SentRequest[] = [];
const originalFetch = globalThis.fetch;
const environment = { ...process.env };

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
  process.env = { ...environment };
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

test('the guard refuses every property that could point to a person, a record or content', () => {
  const base = { workflow: 'request', step: 'started', $process_person_profile: false, $geoip_disable: true };
  expect(carriesOnlyAllowedProperties(base)).toBe(true);
  for (const forbidden of [
    'user_id',
    'userId',
    'email',
    'name',
    'role',
    'job_id',
    'record_id',
    'customer',
    'content',
    '$ip',
    '$set',
    '$current_url',
  ]) {
    expect(carriesOnlyAllowedProperties({ ...base, [forbidden]: 'x' })).toBe(false);
  }
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
