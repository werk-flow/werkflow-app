import { Skeleton } from "@/components/ui/skeleton";

export function ServiceCasesPageSkeleton() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-label="Servicefälle werden geladen"
    >
      <span className="sr-only">Servicefälle werden geladen.</span>
      <Skeleton className="h-9 w-72 max-w-full" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}
