import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Apart from the week's skeletons, which the shell's organization switch
// loads on every page: the dashboard card alone renders this one.

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
