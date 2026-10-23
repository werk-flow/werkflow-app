import { expect, type Locator, type Page, type Request, type Route } from '@playwright/test';
import { settled } from '../../golden/support/steps/interaction';
import { inPageTab, SHARED_COPY } from '../../golden/support/steps/shared';
import {
  FAILED_REGION_SELECTOR,
  SKELETON_SELECTOR,
  interceptsRequest,
  isTargetPrefetch,
  navigationStart,
  type ObservedRequest,
  type StatePlan,
} from './acceptance-state-plan';
import type { CaptureSpec } from './acceptance-sets';
import { DIALOG_OPENERS } from './dialog-openers';
import { openLayerAt } from './open-layer';
import { VIEWPORT_HEIGHT } from './open-layer-plan';
import type { SurfaceContext } from './surface-fixtures';
import { openSurface } from './surface-routes';

// The browser half of the state captures (acceptance-state-plan.ts owns the
// plan): it reaches the planned state through the test's route interception
// and proves that exactly that state is on screen before an image is written.

type Interception = {
  /** Starts intercepting; until then every request passes. */
  arm: () => Promise<void>;
  /** The held navigations of the target: a loading capture's proof that its skeleton is the route's. */
  heldNavigations: () => number;
  /** Ends intercepting; a held request stays unanswered until the next document load cancels it. */
  release: () => Promise<void>;
};

const ALL_REQUESTS = '**/*';

function observed(request: Request): ObservedRequest {
  return { method: request.method(), url: request.url(), headers: request.headers() };
}

async function interceptFor(page: Page, plan: StatePlan, path: string): Promise<Interception> {
  // The app's origin, read when the capture arms on a loaded page: before a dialog's fresh load the page may be blank.
  let origin: string | null = null;
  let heldNavigations = 0;
  const handler = async (route: Route): Promise<void> => {
    const kind = origin ? interceptsRequest(plan, observed(route.request()), { origin, path }) : null;
    if (kind === null) return route.fallback();
    if (plan.response === 'abort') return route.abort('failed');
    // Held: no answer while the capture runs.
    if (kind === 'navigation') heldNavigations += 1;
  };
  await page.route(ALL_REQUESTS, handler);
  return {
    arm: () => {
      origin = new URL(page.url()).origin;
      if (origin === 'null') throw new Error('A state capture arms only on a loaded page of the app.');
      return Promise.resolve();
    },
    heldNavigations: () => heldNavigations,
    release: () => page.unroute(ALL_REQUESTS, handler),
  };
}

/** Calls `window.next.router[method](url)`, the app router that Next.js exposes on the page. */
async function appRouter(page: Page, method: 'prefetch' | 'push', url: string): Promise<void> {
  await page.evaluate(
    ({ name, target }) => {
      const next: unknown = Reflect.get(window, 'next');
      const router: unknown = typeof next === 'object' && next !== null ? Reflect.get(next, 'router') : null;
      const call: unknown = typeof router === 'object' && router !== null ? Reflect.get(router, name) : null;
      if (typeof call !== 'function')
        throw new Error('The page exposes no Next.js app router (window.next.router).');
      Reflect.apply(call, router, [target]);
    },
    { name: method, target: url },
  );
}

/**
 * Navigates on the client to the target while its server render is held, so
 * the route's `loading.tsx` stays on screen. The prefetch passes first: it
 * brings the loading boundary that the navigation shows at once.
 */
async function navigateHeld(page: Page, path: string, interception: Interception): Promise<void> {
  const target = { origin: new URL(page.url()).origin, path };
  const pending = new Set<Request>();
  // router.prefetch returns before the browser starts the request: wait until one started and all ended.
  let seen = 0;
  const started = (request: Request): void => {
    if (!isTargetPrefetch(observed(request), target)) return;
    seen += 1;
    pending.add(request);
  };
  const ended = (request: Request): void => {
    pending.delete(request);
  };
  page.on('request', started);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  try {
    await appRouter(page, 'prefetch', path);
    await expect
      .poll(() => seen > 0 && pending.size === 0, { message: 'the prefetch of the target route finished' })
      .toBe(true);
  } finally {
    page.off('request', started);
    page.off('requestfinished', ended);
    page.off('requestfailed', ended);
  }
  await interception.arm();
  await appRouter(page, 'push', path);
}

/**
 * Reaches the planned state at one width and returns the scope that shows it
 * with the interception that holds it. The caller releases the interception.
 */
async function reachState(
  context: SurfaceContext,
  view: CaptureSpec['view'],
  plan: StatePlan,
  width: number,
): Promise<{ scope: Locator; interception: Interception }> {
  const { page, route } = context;
  const main = page.getByRole('main');
  if (view.kind === 'dialog') {
    const interception = await interceptFor(page, plan, route);
    const { layer } = await openLayerAt(context, DIALOG_OPENERS[view.opener], width, {
      fresh: true,
      beforeOpen: interception.arm,
      settleLayer: plan.shows === 'failed-region',
    });
    return { scope: layer, interception };
  }
  await page.setViewportSize({ width, height: VIEWPORT_HEIGHT[width] ?? 800 });
  // A fresh document of the app first: the interception knows the origin, and a loading capture has its start.
  await openSurface(page, { route: plan.reach === 'gesture' ? route : navigationStart(route) });
  const interception = await interceptFor(page, plan, route);
  if (plan.reach === 'client-navigation') await navigateHeld(page, route, interception);
  else await interception.arm();
  if (plan.reach === 'page-load') await page.goto(route);
  if (view.kind === 'tab') {
    const tab = inPageTab(main, view.value);
    await tab.click();
    await expect(tab).toHaveAttribute('data-state', 'active');
  }
  return { scope: main, interception };
}

/**
 * Exactly the planned state is on screen: a held read or navigation shows its
 * skeleton and no failure; a failed read shows its failure with the retry and
 * nothing still loads. A screen whose regions all render on the server shows
 * no failure here, and the capture fails by name.
 */
async function expectState(
  page: Page,
  scope: Locator,
  plan: StatePlan,
  interception: Interception,
): Promise<void> {
  await expect(page, 'a capture of a sign-in or onboarding screen is missing evidence').not.toHaveURL(
    /\/(login|signup|onboarding)(\/|$)/,
  );
  const failed = scope.locator(FAILED_REGION_SELECTOR);
  if (plan.shows === 'skeleton') {
    await expect(
      scope.locator(SKELETON_SELECTOR).first(),
      'the held request shows its skeleton',
    ).toBeVisible();
    await expect(failed).toHaveCount(0);
    if (plan.reach === 'client-navigation')
      expect(interception.heldNavigations(), 'the skeleton belongs to the held navigation').toBeGreaterThan(
        0,
      );
  } else {
    await expect(
      failed.first(),
      'a failed client read shows its failure; a region the server renders cannot fail from the browser',
    ).toBeVisible();
    await expect(
      failed.first().getByRole('button', { name: SHARED_COPY.action.retry, exact: true }),
    ).toBeVisible();
    await settled(scope);
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/**
 * Reaches the planned state at one width and runs `capture` while it holds;
 * `prove` asserts that exactly that state is on screen, before each image.
 * The interception ends afterwards, a failed capture included.
 */
export async function withState(
  context: SurfaceContext,
  view: CaptureSpec['view'],
  plan: StatePlan,
  width: number,
  capture: (prove: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const { scope, interception } = await reachState(context, view, plan, width);
  try {
    await capture(() => expectState(context.page, scope, plan, interception));
  } finally {
    await interception.release();
  }
}
