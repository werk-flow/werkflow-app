// Rule test: a state capture produces exactly its declared loading or error state.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACCEPTANCE_SETS } from '../../../tests/audit/support/acceptance-sets';
import {
  interceptsRequest,
  isTargetPrefetch,
  navigationStart,
  stateCapturePlan,
  stateCaptureId,
  type ObservedRequest,
} from '../../../tests/audit/support/acceptance-state-plan';

// AGENTS.md virtue 1 asks for the loading and error states of a changed
// screen, and the acceptance fixture once refused every busy or failed region,
// so no capture could show one (package S, item S3). A state capture holds or
// fails the requests that make the state; this file pins which requests those
// are, so a prefetch, a document load or another origin never turns into a
// state the capture did not ask for.

const ORIGIN = 'http://localhost:3000';
const TARGET = { origin: ORIGIN, path: '/auftraege' };

function request(method: string, path: string, headers: Record<string, string> = {}): ObservedRequest {
  return { method, url: `${ORIGIN}${path}`, headers };
}

const NAVIGATION = request('GET', '/auftraege?_rsc=abc', { rsc: '1', 'next-router-state-tree': '[]' });
const PREFETCH = request('GET', '/auftraege?_rsc=abc', {
  rsc: '1',
  'next-router-segment-prefetch': '/_tree',
});
const ACTION = request('POST', '/auftraege', { 'next-action': 'a1b2' });
const BACKGROUND_READ = request('GET', '/api/background-read?kind=project-capability-requirements');

test('a page loads behind its held navigation, fails through its failed reads, and a tab or dialog through its gesture', () => {
  expect(stateCapturePlan('loading', 'page')).toEqual({
    intercepts: ['navigation', 'reads'],
    response: 'hold',
    reach: 'client-navigation',
    shows: 'skeleton',
  });
  expect(stateCapturePlan('error', 'page')).toEqual({
    intercepts: ['reads'],
    response: 'abort',
    reach: 'page-load',
    shows: 'failed-region',
  });
  for (const view of ['tab', 'dialog'] as const) {
    expect(stateCapturePlan('loading', view)).toMatchObject({ intercepts: ['reads'], reach: 'gesture' });
    expect(stateCapturePlan('error', view)).toMatchObject({ response: 'abort', shows: 'failed-region' });
  }
});

test('a loading capture holds the navigation of its target and every client read, never a prefetch', () => {
  const plan = stateCapturePlan('loading', 'page');
  expect(interceptsRequest(plan, NAVIGATION, TARGET)).toBe('navigation');
  expect(interceptsRequest(plan, ACTION, TARGET)).toBe('reads');
  expect(interceptsRequest(plan, BACKGROUND_READ, TARGET)).toBe('reads');
  expect(interceptsRequest(plan, PREFETCH, TARGET)).toBeNull();
  expect(isTargetPrefetch(PREFETCH, TARGET)).toBe(true);
  expect(isTargetPrefetch(NAVIGATION, TARGET)).toBe(false);
  // The navigation of another route, the document load and the CSP report pass.
  expect(interceptsRequest(plan, request('GET', '/dashboard?_rsc=x', { rsc: '1' }), TARGET)).toBeNull();
  expect(interceptsRequest(plan, request('GET', '/auftraege'), TARGET)).toBeNull();
  expect(interceptsRequest(plan, request('GET', '/api/csp-report'), TARGET)).toBeNull();
});

test('an error capture fails only client reads of the app', () => {
  const plan = stateCapturePlan('error', 'page');
  expect(interceptsRequest(plan, ACTION, TARGET)).toBe('reads');
  expect(interceptsRequest(plan, NAVIGATION, TARGET)).toBeNull();
  const supabase = { ...BACKGROUND_READ, url: 'http://127.0.0.1:54321/rest/v1/jobs' };
  expect(interceptsRequest(plan, supabase, TARGET)).toBeNull();
  // A blank page has the opaque origin: armed there, the capture would intercept nothing (run 2026-10-23, dialogs).
  expect(interceptsRequest(plan, ACTION, { ...TARGET, origin: new URL('about:blank').origin })).toBeNull();
});

test('a loading capture starts on another route, and a state capture names its state', () => {
  expect(navigationStart('/auftraege')).toBe('/dashboard');
  expect(navigationStart('/dashboard')).toBe('/aufgaben');
  expect(stateCaptureId('admin-auftraege', 'loading')).toBe('admin-auftraege-loading');
});

test('every state capture of an open set names its state in its id', () => {
  const captures = ACCEPTANCE_SETS.flatMap((set) => set.captures);
  expect(captures.some((capture) => capture.state)).toBe(true);
  for (const capture of captures) if (capture.state) expect(capture.id).toEndWith(`-${capture.state}`);
});

test('probe: a settled capture still refuses a failed region, so only a declared state shows one', () => {
  const fixture = readFileSync(
    resolve(import.meta.dir, '../../../tests/audit/support/acceptance-captures.ts'),
    'utf8',
  );
  expect(fixture).toContain(
    `await expect(page.locator('[data-slot="section-error"]:visible')).toHaveCount(0);`,
  );
  expect(fixture).toContain('if (capture.state) {');
});
