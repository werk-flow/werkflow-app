import { Skeleton } from '@/components/ui/skeleton';
import { hiddenHeader, type SkeletonColumn } from '@/components/ui/skeleton-table';

// Its own module, so the skeleton (which the organization switch overlay of
// every page loads) carries the columns and not the table's row code.
// One column definition for the loaded table and its skeleton.
export const LEISTUNG_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'number', header: 'Nr.', className: 'w-[110px]', skeleton: <Skeleton className="h-4 w-14" /> },
  { id: 'name', header: 'Leistung', skeleton: <Skeleton className="h-4 w-2/3" /> },
  { id: 'kind', header: 'Art', className: 'w-[130px]', skeleton: <Skeleton className="h-4 w-20" /> },
  {
    id: 'price',
    header: 'Verkaufspreis',
    className: 'w-[180px] text-right',
    skeleton: <Skeleton className="ml-auto h-4 w-24" />,
  },
  {
    id: 'cost',
    header: 'Kostensatz',
    className: 'w-[150px] text-right',
    skeleton: <Skeleton className="ml-auto h-4 w-20" />,
  },
  { id: 'tax', header: 'MwSt.', className: 'w-[80px]', skeleton: <Skeleton className="h-4 w-10" /> },
  {
    id: 'actions',
    header: hiddenHeader('Aktionen'),
    className: 'w-[56px]',
    skeleton: <Skeleton className="h-8 w-8" />,
  },
];
