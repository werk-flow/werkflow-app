// A staging journey's browser sends no hop, redirects included, to an origin the boundary refuses,
// and only hops to staging carry the bypass. Every value here is made up.
import { expect, test } from 'bun:test';

import { STAGING_ORIGIN, type BrowserRequest } from './boundary';
import {
  navigationTo,
  redirectTarget,
  sendThroughBoundary,
  type FetchedResponse,
  type RouteHop,
} from './route';

const DEV = 'devref0000000000000';
const SECRET = 'MadeUpBypassSecret0123456789abcd';

type Sent = { url: string; headers: Record<string, string> | undefined; method: string | undefined };

/** A route whose network answers from `answers` by URL; it records each hop it sent. */
function fakeRoute(request: BrowserRequest, answers: Record<string, { status: number; location?: string }>) {
  const sent: Sent[] = [];
  const outcome: { fulfilled?: unknown; aborted: boolean } = { aborted: false };
  const route: RouteHop = {
    request: { ...request, headers: { accept: '*/*' } },
    fetch: async (options) => {
      const url = options.url ?? request.url;
      sent.push({ url, headers: options.headers, method: options.method });
      const answer = answers[url] ?? { status: 200 };
      const response: FetchedResponse = {
        status: () => answer.status,
        headers: () => (answer.location ? { location: answer.location } : {}),
      };
      return response;
    },
    fulfill: async (response) => {
      outcome.fulfilled = response;
    },
    fulfillPage: async (html) => {
      outcome.fulfilled = { html };
    },
    abort: async () => {
      outcome.aborted = true;
    },
  };
  const refused: string[] = [];
  const run = () => sendThroughBoundary(route, DEV, SECRET, (hop) => refused.push(hop.url));
  return { sent, outcome, refused, run };
}

const asset = (url: string) => ({ url, navigation: false, mainFrame: true });
const page = (url: string) => ({ url, navigation: true, mainFrame: true });

test('a staging redirect to a refused origin never reaches it, whether page or asset', async () => {
  for (const request of [page(`${STAGING_ORIGIN}/go`), asset(`${STAGING_ORIGIN}/api/go`)]) {
    const route = fakeRoute(request, {
      [request.url]: { status: 302, location: 'https://app.werk-flow.app/x' },
    });
    await route.run();
    expect(route.sent.map((hop) => hop.url)).toEqual([request.url]);
    expect(route.outcome.aborted).toBe(true);
    expect(route.refused).toEqual(['https://app.werk-flow.app/x']);
  }
});

test("a page's redirect becomes a new navigation, so the browser's next request passes the route", async () => {
  const route = fakeRoute(page(`${STAGING_ORIGIN}/upgrade/bestaetigt`), {
    [`${STAGING_ORIGIN}/upgrade/bestaetigt`]: { status: 303, location: '/onboarding/create-organization' },
  });
  await route.run();
  expect(route.sent).toHaveLength(1);
  expect(route.outcome.fulfilled).toEqual({
    html: navigationTo(`${STAGING_ORIGIN}/onboarding/create-organization`),
  });
});

test("an asset's redirect is followed hop by hop, and the bypass stays on staging's hops", async () => {
  const route = fakeRoute(asset(`${STAGING_ORIGIN}/api/file`), {
    [`${STAGING_ORIGIN}/api/file`]: { status: 302, location: `https://${DEV}.supabase.co/storage/x` },
  });
  await route.run();
  expect(route.sent).toEqual([
    {
      url: `${STAGING_ORIGIN}/api/file`,
      headers: { accept: '*/*', 'x-vercel-protection-bypass': SECRET },
      method: undefined,
    },
    { url: `https://${DEV}.supabase.co/storage/x`, headers: undefined, method: 'GET' },
  ]);
  expect(route.outcome.aborted).toBe(false);
});

test('a redirect loop ends refused', async () => {
  const url = `${STAGING_ORIGIN}/loop`;
  const route = fakeRoute(asset(url), { [url]: { status: 307, location: url } });
  await route.run();
  expect(route.sent).toHaveLength(6);
  expect(route.outcome.aborted).toBe(true);
});

test('a redirect target resolves against its request, and the refresh page escapes it', () => {
  expect(redirectTarget(`${STAGING_ORIGIN}/a`, 302, '/b?x=1')).toBe(`${STAGING_ORIGIN}/b?x=1`);
  expect(redirectTarget(`${STAGING_ORIGIN}/a`, 200, '/b')).toBeNull();
  expect(redirectTarget(`${STAGING_ORIGIN}/a`, 302, undefined)).toBeNull();
  expect(navigationTo('https://x.example/?a=1&b="<>')).toBe(
    '<!doctype html><meta http-equiv="refresh" content="0;url=https://x.example/?a=1&amp;b=&quot;&lt;&gt;">',
  );
});
