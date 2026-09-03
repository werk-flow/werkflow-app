'use client';

import { DocumentTableSkeleton } from '@/components/dokumente/document-library-table';
import { WorkContextSkeleton } from '@/components/dokumente/document-work-context-view';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

type DokumenteSkeletonView = 'folders' | 'work' | 'all' | 'trash';

export function DokumenteTableRowsSkeleton({
  rowCount = 10,
}: {
  rowCount?: number;
}) {
  return <DocumentTableSkeleton rowCount={rowCount} />;
}

function DokumenteWorkContextSkeleton() {
  return <WorkContextSkeleton />;
}

export function DokumenteTabContentSkeleton({
  view,
}: {
  view: DokumenteSkeletonView;
}) {
  if (view === 'work') {
    return <DokumenteWorkContextSkeleton />;
  }

  return <DokumenteTableRowsSkeleton rowCount={10} />;
}

// Same geometry as the library body in document-library-content.tsx, which
// owns the title block; the page shell supplies padding and scroll.
export function DokumenteContentSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Dokumente</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organisiere Dateien, Bilder, Verträge und Auftragsdokumente an einem
            Ort.
          </p>
        </div>
        <Skeleton className="h-10 w-52 sm:mt-1" />
      </header>

      <div className="space-y-3 rounded-lg border bg-card p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-32" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-40" />
          </div>
        </div>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border px-3">
            <Skeleton className="size-4 shrink-0" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </div>
          <Skeleton className="h-9 w-24 shrink-0" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-2" />
        <Skeleton className="h-7 w-32" />
      </div>

      <DokumenteTableRowsSkeleton rowCount={9} />
    </div>
  );
}

export function DokumentePageSkeleton() {
  return (
    <PageShell>
      <PageBody>
        <DokumenteContentSkeleton />
      </PageBody>
    </PageShell>
  );
}
