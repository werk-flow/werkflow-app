import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { classifyRouteRequest, judgeRouteRenders, ratchetProblems, rendersRoute } from './route-render-count';

const RATCHET = join(import.meta.dir, '../../tests/golden/route-renders.json');

test('a refresh GET and a revalidating action render the route; a prefetch and a plain action do not', () => {
  const kinds = [
    classifyRouteRequest({ method: 'GET', requestHeaders: { rsc: '1', 'next-router-state-tree': '[]' } }),
    classifyRouteRequest({
      method: 'POST',
      requestHeaders: { 'next-action': 'abc' },
      responseHeaders: { 'x-action-revalidated': '1' },
    }),
    classifyRouteRequest({
      method: 'POST',
      requestHeaders: { 'next-action': 'abc' },
      responseHeaders: { 'x-action-revalidated': '2' },
    }),
    classifyRouteRequest({ method: 'GET', requestHeaders: { rsc: '1', 'next-router-prefetch': '1' } }),
    classifyRouteRequest({
      method: 'GET',
      requestHeaders: { rsc: '1', 'next-router-segment-prefetch': '/_tree' },
    }),
    classifyRouteRequest({ method: 'POST', requestHeaders: { 'next-action': 'abc' }, responseHeaders: {} }),
    classifyRouteRequest({ method: 'GET', requestHeaders: {} }),
  ];
  expect(kinds).toEqual([
    'route-refresh',
    'action-render',
    'action-render',
    'prefetch',
    'prefetch',
    'action',
    'other',
  ]);
  expect(kinds.map(rendersRoute)).toEqual([true, true, true, false, false, false, false]);
});

test('the ratchet file is valid and no save renders more than once without a reviewed reason', () => {
  expect(ratchetProblems(JSON.parse(readFileSync(RATCHET, 'utf8')))).toEqual([]);
  expect(ratchetProblems({ journey: { save: { renders: 2 } } })).toEqual([
    'journey/save: more than one route render needs a reviewed reason',
  ]);
  expect(ratchetProblems({ journey: { save: { renders: 1, note: 'x' } } })).toEqual([
    'journey/save: only renders and reason are allowed',
  ]);
});

test('a save above its entry fails with its requests, and one below asks to lower the entry', () => {
  const base = { journey: 'p1-01', save: 'contact.add.first', entry: { renders: 1 } } as const;
  expect(judgeRouteRenders({ ...base, ownRenders: 1, requests: ['route-refresh GET /kunden/x'] })).toBeNull();
  expect(
    judgeRouteRenders({
      ...base,
      ownRenders: 2,
      requests: ['action-render POST /kunden/x', 'route-refresh GET /kunden/x'],
    }),
  ).toBe(
    'p1-01/contact.add.first rendered the route 2 time(s), above its entry of 1 (action-render POST /kunden/x, route-refresh GET /kunden/x).',
  );
  expect(judgeRouteRenders({ ...base, ownRenders: 0, requests: [] })).toBe(
    'p1-01/contact.add.first rendered the route 0 time(s): lower its entry in tests/golden/route-renders.json to 0.',
  );
  expect(judgeRouteRenders({ ...base, entry: undefined, ownRenders: 1, requests: [] })).toContain(
    'has no entry',
  );
});
