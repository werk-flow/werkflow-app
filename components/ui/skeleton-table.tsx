import type { ReactNode } from 'react';

import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type TableRowInteractive,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Skeletons that share their shape with the table they stand in for. A list
 * component exports its column definition once and renders both its rows and
 * `SkeletonRows` from it, so header count, cell count, responsive breakpoints
 * and hover behavior cannot drift apart (design canon, 2026-09-03). The
 * Dokumente skeleton was the hand-built proof of the idea; this is the
 * structural version.
 */
export interface SkeletonColumn {
  id: string;
  header: ReactNode;
  /** Classes on both `<th>` and `<td>`: widths and responsive visibility. */
  className?: string;
  /** Placeholder content; defaults to one text bar. */
  skeleton?: ReactNode;
}

const DEFAULT_CELL = <Skeleton className="h-4 w-24" />;

export function SkeletonRows({
  columns,
  rows = 8,
  interactive,
}: {
  columns: readonly SkeletonColumn[];
  rows?: number;
  interactive?: TableRowInteractive;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <TableRow key={rowIndex} skeleton interactive={interactive}>
          {columns.map((column) => (
            <TableCell key={column.id} className={column.className}>
              {column.skeleton ?? DEFAULT_CELL}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function SkeletonTable({
  columns,
  rows = 8,
  interactive,
  className,
}: {
  columns: readonly SkeletonColumn[];
  rows?: number;
  interactive?: TableRowInteractive;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.id} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <SkeletonRows columns={columns} rows={rows} interactive={interactive} />
        </TableBody>
      </Table>
    </div>
  );
}

/** Mobile card list placeholder built on `ListRow`, so its hover equals the loaded rows'. */
export function SkeletonList({
  count = 6,
  interactive,
  className,
  children,
}: {
  count?: number;
  interactive?: boolean;
  className?: string;
  /** Row content; defaults to a title bar and a meta bar. */
  children?: ReactNode;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: count }, (_, index) => (
        <ListRow key={index} skeleton interactive={interactive}>
          {children ?? (
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          )}
        </ListRow>
      ))}
    </div>
  );
}
