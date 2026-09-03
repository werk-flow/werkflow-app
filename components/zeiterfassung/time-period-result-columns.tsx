import { Skeleton } from '@/components/ui/skeleton';
import type { SkeletonColumn } from '@/components/ui/skeleton-table';

const NUMERIC_CELL = <Skeleton className="h-4 w-16" />;

// Shared by the period detail page (a server component) and its route
// skeleton, so header count and labels cannot drift apart. Result rows do
// nothing on click, so neither they nor their skeletons hover.
export const TIME_PERIOD_RESULT_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'employee', header: 'Mitarbeiter/in', skeleton: <Skeleton className="h-4 w-36" /> },
  { id: 'target', header: 'Soll', skeleton: NUMERIC_CELL },
  { id: 'credited', header: 'Gewertet', skeleton: NUMERIC_CELL },
  { id: 'delta', header: 'Differenz', skeleton: NUMERIC_CELL },
  { id: 'closing', header: 'Schlusssaldo', skeleton: NUMERIC_CELL },
  { id: 'source', header: 'Sollquelle', skeleton: <Skeleton className="h-4 w-20" /> },
];
