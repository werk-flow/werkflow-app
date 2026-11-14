import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';

/** The „Bereitschaft jetzt“ card: its header and one running shift. */
export function OnCallNowSkeleton() {
  return (
    <Card aria-hidden="true">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 rounded-lg border p-3">
          <Skeleton className="h-3 w-48" />
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-28" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** The office's week: header with its actions, the week switch and the shift rows. */
export function OnCallWeekSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Bereitschaft wird geladen">
      <span className="sr-only">Bereitschaft wird geladen.</span>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-48" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="size-9" />
        <Skeleton className="h-5 w-48" />
        <Skeleton className="size-9" />
      </div>
      <div className="divide-y rounded-lg border">
        {[0, 1, 2].map((row) => (
          <ListRow key={row} variant="plain" skeleton className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-80 max-w-full" />
              <Skeleton className="h-4 w-48" />
            </div>
            <Skeleton className="size-9" />
          </ListRow>
        ))}
      </div>
    </div>
  );
}
