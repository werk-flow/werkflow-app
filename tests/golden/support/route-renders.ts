import { expect, test, type Page, type Request } from '@playwright/test';
import ratchet from '../route-renders.json';
import {
  classifyRouteRequest,
  judgeRouteRenders,
  rendersRoute,
  type RouteRenderRatchet,
  type RouteRequestKind,
} from '../../../lib/testing/route-render-count';
import { REALTIME_REFRESH_COUNT_ATTRIBUTE } from '../../../lib/ui/route-refresh-signal';
import { settled } from './steps/interaction';

// One save is one route render (realtime-and-caching.md, "Checklist"). This
// helper counts the route renders of one save in one session and holds them
// against tests/golden/route-renders.json. A save's window opens on a quiet
// page and closes when the page is quiet again: settled (no busy signal, no
// queued or running route refresh) and no counted request in flight.

const ROUTE_RENDERS: RouteRenderRatchet = ratchet;

type Observed = { request: Request; startedAt: number; kind: RouteRequestKind | 'in-flight' };

/** A refresh, navigation or action request; a prefetch renders no route and is not awaited. */
function isCandidate(request: Request): boolean {
  const headers = request.headers();
  if (request.method() === 'POST') return Boolean(headers['next-action']);
  return (
    request.method() === 'GET' &&
    headers['rsc'] === '1' &&
    !headers['next-router-prefetch'] &&
    !headers['next-router-segment-prefetch']
  );
}

function describeRequest({ request, kind }: Observed): string {
  const url = new URL(request.url());
  return `${kind} ${request.method()} ${url.pathname}`;
}

/** Starts counting the route renders of `page`; `forSave` judges one save of the journey. */
export function observeRouteRenders(
  page: Page,
  journey: string,
): { forSave: (save: string, act: () => Promise<void>) => Promise<void> } {
  const observed: Observed[] = [];
  const inFlight = new Set<Observed>();
  // Only a save's window is observed. A document load inside it (a helper
  // that opens the page first) restarts the Realtime refresh counter on the
  // new document and drops the requests of the old one.
  let open = false;
  let newDocument = false;

  page.on('request', (request) => {
    if (!open || !isCandidate(request)) return;
    const entry: Observed = { request, startedAt: Date.now(), kind: 'in-flight' };
    inFlight.add(entry);
    observed.push(entry);
  });
  page.on('domcontentloaded', () => {
    if (!open) return;
    newDocument = true;
    const loadedAt = Date.now();
    for (const entry of inFlight) if (entry.startedAt < loadedAt) inFlight.delete(entry);
  });
  const finish = async (request: Request): Promise<void> => {
    const entry = observed.find((candidate) => candidate.request === request);
    if (!entry || !inFlight.has(entry)) return;
    const response = await request.response().catch(() => null);
    entry.kind = classifyRouteRequest({
      method: request.method(),
      requestHeaders: request.headers(),
      ...(response ? { responseHeaders: response.headers() } : {}),
    });
    inFlight.delete(entry);
  };
  page.on('requestfinished', (request) => void finish(request));
  page.on('requestfailed', (request) => void finish(request));

  async function quiet(): Promise<void> {
    await expect
      .poll(
        async () => {
          await settled(page);
          return inFlight.size;
        },
        { message: 'The page is quiet: settled, and no route or action request in flight' },
      )
      .toBe(0);
  }

  async function echoRefreshes(): Promise<number> {
    const count = await page.locator('html').getAttribute(REALTIME_REFRESH_COUNT_ATTRIBUTE);
    return Number(count ?? '0');
  }

  return {
    forSave: async (save, act) => {
      await quiet();
      const start = observed.length;
      const echoesBefore = await echoRefreshes();
      newDocument = false;
      open = true;
      await act();
      await quiet();
      open = false;
      const renders = observed
        .slice(start)
        .filter((entry) => entry.kind !== 'in-flight' && rendersRoute(entry.kind));
      const echoes = (await echoRefreshes()) - (newDocument ? 0 : echoesBefore);
      const ownRenders = renders.length - echoes;
      test.info().annotations.push({
        type: 'route-renders',
        description: `${journey}/${save}: ${ownRenders} own, ${echoes} Realtime echo`,
      });
      const problem = judgeRouteRenders({
        journey,
        save,
        entry: ROUTE_RENDERS[journey]?.[save],
        ownRenders,
        requests: renders.map(describeRequest),
      });
      expect(problem, problem ?? '').toBeNull();
    },
  };
}
