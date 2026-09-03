import { InlinePending } from '@/components/ui/inline-pending';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow, type TableRowInteractive } from '@/components/ui/table';
import type { SkeletonColumn } from '@/components/ui/skeleton-table';

/**
 * The row a table shows for a record the user just created, while the server
 * confirms it. It sits where the real row will land (the caller inserts it
 * through the list's own sort), keeps every other row on screen, and is the
 * replacement for the "whole table turns into a skeleton after my own
 * action" pattern the owner rejected (feedback canon, 2026-09-03). Pass the
 * draft's known values through `cells`; unknown ones (a server-generated
 * number) stay bars.
 */
export function PendingRow({
  columns,
  cells,
  interactive,
  label = 'Wird gespeichert',
}: {
  columns: readonly SkeletonColumn[];
  cells?: Partial<Record<string, React.ReactNode>>;
  interactive?: TableRowInteractive;
  label?: string;
}) {
  return (
    <TableRow
      interactive={interactive}
      role="status"
      aria-label={label}
      data-pending-row=""
      className="opacity-70"
    >
      {columns.map((column, index) => (
        <TableCell key={column.id} className={column.className}>
          <span className="flex items-center gap-2">
            {index === 0 && <InlinePending active label={label} />}
            {cells?.[column.id] ?? column.skeleton ?? <Skeleton className="h-4 w-24" />}
          </span>
        </TableCell>
      ))}
    </TableRow>
  );
}
