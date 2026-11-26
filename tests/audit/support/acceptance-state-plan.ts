import { classifyRouteRequest, type RequestHeaders } from '../../../lib/testing/route-render-count';

// The state captures of rendered acceptance (docs/technical/standards-audit.md,
// "Rendered design acceptance"): the plan that makes a loading or an error
// state appear on purpose, and the requests it intercepts. Pure, so
// lib/testing/spec-support/acceptance-state-plan.test.ts pins it; the fixture
// in acceptance-captures.ts carries it out in the browser.
//
// What the browser can produce: a route's `loading.tsx` (its navigation held),
// a client region's skeleton (its read held) and a client region's failure
// with its retry (its read failed). A region the server renders reads before
// the browser sees a request, so its failure (`RegionLoadError`) is no capture;
// lib/conventions/detail-loader-failures.test.ts and
// read-error-visibility.test.ts prove that it reaches the screen.

/** A screen state other than settled that a capture asks for. */
export type CaptureState = 'loading' | 'error';

/**
 * A dialog over a failed page opens only over a region its server render could
 * not load in the test world (acceptance-rounds.ts, `overFailedPage`).
 */
export type StateView = 'page' | 'tab' | 'dialog' | 'dialog-over-failed-page';

export type StatePlan = {
  /** The client reads, and for a page's loading state its navigation too. */
  intercepts: readonly ('reads' | 'navigation')[];
  /** `hold`: the request gets no answer while the capture runs; `abort`: it fails as a lost connection does. */
  response: 'hold' | 'abort';
  /**
   * How the screen reaches the state: a client navigation from another route
   * (the route's `loading.tsx`), a fresh page load, or the view's own gesture
   * (a tab press, a dialog's trigger) on the settled page.
   */
  reach: 'client-navigation' | 'page-load' | 'gesture';
  /**
   * What must be on screen in the capture's scope; the other marker must not
   * be. `failed-region-behind`: the page's failure behind the dialog, which
   * itself reads nothing that could fail.
   */
  shows: 'skeleton' | 'failed-region' | 'failed-region-behind';
};

/** A failed region: `SectionError`, or the stale region of a live view whose refresh failed. */
export const FAILED_REGION_SELECTOR = '[data-slot="section-error"]:visible, [data-stale]:visible';

export const SKELETON_SELECTOR = '[data-slot="skeleton"]:visible';

export function stateCapturePlan(state: CaptureState, view: StateView): StatePlan {
  if (view === 'dialog-over-failed-page') {
    if (state === 'loading')
      throw new Error(
        'A dialog over a failed page has no loading capture: the page behind it settles first.',
      );
    // The failure is the server render's own, so the capture forces nothing.
    return { intercepts: [], response: 'abort', reach: 'gesture', shows: 'failed-region-behind' };
  }
  const response = state === 'loading' ? 'hold' : 'abort';
  const shows = state === 'loading' ? 'skeleton' : 'failed-region';
  if (view !== 'page') return { intercepts: ['reads'], response, reach: 'gesture', shows };
  if (state === 'loading')
    return { intercepts: ['navigation', 'reads'], response, reach: 'client-navigation', shows };
  return { intercepts: ['reads'], response, reach: 'page-load', shows };
}

/** The route a loading capture navigates from: the dashboard, or the task list when the target is the dashboard. */
export function navigationStart(targetPath: string): string {
  return targetPath === '/dashboard' ? '/aufgaben' : '/dashboard';
}

/** Where a capture of a screen outside the app shell goes: the address it records and navigates to, and its path. */
export type StandaloneTarget = { address: string; path: string };

/**
 * The target of a standalone capture: the opened address, or the same route
 * with the capture's own query. A loading capture navigates to this address,
 * so its image shows the screen the capture records; its held navigation is
 * matched by the path alone.
 */
export function standaloneTarget(openedPath: string, query: string | undefined): StandaloneTarget {
  const path = openedPath.split('?')[0] ?? openedPath;
  return { address: query === undefined ? openedPath : `${path}${query}`, path };
}

export type ObservedRequest = { method: string; url: string; headers: RequestHeaders };

/** The CSP report is the browser's, not a read of the screen. */
const NOT_A_READ: ReadonlySet<string> = new Set(['/api/csp-report']);

/** A client read of the app: a Server Action, or a GET of one of its route handlers. */
function isClientRead(request: ObservedRequest, url: URL): boolean {
  if (classifyRouteRequest({ method: request.method, requestHeaders: request.headers }) === 'action')
    return true;
  return request.method === 'GET' && url.pathname.startsWith('/api/') && !NOT_A_READ.has(url.pathname);
}

/** The navigation to the target: a GET of its server render that is no prefetch. */
function isNavigation(request: ObservedRequest, url: URL, targetPath: string): boolean {
  const kind = classifyRouteRequest({ method: request.method, requestHeaders: request.headers });
  return kind === 'route-refresh' && decodeURIComponent(url.pathname) === targetPath;
}

/** A prefetch of the target route, which a loading capture lets through and waits for before it navigates. */
export function isTargetPrefetch(
  request: ObservedRequest,
  target: { origin: string; path: string },
): boolean {
  const url = new URL(request.url);
  const kind = classifyRouteRequest({ method: request.method, requestHeaders: request.headers });
  return (
    url.origin === target.origin && kind === 'prefetch' && decodeURIComponent(url.pathname) === target.path
  );
}

/**
 * A request that brings a route's data or code: any route prefetch of the app,
 * or a script chunk of the app, such as the one a prefetched loading boundary
 * imports. A held navigation pushes only once none is in flight. A prefetch of
 * the same area still running can keep the client router from committing to
 * the cached loading boundary. A chunk that lands a few milliseconds after the
 * push leaves the router suspended on the held response, so the boundary never
 * shows (reproduced with chunks released 2 to 4 ms after the push).
 */
export function isRouteLoad(request: ObservedRequest, origin: string): boolean {
  const url = new URL(request.url);
  if (url.origin !== origin) return false;
  if (
    request.method === 'GET' &&
    url.pathname.startsWith('/_next/static/chunks/') &&
    url.pathname.endsWith('.js')
  )
    return true;
  return classifyRouteRequest({ method: request.method, requestHeaders: request.headers }) === 'prefetch';
}

/** Whether the plan intercepts this request of the page; every other request, a prefetch above all, passes. */
export function interceptsRequest(
  plan: StatePlan,
  request: ObservedRequest,
  target: { origin: string; path: string },
): 'reads' | 'navigation' | null {
  const url = new URL(request.url);
  if (url.origin !== target.origin) return null;
  if (plan.intercepts.includes('navigation') && isNavigation(request, url, target.path)) return 'navigation';
  if (plan.intercepts.includes('reads') && isClientRead(request, url)) return 'reads';
  return null;
}

/** A state capture's id names its state, so its image and citation never pass for the settled screen. */
export function stateCaptureId(id: string, state: CaptureState): string {
  return `${id}-${state}`;
}
