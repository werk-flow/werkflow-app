import { describe, expect, test } from 'bun:test';

import { jsonRows, payloadShape, routePattern } from './lab-shapes';

const APP = 'http://localhost:3000';

describe('lab request shapes', () => {
  test('a pathname maps to its inventory route; ids and numbers never enter a shape', () => {
    expect(routePattern('/auftraege')).toBe('/auftraege');
    expect(routePattern('/auftraege/PERF-1a2b3c-2500')).toBe('/auftraege/[jobNumber]');
    expect(routePattern('/auftraege/projekt/P-1/J-2')).toBe('/auftraege/projekt/[projectNumber]/[jobNumber]');
    expect(routePattern('/kunden/0f1e2d3c-1111-2222-3333-444455556666')).toBe('/kunden/[clientId]');
    expect(routePattern('/api/unknown/42')).toBe('/api/unknown/[id]');
  });

  test('a request is named by its kind and route, a background read by its kind only', () => {
    const shape = (
      method: string,
      path: string,
      resourceType: string,
      headers: Record<string, string> = {},
    ) => payloadShape({ method, url: `${APP}${path}`, resourceType, headers, appOrigin: APP });
    expect(shape('GET', '/auftraege', 'document')).toBe('document:/auftraege');
    expect(shape('GET', '/auftraege/A-1?_rsc=x', 'fetch', { rsc: '1' })).toBe('route:/auftraege/[jobNumber]');
    expect(shape('GET', '/auftraege', 'fetch', { rsc: '1', 'next-router-prefetch': '1' })).toBe(
      'prefetch:/auftraege',
    );
    expect(shape('POST', '/dashboard', 'fetch', { 'next-action': 'abc' })).toBe('action:/dashboard');
    expect(shape('GET', '/api/background-read?kind=parked-jobs&input=%7B%7D', 'fetch')).toBe(
      'background:parked-jobs',
    );
    expect(shape('GET', '/api/calendar-window?from=2026-01-01', 'fetch')).toBe('api:/api/calendar-window');
    expect(shape('GET', '/_next/static/chunks/a.js', 'script')).toBe('script');
  });

  test("the browser's own Supabase calls are named by their path without ids", () => {
    expect(
      payloadShape({
        method: 'GET',
        url: 'http://172.20.0.1:54321/rest/v1/jobs/0f1e2d3c-1111-2222-3333-444455556666?select=*',
        resourceType: 'fetch',
        headers: {},
        appOrigin: APP,
      }),
    ).toBe('direct:/rest/v1/jobs/[id]');
  });

  test('the row count of a JSON read is its longest array within three levels', () => {
    expect(jsonRows({ success: true, data: { rows: [1, 2, 3], other: [1] } })).toBe(3);
    expect(jsonRows([1, 2])).toBe(2);
    expect(jsonRows({ success: true, state: { minutes: 3 } })).toBeNull();
    expect(jsonRows({ a: { b: { c: { d: [1, 2] } } } })).toBeNull();
  });
});
