'use client';

import type { ReactElement, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useServerAction } from '@/hooks/use-server-action';
import { cn } from '@/lib/utils';

const DEFAULT_NOTICE =
  'Diese Angaben konnten nicht aktualisiert werden und sind eventuell nicht mehr aktuell.';

/**
 * The stale state of a live view (freshness contract rule 5,
 * docs/technical/realtime-and-caching.md): after a failed read the view keeps
 * its last data and `isStale` turns true. While stale, this region names the
 * data as possibly outdated, offers the retry and makes its content inert, so
 * no action runs on data the app knows may be out of date. While current, it
 * renders two plain blocks around the content, so the screen looks the same.
 * `data-stale` marks the region for tests; `aria-busy` stays off because the
 * region is not loading.
 */
export function StaleRegion({
  stale,
  onRetry,
  notice = DEFAULT_NOTICE,
  className,
  children,
}: {
  stale: boolean;
  /** The view's awaited read, usually `view.refresh`. */
  onRetry: () => Promise<unknown>;
  notice?: string;
  /** Layout of the content block, such as `space-y-3` when it holds several siblings. */
  className?: string;
  children: ReactNode;
}): ReactElement {
  const retry = useServerAction(async () => {
    await onRetry();
  });
  return (
    <div data-stale={stale || undefined}>
      {stale && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          <p className="min-w-0">{notice}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void retry.run()}
            disabled={retry.isPending}
            pending={retry.isPending}
            className="shrink-0"
          >
            Erneut laden
          </Button>
        </div>
      )}
      <div className={cn(className, stale && 'opacity-60')} inert={stale || undefined}>
        {children}
      </div>
    </div>
  );
}
