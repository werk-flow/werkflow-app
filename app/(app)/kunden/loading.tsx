import { Skeleton } from '@/components/ui/skeleton';
import { KundenContentSkeleton } from '@/components/loading-states/kunden-content-skeleton';

export default function KundenLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b bg-background px-4 py-3 sm:px-6 sm:py-4 sticky top-0 z-10 shrink-0">
        <h1 className="text-xl font-bold sm:text-2xl">Kunden</h1>
        <Skeleton className="h-9 w-28 sm:w-44" />
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <KundenContentSkeleton />
      </div>
    </div>
  );
}
