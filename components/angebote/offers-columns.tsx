import { Skeleton } from '@/components/ui/skeleton';
import type { SkeletonColumn } from '@/components/ui/skeleton-table';

// Its own module, so the skeleton carries the columns and not the table's row code.
export const OFFER_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'number', header: 'Nr.', className: 'w-[140px]', skeleton: <Skeleton className="h-4 w-24" /> },
  { id: 'title', header: 'Angebot', skeleton: <Skeleton className="h-4 w-2/3" /> },
  { id: 'client', header: 'Kunde', className: 'w-[240px]', skeleton: <Skeleton className="h-4 w-32" /> },
  { id: 'status', header: 'Status', className: 'w-[130px]', skeleton: <Skeleton className="h-5 w-16" /> },
  { id: 'valid', header: 'Gültig bis', className: 'w-[120px]', skeleton: <Skeleton className="h-4 w-20" /> },
];
