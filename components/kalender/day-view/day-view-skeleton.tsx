import { Skeleton } from '@/components/ui/skeleton';

interface DayViewSkeletonProps {
  memberCount?: number;
}

export function DayViewSkeleton({ memberCount = 5 }: DayViewSkeletonProps) {
  return (
    <div className="p-4">
      {/* Timeline header */}
      <div className="sticky top-0 z-10 bg-background border-b mb-4">
        <div className="flex">
          <div className="w-48 shrink-0 border-r bg-muted/30 px-3 py-2">
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="flex-1 h-8 bg-muted/10" />
        </div>
      </div>

      {/* Employee rows skeleton */}
      <div className="divide-y rounded-lg border overflow-hidden">
        {Array.from({ length: memberCount }).map((_, i) => (
          <div key={i} className="flex border-b last:border-b-0">
            <div className="w-48 shrink-0 border-r px-3 py-4 space-y-2 bg-muted/10">
              <Skeleton className="h-5 w-28" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
            <div className="flex-1 h-20 p-2 relative">
              <Skeleton
                className="absolute h-14 rounded-md"
                style={{
                  left: `${20 + i * 10}%`,
                  width: `${30 + (i % 3) * 10}%`
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
