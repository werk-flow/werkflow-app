import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { PlainButton } from '@/components/ui/plain-button';
import { TableHead } from '@/components/ui/table';

/** A table column head that sorts its list: the active column shows its direction. */
export function SortableTableHead<Column extends string>({
  label,
  column,
  currentColumn,
  currentDirection,
  onSort,
  className,
}: {
  label: ReactNode;
  column: Column;
  currentColumn: Column;
  currentDirection: 'asc' | 'desc';
  onSort: (column: Column) => void;
  className?: string | undefined;
}) {
  const isActive = currentColumn === column;
  return (
    <TableHead
      className={className}
      aria-sort={isActive ? (currentDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <PlainButton
        onClick={() => onSort(column)}
        className="-ml-1 flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground"
      >
        {label}
        {isActive ? (
          currentDirection === 'asc' ? (
            <ArrowUp className="size-3.5" />
          ) : (
            <ArrowDown className="size-3.5" />
          )
        ) : (
          <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
        )}
      </PlainButton>
    </TableHead>
  );
}
