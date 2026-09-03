import { Skeleton } from '@/components/ui/skeleton';
import type { SkeletonColumn } from '@/components/ui/skeleton-table';

// One column definition for the item table and its route skeleton, so header
// count, alignment, and widths cannot drift apart (design canon: skeletons
// share the list's column definition).
export const INVENTORY_ITEM_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'name', header: 'Artikel', skeleton: <Skeleton className="h-4 w-44 max-w-full" /> },
  { id: 'type', header: 'Typ', skeleton: <Skeleton className="h-5 w-20 rounded-full" /> },
  { id: 'location', header: 'Lager', skeleton: <Skeleton className="h-4 w-28" /> },
  {
    id: 'onHand',
    header: 'Bestand',
    className: 'text-right',
    skeleton: <Skeleton className="ml-auto h-4 w-16" />,
  },
  {
    id: 'planned',
    header: 'Geplant',
    className: 'text-right',
    skeleton: <Skeleton className="ml-auto h-4 w-16" />,
  },
  {
    id: 'available',
    header: 'Verfügbar',
    className: 'text-right',
    skeleton: <Skeleton className="ml-auto h-4 w-16" />,
  },
  { id: 'status', header: 'Status', skeleton: <Skeleton className="h-5 w-20 rounded-full" /> },
  {
    id: 'actions',
    header: null,
    className: 'w-10',
    skeleton: <Skeleton className="size-8 rounded-md" />,
  },
];
