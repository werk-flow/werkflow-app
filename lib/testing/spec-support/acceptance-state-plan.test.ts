// Rule test: a state capture produces exactly its declared loading or error state.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INVENTORY_ROUNDS } from '../../../tests/audit/support/acceptance-rounds';
import { acceptanceSets } from '../../../tests/audit/support/acceptance-sets';
import {
  interceptsRequest,
  isRouteLoad,
  isTargetPrefetch,
  navigationStart,
  standaloneTarget,
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

test('a dialog over a failed page forces no failure and proves the one behind it', () => {
  const plan = stateCapturePlan('error', 'dialog-over-failed-page');
  expect(plan).toMatchObject({ reach: 'gesture', shows: 'failed-region-behind' });
  expect(interceptsRequest(plan, ACTION, TARGET)).toBeNull();
  expect(interceptsRequest(plan, BACKGROUND_READ, TARGET)).toBeNull();
  expect(() => stateCapturePlan('loading', 'dialog-over-failed-page')).toThrow();
});

test('every inventory dialog over a failed page is captured in its error state', () => {
  const dialogs = INVENTORY_ROUNDS.flatMap((round) => round.captures).filter(
    (capture) => capture.view.kind === 'dialog' && capture.view.overFailedPage,
  );
  expect(dialogs.length).toBeGreaterThan(0);
  for (const capture of dialogs) {
    expect(capture.state).toBe('error');
    expect(capture.id).toEndWith('-error');
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
  // Any prefetch of the app holds the push, the target's or another route's, and so does
  // every script chunk of the app, such as the one the prefetched loading boundary imports.
  // A navigation, a read, a stylesheet and another origin do not.
  expect(isRouteLoad(PREFETCH, ORIGIN)).toBe(true);
  expect(isRouteLoad({ ...PREFETCH, url: `${ORIGIN}/service/bereitschaft?_rsc=p` }, ORIGIN)).toBe(true);
  expect(isRouteLoad(request('GET', '/_next/static/chunks/1ayzboy3p4vqq.js'), ORIGIN)).toBe(true);
  expect(isRouteLoad(NAVIGATION, ORIGIN)).toBe(false);
  expect(isRouteLoad(BACKGROUND_READ, ORIGIN)).toBe(false);
  expect(isRouteLoad(request('GET', '/_next/static/chunks/361w87mea3yxc.css'), ORIGIN)).toBe(false);
  expect(isRouteLoad({ ...PREFETCH, url: 'https://other.example/auftraege?_rsc=p' }, ORIGIN)).toBe(false);
  expect(
    isRouteLoad(
      { method: 'GET', url: 'https://other.example/_next/static/chunks/a.js', headers: {} },
      ORIGIN,
    ),
  ).toBe(false);
  // The navigation of another route, the document load and the CSP report pass.
  expect(interceptsRequest(plan, request('GET', '/dashboard?_rsc=x', { rsc: '1' }), TARGET)).toBeNull();
  expect(interceptsRequest(plan, request('GET', '/auftraege'), TARGET)).toBeNull();
  expect(interceptsRequest(plan, request('GET', '/api/csp-report'), TARGET)).toBeNull();
});

test('a standalone loading capture navigates to the address it records, and its held navigation still matches', () => {
  const target = standaloneTarget('/support', '?status=abgelehnt&einordnung=blocker');
  expect(target).toEqual({ address: '/support?status=abgelehnt&einordnung=blocker', path: '/support' });
  expect(standaloneTarget('/support/meldungen/abc?seite=2', undefined)).toEqual({
    address: '/support/meldungen/abc?seite=2',
    path: '/support/meldungen/abc',
  });
  const filteredNavigation = request('GET', `${target.address}&_rsc=abc`, {
    rsc: '1',
    'next-router-state-tree': '[]',
  });
  const plan = stateCapturePlan('loading', 'page');
  expect(interceptsRequest(plan, filteredNavigation, { origin: ORIGIN, path: target.path })).toBe(
    'navigation',
  );
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
  const captures = acceptanceSets().flatMap((set) => set.captures);
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
