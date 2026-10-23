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

export type StateView = 'page' | 'tab' | 'dialog';

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
  /** What must be on screen in the capture's scope; the other marker must not be. */
  shows: 'skeleton' | 'failed-region';
};

/** A failed region: `SectionError`, or the stale region of a live view whose refresh failed. */
export const FAILED_REGION_SELECTOR = '[data-slot="section-error"]:visible, [data-stale]:visible';

export const SKELETON_SELECTOR = '[data-slot="skeleton"]:visible';

export function stateCapturePlan(state: CaptureState, view: StateView): StatePlan {
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
