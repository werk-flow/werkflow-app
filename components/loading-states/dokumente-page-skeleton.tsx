'use client';

import { DocumentTableSkeleton } from '@/components/dokumente/document-library-table';
import { WorkContextSkeleton } from '@/components/dokumente/document-work-context-view';
import { PageHeaderActions } from '@/components/shared/page-action';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export const DOKUMENTE_SUBTITLE = 'Organisiere Dateien, Bilder, Verträge und Auftragsdokumente an einem Ort.';

type DokumenteSkeletonView = 'folders' | 'work' | 'all' | 'trash';

function DokumenteTableRowsSkeleton({ rowCount = 10 }: { rowCount?: number }) {
  return <DocumentTableSkeleton rowCount={rowCount} />;
}

function DokumenteWorkContextSkeleton() {
  return <WorkContextSkeleton />;
}

export function DokumenteTabContentSkeleton({ view }: { view: DokumenteSkeletonView }) {
  if (view === 'work') {
    return <DokumenteWorkContextSkeleton />;
  }

  return <DokumenteTableRowsSkeleton rowCount={10} />;
}

// Same geometry as the library body in document-library-content.tsx. The
// page owns the header; like the library, this fills its action slot.
export function DokumenteContentSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeaderActions>
        <Skeleton className="h-9 w-52" />
      </PageHeaderActions>

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
      <PageHeader
        title="Dokumente"
        subtitle={DOKUMENTE_SUBTITLE}
        actions={<Skeleton className="h-9 w-52" />}
      />
      <PageBody>
        <DokumenteContentSkeleton />
      </PageBody>
    </PageShell>
  );
}
