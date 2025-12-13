import { Skeleton } from '@/components/ui/skeleton';

interface WeekViewSkeletonProps {
  memberCount?: number;
}

export function WeekViewSkeleton({ memberCount = 5 }: WeekViewSkeletonProps) {
  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  return (
    <div className="p-4">
      <div className="rounded-lg border overflow-hidden">
        {/* Header row with days */}
        <div className="grid grid-cols-[140px_repeat(7,_minmax(140px,_1fr))] border-b bg-muted/30">
          <div className="p-3 border-r">
            <Skeleton className="h-4 w-16" />
          </div>
          {days.map((day, i) => (
            <div
              key={i}
              className="p-3 border-r last:border-r-0 flex flex-col items-center gap-1"
            >
              <Skeleton className="h-4 w-6" />
              <Skeleton className="h-6 w-6 rounded-full" />
            </div>
          ))}
        </div>

        {/* Employee rows */}
        {Array.from({ length: memberCount }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="grid grid-cols-[140px_repeat(7,_minmax(140px,_1fr))] border-b last:border-b-0"
          >
            {/* Employee name column */}
            <div className="p-3 border-r bg-muted/10 space-y-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>

            {/* Day cells */}
            {days.map((_, dayIdx) => (
              <div
                key={dayIdx}
                className="min-h-[110px] p-1.5 border-r last:border-r-0"
              >
                <div className="space-y-1.5">
                  {/* Random number of entries per cell */}
                  {Array.from({
                    length: Math.floor(Math.random() * 2) + 1
                  }).map((_, entryIdx) => (
                    <Skeleton key={entryIdx} className="h-8 w-full rounded" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

