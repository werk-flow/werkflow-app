'use client';

import { ClientsTableSkeleton } from '@/components/kunden/clients-table';
import { Skeleton } from '@/components/ui/skeleton';

export function KundenContentSkeleton() {
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-8 w-8 rounded" />
      </div>

      <ClientsTableSkeleton count={5} />
    </>
  );
}
