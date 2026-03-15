import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function DashboardContentSkeleton() {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="space-y-2 rounded-lg border bg-muted/50 p-3">
            <Skeleton className="h-3 w-28" />
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="size-8" />
            </div>
            <Skeleton className="h-3 w-full" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
