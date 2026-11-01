/**
 * Route renders per save (realtime-and-caching.md, "Checklist": one save is
 * one route render). A route render is a server render of the current page
 * that a request asks for:
 * - a GET with `rsc: 1` that is not a prefetch: `router.refresh()`, a
 *   Realtime refresh, a navigation;
 * - a Server Action POST whose response says it revalidated
 *   (`x-action-revalidated` 1 or 2): Next renders the current page into that
 *   response (node_modules/next/dist/server/app-render/action-handler.js,
 *   `addRevalidationHeader`).
 * A prefetch, a plain action and every other request render no route.
 */
import { isJsonRecord } from '@/lib/supabase/json';

export type RouteRequestKind = 'route-refresh' | 'action-render' | 'prefetch' | 'action' | 'other';

/** Header names in lower case, as Playwright reports them. */
export type RequestHeaders = Readonly<Record<string, string>>;

export function classifyRouteRequest(input: {
  method: string;
  requestHeaders: RequestHeaders;
  responseHeaders?: RequestHeaders;
}): RouteRequestKind {
  const { method, requestHeaders, responseHeaders = {} } = input;
  if (method === 'POST' && requestHeaders['next-action']) {
    const revalidated = responseHeaders['x-action-revalidated'];
    return revalidated === '1' || revalidated === '2' ? 'action-render' : 'action';
  }
  if (method !== 'GET' || requestHeaders['rsc'] !== '1') return 'other';
  if (requestHeaders['next-router-prefetch'] || requestHeaders['next-router-segment-prefetch'])
    return 'prefetch';
  return 'route-refresh';
}

export function rendersRoute(kind: RouteRequestKind): boolean {
  return kind === 'route-refresh' || kind === 'action-render';
}

/** One save's ceiling in tests/golden/route-renders.json; above 1 needs a reviewed reason. */
export type RouteRenderEntry = { renders: number; reason?: string };
export type RouteRenderRatchet = Readonly<Record<string, Readonly<Record<string, RouteRenderEntry>>>>;

/** Shape errors of the ratchet file; empty when valid. */
export function ratchetProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['the ratchet is not an object'];
  for (const [journey, saves] of Object.entries(value)) {
    if (!isJsonRecord(saves)) {
      problems.push(`${journey}: not an object of saves`);
      continue;
    }
    for (const [save, entry] of Object.entries(saves)) {
      const renders = isJsonRecord(entry) ? entry.renders : undefined;
      const reason = isJsonRecord(entry) ? entry.reason : undefined;
      const keys = Object.keys(entry ?? {});
      if (typeof renders !== 'number' || !Number.isInteger(renders) || renders < 0)
        problems.push(`${journey}/${save}: renders must be a whole number`);
      if (keys.some((key) => key !== 'renders' && key !== 'reason'))
        problems.push(`${journey}/${save}: only renders and reason are allowed`);
      if (reason !== undefined && (typeof reason !== 'string' || !reason.trim()))
        problems.push(`${journey}/${save}: a reason is a sentence`);
      // Number() keeps the relational comparison's coercion: a count written as text is judged too.
      if (Number(renders) > 1 && reason === undefined)
        problems.push(`${journey}/${save}: more than one route render needs a reviewed reason`);
    }
  }
  return problems;
}

/**
 * Judges one save. The saving session's own renders are compared, without
 * the Realtime refreshes its own write echoed back (lib/realtime/own-writes.ts
 * skips most of them; an unstamped table still echoes), so the count does not
 * depend on when the echo arrives. Above the entry fails; below it fails too, so the ratchet only
 * moves down and a fix lowers the entry in the same change.
 */
export function judgeRouteRenders(input: {
  journey: string;
  save: string;
  entry: RouteRenderEntry | undefined;
  ownRenders: number;
  requests: readonly string[];
}): string | null {
  const { journey, save, entry, ownRenders, requests } = input;
  const seen = requests.length ? ` (${requests.join(', ')})` : '';
  if (!entry)
    return `${journey}/${save} has no entry in tests/golden/route-renders.json; it rendered the route ${ownRenders} time(s)${seen}.`;
  if (ownRenders > entry.renders)
    return `${journey}/${save} rendered the route ${ownRenders} time(s), above its entry of ${entry.renders}${seen}.`;
  if (ownRenders < entry.renders)
    return `${journey}/${save} rendered the route ${ownRenders} time(s): lower its entry in tests/golden/route-renders.json to ${ownRenders}.`;
  return null;
}
