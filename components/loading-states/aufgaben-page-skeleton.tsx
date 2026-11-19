'use client';

import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// The org switch overlay (in the app shell) renders this skeleton, so it
// imports nothing of the Aufgaben page: every page would load that page's code.

const SKELETON_ROW_KEYS = [0, 1, 2] as const;

/**
 * Mirrors the loaded page: the task heading, one task group (icon + title,
 * divided card of title/meta rows) and the notification card (unread dot,
 * text, "Gelesen" button slot). Cards are not clickable as a whole, so
 * nothing here hovers.
 */
export function AufgabenListSkeleton() {
  return (
    <div className="space-y-8" aria-hidden="true">
      <section className="space-y-4">
        <Skeleton className="h-5 w-32" />
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 px-1">
            <Skeleton className="size-4" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Card className="gap-0 divide-y py-0">
            {SKELETON_ROW_KEYS.map((key) => (
              <div key={key} className="space-y-1.5 px-4 py-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
            ))}
          </Card>
        </div>
      </section>
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Card className="gap-0 divide-y py-0">
          {SKELETON_ROW_KEYS.map((key) => (
            <div key={key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Skeleton className="size-2 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-64 max-w-full" />
              </div>
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}

function AufgabenContentSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      {/* The own personnel actions section stays empty for most people; it reserves no space. */}
      <AufgabenListSkeleton />
    </div>
  );
}

export function AufgabenPageSkeleton() {
  return (
    <PageShell>
      <PageHeader title="Aufgaben" />
      <PageBody>
        <AufgabenContentSkeleton />
      </PageBody>
    </PageShell>
  );
}
