import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The billing section's place while its browser-only chunk or its own read
 * loads. Without it the section showed nothing and no busy signal, then drew
 * in under content that looked settled.
 */
export function WorkBillingPartiesSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-lg border bg-card p-4 sm:p-5', className)}
      role="status"
      aria-label="Auftraggeber und Rechnung werden geladen"
    >
      <span className="sr-only">Auftraggeber und Rechnung werden geladen.</span>
      <Skeleton className="h-5 w-48" />
      <div className="mt-4 space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}
