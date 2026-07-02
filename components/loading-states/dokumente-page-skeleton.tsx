import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type DokumenteSkeletonView = 'folders' | 'work' | 'all' | 'trash';

function SkeletonSelectionCircle({ visible = false }: { visible?: boolean }) {
  return (
    <span
      className={[
        'flex size-5 items-center justify-center rounded-full border border-muted-foreground/45 bg-background transition-opacity',
        visible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
      ].join(' ')}
    />
  );
}

export function DokumenteTableRowsSkeleton({
  rowCount = 10,
}: {
  rowCount?: number;
}) {
  return (
    <>
      <div className="relative -mx-4 hidden min-h-[50vh] flex-1 select-none px-4 sm:-mx-6 sm:px-6 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[36px]">
                <SkeletonSelectionCircle visible />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">
                Erstellt / Hochgeladen von
              </TableHead>
              <TableHead className="hidden w-[140px] sm:table-cell">
                Datum
              </TableHead>
              <TableHead className="hidden w-[110px] sm:table-cell">
                Größe
              </TableHead>
              <TableHead className="hidden w-[120px] lg:table-cell">
                Typ
              </TableHead>
              <TableHead className="hidden xl:table-cell">
                Verknüpft mit
              </TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rowCount }).map((_, index) => (
              <TableRow
                key={index}
                aria-hidden="true"
                className="group cursor-default transition-colors hover:bg-accent/50"
              >
                <TableCell>
                  <SkeletonSelectionCircle />
                </TableCell>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2">
                    <Skeleton className="size-4 shrink-0 rounded-sm" />
                    <Skeleton className="h-4 w-52 max-w-[75%]" />
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Skeleton className="h-4 w-36 max-w-full" />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Skeleton className="h-4 w-14" />
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <Skeleton className="h-4 w-16" />
                </TableCell>
                <TableCell className="hidden xl:table-cell">
                  <div className="flex max-w-64 gap-1">
                    <Skeleton className="h-5 w-20 rounded-full" />
                    {index % 3 === 0 && (
                      <Skeleton className="h-5 w-16 rounded-full" />
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Skeleton className="ml-auto size-8 rounded-md" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2 md:hidden">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            aria-hidden="true"
            className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5"
          >
            <Skeleton className="size-5 shrink-0 rounded-sm" />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Skeleton className="size-4 shrink-0 rounded-sm" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
            </div>
            <Skeleton className="size-8 shrink-0 rounded-md" />
          </div>
        ))}
      </div>
    </>
  );
}

function DokumenteWorkContextSkeleton() {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[44px]" />
              <TableHead>Verknüpfung</TableHead>
              <TableHead className="hidden lg:table-cell">Typ</TableHead>
              <TableHead>Dokumente</TableHead>
              <TableHead className="w-[52px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 8 }).map((_, index) => (
              <TableRow
                key={index}
                aria-hidden="true"
                className="group cursor-default transition-colors hover:bg-accent/50"
              >
                <TableCell className="w-[44px] pr-0">
                  <Skeleton className="size-6 rounded-sm" />
                </TableCell>
                <TableCell>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-60 max-w-[75%]" />
                    <Skeleton className="h-3 w-36 max-w-[55%]" />
                  </div>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-4 w-44 max-w-[65%]" />
                  </div>
                </TableCell>
                <TableCell>
                  <Skeleton className="ml-auto size-8 rounded-md" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 md:hidden">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            aria-hidden="true"
            className="rounded-lg border bg-card px-3 py-2.5"
          >
            <div className="flex items-start gap-2">
              <Skeleton className="mt-0.5 size-5 shrink-0 rounded-sm" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-44 max-w-full" />
                <div className="flex flex-wrap gap-2">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-4 w-32 max-w-full" />
                </div>
              </div>
              <Skeleton className="size-7 shrink-0 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
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

export function DokumentePageSkeleton() {
  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-col gap-4 rounded-lg p-2">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Skeleton className="h-7 w-32 sm:h-8" />
          <Skeleton className="mt-2 h-4 w-96 max-w-full" />
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
