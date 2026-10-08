/**
 * The busy signal of a route refresh. While a refresh is queued (a Realtime
 * event waits out the debounce) or in flight (the router transition runs),
 * `<html data-route-refresh>` is set; the browser settle step waits on it
 * (lib/testing/spec-support/busy-signals.ts), so a spec neither acts nor
 * counts renders before the refreshed route lands. The attribute is written
 * outside React, so marking costs no render.
 */
const holders = new Set<symbol>();

export const ROUTE_REFRESH_ATTRIBUTE = 'data-route-refresh';

/**
 * Counts the route refreshes a Realtime event started on `<html
 * data-realtime-refreshes>`, so the route-render count of a save can tell
 * the saving session's own renders from the echo of its own write
 * (lib/testing/route-render-count.ts).
 */
export const REALTIME_REFRESH_COUNT_ATTRIBUTE = 'data-realtime-refreshes';

export function countRealtimeRefresh(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const count = Number(root.getAttribute(REALTIME_REFRESH_COUNT_ATTRIBUTE) ?? '0');
  root.setAttribute(REALTIME_REFRESH_COUNT_ATTRIBUTE, String(count + 1));
}

export function markRouteRefresh(holder: symbol, busy: boolean): void {
  if (busy) holders.add(holder);
  else holders.delete(holder);
  if (typeof document === 'undefined') return;
  if (holders.size > 0) document.documentElement.setAttribute(ROUTE_REFRESH_ATTRIBUTE, 'true');
  else document.documentElement.removeAttribute(ROUTE_REFRESH_ATTRIBUTE);
}
