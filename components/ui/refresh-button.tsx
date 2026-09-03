'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { useServerAction } from '@/hooks/use-server-action';
import { cn } from '@/lib/utils';

/**
 * The one home of a router transition in product code (feedback canon,
 * "Manual list refresh": the icon spins, the rows stay on screen, never a
 * skeleton over existing data). `useTransition` is lint-banned everywhere
 * else because a router-entangled pending flag turned whole tables into
 * skeletons after the user's own refresh click (UI/UX hardening Phase 5,
 * 2026-09-03). Surfaces that own a `useLiveView` pass its `refresh` instead
 * and get the same control bound to that awaited read.
 */
export function useRouterRefresh(): { refresh: () => void; isPending: boolean } {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);
  return { refresh, isPending };
}

export function RefreshButton({
  onRefresh,
  withRouteRefresh = !onRefresh,
  label = 'Aktualisieren',
  className,
}: {
  /** Awaited read for live-view surfaces (a `useLiveView` refresh, a status refetch). */
  onRefresh?: () => Promise<unknown>;
  /** Also refresh the route; the default when no `onRefresh` is given. */
  withRouteRefresh?: boolean;
  /** German accessible name and tooltip. */
  label?: string;
  className?: string;
}) {
  const routeRefresh = useRouterRefresh();
  const liveRefresh = useServerAction(async () => {
    if (onRefresh) await onRefresh();
  });
  const isPending = liveRefresh.isPending || routeRefresh.isPending;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('size-8 shrink-0', className)}
      onClick={() => {
        if (onRefresh) void liveRefresh.run();
        if (withRouteRefresh) routeRefresh.refresh();
      }}
      disabled={isPending}
      aria-label={label}
      title={label}
    >
      <RefreshCw className={cn('size-4', isPending && 'animate-spin')} />
    </Button>
  );
}
