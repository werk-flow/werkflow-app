'use client';

import Link from 'next/link';
import { memo } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { AiThreadSummary } from '@/lib/ai/thread-types';
import { cn } from '@/lib/utils';

export function kiThreadHref(threadId: string | null): string {
  return threadId ? `/ki?chat=${threadId}` : '/ki';
}

/** A plain click opens in place; a click that asks for a new tab or window keeps the browser's default. */
function opensInPlace(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export const KiThreadList = memo(function KiThreadList({
  threads,
  currentThreadId,
  hasMore,
  loadingMore,
  onOpen,
  onLoadMore,
}: {
  threads: readonly AiThreadSummary[];
  currentThreadId: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onOpen: (threadId: string) => void;
  onLoadMore: () => void;
}): React.JSX.Element {
  if (threads.length === 0)
    return (
      <EmptyState size="compact" title="Noch keine Chats." description="Stell unten deine erste Frage." />
    );
  return (
    <nav aria-label="Chats" className="space-y-2">
      <ul className="space-y-1">
        {threads.map((thread) => (
          <li key={thread.id}>
            <Link
              href={kiThreadHref(thread.id)}
              prefetch={false}
              aria-current={thread.id === currentThreadId ? 'page' : undefined}
              onClick={(event) => {
                if (!opensInPlace(event)) return;
                event.preventDefault();
                onOpen(thread.id);
              }}
              className={cn(
                'block truncate rounded-md px-3 py-1.5 text-sm transition-colors',
                thread.id === currentThreadId
                  ? 'bg-accent font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              {thread.title ?? 'Neuer Chat'}
            </Link>
          </li>
        ))}
      </ul>
      {hasMore && (
        <Button variant="link" pending={loadingMore} onClick={onLoadMore}>
          Ältere Chats laden
        </Button>
      )}
    </nav>
  );
});
