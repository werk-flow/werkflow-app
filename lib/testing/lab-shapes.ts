import { DYNAMIC_PHONE_ROUTES, MANAGER_PHONE_ROUTES } from './selection/mobile-route-inventory';

/**
 * Names the request shapes of a lab step (docs/technical/performance.md,
 * "Payload budgets"), so a payload reference compares the same request across
 * worlds whose ids and numbers differ. The route list has one home, the
 * route inventory of the layout audit.
 */

const STATIC_ROUTES: readonly string[] = MANAGER_PHONE_ROUTES;
const DYNAMIC_ROUTES: readonly string[] = DYNAMIC_PHONE_ROUTES;

function matchesPattern(pattern: string, segments: readonly string[]): boolean {
  const parts = pattern.split('/').filter(Boolean);
  return (
    parts.length === segments.length &&
    parts.every((part, index) => (part.startsWith('[') && part.endsWith(']')) || part === segments[index])
  );
}

/** The inventory route a pathname renders; a path outside the inventory keeps its static segments only. */
export function routePattern(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (STATIC_ROUTES.includes(path)) return path;
  const segments = path.split('/').filter(Boolean);
  const dynamic = DYNAMIC_ROUTES.find((pattern) => matchesPattern(pattern, segments));
  if (dynamic) return dynamic;
  return `/${segments.map((segment) => (/\d/.test(segment) ? '[id]' : segment)).join('/')}`;
}

export type RequestDescription = {
  method: string;
  url: string;
  resourceType: string;
  headers: Readonly<Record<string, string>>;
  /** The app's origin; a request to another origin (the browser's own Supabase calls) is named by its path. */
  appOrigin?: string;
};

/** The shape key of one request. Query values never enter a key, except the background-read kind. */
export function payloadShape(request: RequestDescription): string {
  const url = new URL(request.url);
  if (request.appOrigin !== undefined && url.origin !== request.appOrigin)
    return `direct:${url.pathname.replace(/\/[0-9a-f-]{36}(?=\/|$)/g, '/[id]')}`;
  const route = routePattern(url.pathname);
  if (request.resourceType === 'document') return `document:${route}`;
  if (request.method === 'POST' && request.headers['next-action']) return `action:${route}`;
  if (request.method === 'GET' && request.headers['rsc'] === '1')
    return request.headers['next-router-prefetch'] || request.headers['next-router-segment-prefetch']
      ? `prefetch:${route}`
      : `route:${route}`;
  if (url.pathname === '/api/background-read')
    return `background:${url.searchParams.get('kind') ?? 'unknown'}`;
  if (url.pathname.startsWith('/api/')) return `api:${url.pathname}`;
  if (['script', 'stylesheet', 'font', 'image'].includes(request.resourceType)) return request.resourceType;
  return `other:${route}`;
}

/** The length of the longest array within the first three levels of a JSON value: the row count of a list read. */
export function jsonRows(value: unknown, depth = 0): number | null {
  if (Array.isArray(value)) return value.length;
  if (depth >= 3 || value === null || typeof value !== 'object') return null;
  let longest: number | null = null;
  for (const child of Object.values(value)) {
    const rows = jsonRows(child, depth + 1);
    if (rows !== null && (longest === null || rows > longest)) longest = rows;
  }
  return longest;
}
