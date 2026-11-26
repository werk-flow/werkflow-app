// How a staging journey's browser sends one request (.claude/skills/staging-journey/SKILL.md): every
// hop, redirects included, passes `requestVerdict` before it reaches the network, and only a hop to
// staging carries the bypass (Tier 1). Chromium follows a fulfilled redirect without asking the route
// again, so the route never hands it one: it follows a redirect itself, or turns a page's redirect into a
// new navigation that comes back through the route.

import { bypassHeaders, requestVerdict, type BrowserRequest } from './boundary';

/** The parts of a Playwright route the handler uses; the kit adapts the real one. */
export type RouteHop<R extends FetchedResponse = FetchedResponse> = {
  request: BrowserRequest & { method: string; headers: Record<string, string> };
  /** Sends one hop and never follows its redirect. */
  fetch(options: {
    maxRedirects: 0;
    url?: string;
    method?: string;
    postData?: string | Buffer;
    headers?: Record<string, string>;
  }): Promise<R>;
  /** Answers the browser with a fetched response. */
  fulfill(response: R): Promise<void>;
  /** Answers the browser with an HTML page of our own. */
  fulfillPage(html: string): Promise<void>;
  abort(): Promise<void>;
};

export type FetchedResponse = { status(): number; headers(): Record<string, string> };

/** More hops than a sign-in or Checkout ever takes. */
const MAX_HOPS = 5;

/** A redirect's absolute target, or null when the answer is no redirect. */
export function redirectTarget(from: string, status: number, location: string | undefined): string | null {
  if (![301, 302, 303, 307, 308].includes(status) || !location) return null;
  return URL.parse(location, from)?.href ?? null;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' };

/**
 * The method a redirect's next hop takes, as a browser does: 303 turns all but GET and HEAD into GET,
 * 301 and 302 turn POST into GET, and every other method and status keeps the request as it is.
 */
export function redirectMethod(method: string, status: number): string {
  if (status === 303) return method === 'HEAD' ? 'HEAD' : 'GET';
  if ((status === 301 || status === 302) && method === 'POST') return 'GET';
  return method;
}

/** A page that sends the browser to `target` as a new navigation, which passes the route again. */
export function navigationTo(target: string): string {
  const escaped = target.replace(/[&"<>]/g, (character) => HTML_ESCAPES[character] ?? character);
  return `<!doctype html><meta http-equiv="refresh" content="0;url=${escaped}">`;
}

/**
 * Sends one browser request hop by hop. A refused hop is aborted before it is sent and reported through
 * `refuse` with its request; nothing else about it leaves this function.
 */
export async function sendThroughBoundary<R extends FetchedResponse>(
  route: RouteHop<R>,
  devRef: string,
  secret: string,
  refuse: (request: BrowserRequest) => void,
): Promise<void> {
  let hop: BrowserRequest = route.request;
  let method = route.request.method;
  let override: { url?: string; method?: string; postData?: string | Buffer } = {};
  for (let count = 0; count <= MAX_HOPS; count += 1) {
    if (requestVerdict(hop, devRef) === 'refused') {
      refuse(hop);
      await route.abort();
      return;
    }
    const bypass = bypassHeaders(hop, secret);
    // Another origin's hop keeps the browser's own headers: a rewritten set breaks Stripe's pages.
    const headers = Object.keys(bypass).length ? { headers: { ...route.request.headers, ...bypass } } : {};
    const response = await route.fetch({ ...override, ...headers, maxRedirects: 0 });
    const target = redirectTarget(hop.url, response.status(), response.headers().location);
    if (target === null) {
      await route.fulfill(response);
      return;
    }
    const next = { ...hop, url: target };
    if (hop.navigation) {
      if (requestVerdict(next, devRef) === 'refused') {
        refuse(next);
        await route.abort();
        return;
      }
      await route.fulfillPage(navigationTo(target));
      return;
    }
    // A hop that changes its method drops the body; one that keeps it repeats the method and body sent last.
    const nextMethod = redirectMethod(method, response.status());
    override =
      nextMethod === method
        ? { ...override, url: target }
        : // An empty Buffer, not '': Playwright JSON-encodes a string body under `Content-Type: application/json`.
          { url: target, method: nextMethod, postData: Buffer.alloc(0) };
    method = nextMethod;
    hop = next;
  }
  refuse(hop);
  await route.abort();
}
