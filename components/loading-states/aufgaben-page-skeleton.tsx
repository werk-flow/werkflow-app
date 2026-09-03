'use client';

import { AufgabenListSkeleton } from '@/components/aufgaben/aufgaben-content';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export function AufgabenContentSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* The own personnel actions section renders its own placeholder at this height. */}
      <Skeleton className="h-28 w-full" />
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
