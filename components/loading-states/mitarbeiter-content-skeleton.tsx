'use client';

import { MembersTableSkeleton } from '@/components/mitarbeiter/members-table';
import { Skeleton } from '@/components/ui/skeleton';

export function MitarbeiterContentSkeleton() {
  return (
    <>
      {/* Four state tabs (Mitglieder, Einladungen, Teams, Qualifikationen) and the refresh control. */}
      <div className="mb-4 flex min-w-0 items-center justify-between gap-2">
        <div className="flex h-9 w-fit max-w-full items-center gap-1 overflow-hidden rounded-md bg-muted/50 p-0.5">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-32" />
        </div>
        <Skeleton className="size-8 shrink-0" />
      </div>

      <MembersTableSkeleton count={5} showActions />
    </>
  );
}
