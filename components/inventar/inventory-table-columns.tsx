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

const MOVEMENT_QUANTITY_CELL = <Skeleton className="ml-auto h-4 w-12" />;

// Movement rows do nothing on click, so neither they nor their skeletons hover.
export const INVENTORY_MOVEMENT_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'createdAt', header: 'Zeitpunkt', skeleton: <Skeleton className="h-4 w-28" /> },
  { id: 'item', header: 'Artikel', skeleton: <Skeleton className="h-4 w-40 max-w-full" /> },
  { id: 'location', header: 'Lager', skeleton: <Skeleton className="h-4 w-24" /> },
  { id: 'from', header: 'Von', skeleton: <Skeleton className="h-4 w-24" /> },
  { id: 'to', header: 'Nach', skeleton: <Skeleton className="h-4 w-24" /> },
  { id: 'movementType', header: 'Bewegung', skeleton: <Skeleton className="h-4 w-24" /> },
  { id: 'before', header: 'Vorher', className: 'text-right', skeleton: MOVEMENT_QUANTITY_CELL },
  { id: 'delta', header: 'Menge', className: 'text-right', skeleton: MOVEMENT_QUANTITY_CELL },
  { id: 'after', header: 'Danach', className: 'text-right', skeleton: MOVEMENT_QUANTITY_CELL },
  { id: 'reason', header: 'Grund', skeleton: <Skeleton className="h-4 w-32" /> },
];
