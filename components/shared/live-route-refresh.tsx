'use client';

import type { RealtimeTable } from '@/components/realtime/realtime-provider';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';

/**
 * Live refresh for a page that a server component renders completely: a
 * change to one of the tables reads the route again. It renders nothing.
 */
export function LiveRouteRefresh({ tables }: { tables: readonly RealtimeTable[] }) {
  useRealtimeRouterRefresh({ tables });
  return null;
}
