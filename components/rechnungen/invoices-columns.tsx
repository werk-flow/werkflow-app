import { Skeleton } from '@/components/ui/skeleton';
import type { SkeletonColumn } from '@/components/ui/skeleton-table';

// Its own module, so the skeleton carries the columns and not the table's row code.
export const INVOICE_COLUMNS: readonly SkeletonColumn[] = [
  {
    id: 'number',
    header: 'Rechnungsnummer',
    className: 'w-[170px]',
    skeleton: <Skeleton className="h-4 w-24" />,
  },
  { id: 'client', header: 'Kunde', skeleton: <Skeleton className="h-4 w-2/3" /> },
  { id: 'status', header: 'Status', className: 'w-[130px]', skeleton: <Skeleton className="h-5 w-16" /> },
  {
    id: 'gross',
    header: 'Brutto',
    className: 'w-[140px] text-right',
    skeleton: <Skeleton className="ml-auto h-4 w-20" />,
  },
  { id: 'updated', header: 'Geändert', className: 'w-[120px]', skeleton: <Skeleton className="h-4 w-20" /> },
];
