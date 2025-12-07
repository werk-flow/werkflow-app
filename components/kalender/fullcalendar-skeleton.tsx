import { Skeleton } from '@/components/ui/skeleton';
import type { CalendarView } from './calendar-container';

interface FullCalendarSkeletonProps {
  view: CalendarView;
}

export function FullCalendarSkeleton({ view }: FullCalendarSkeletonProps) {
  if (view === 'day') {
    return <DayGridSkeleton />;
  }

  if (view === 'week') {
    return <WeekGridSkeleton />;
  }

  return <MonthGridSkeleton />;
}

function DayGridSkeleton() {
  const hours = Array.from({ length: 16 }, (_, i) => i + 6); // 6am to 10pm

  return (
    <div className="p-4">
      <div className="rounded-2xl border bg-card overflow-hidden shadow-lg">
        {/* Header */}
        <div className="bg-muted/30 p-3 border-b">
          <Skeleton className="h-5 w-32 mx-auto" />
        </div>

        {/* Time slots */}
        <div className="divide-y">
          {hours.map((hour) => (
            <div key={hour} className="flex h-11">
              <div className="w-16 shrink-0 border-r p-2 bg-muted/10">
                <Skeleton className="h-3 w-10" />
              </div>
              <div className="flex-1 relative">
                {Math.random() > 0.7 && (
                  <Skeleton
                    className="absolute top-1 h-9 rounded"
                    style={{
                      left: '8px',
                      width: `${40 + Math.random() * 40}%`
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WeekGridSkeleton() {
  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const hours = Array.from({ length: 16 }, (_, i) => i + 6);

  return (
    <div className="p-4">
      <div className="rounded-2xl border bg-card overflow-hidden shadow-lg">
        {/* Header with days */}
        <div className="grid grid-cols-[60px_repeat(7,_1fr)] bg-muted/30 border-b">
          <div className="p-2 border-r" />
          {days.map((day, i) => (
            <div
              key={i}
              className="p-2 border-r last:border-r-0 flex flex-col items-center gap-1"
            >
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-5 w-5 rounded-full" />
            </div>
          ))}
        </div>

        {/* Time grid */}
        <div className="divide-y max-h-[500px] overflow-hidden">
          {hours.slice(0, 10).map((hour) => (
            <div
              key={hour}
              className="grid grid-cols-[60px_repeat(7,_1fr)] h-11"
            >
              <div className="border-r p-1 bg-muted/10">
                <Skeleton className="h-3 w-8" />
              </div>
              {days.map((_, dayIdx) => (
                <div key={dayIdx} className="border-r last:border-r-0 relative">
                  {Math.random() > 0.85 && (
                    <Skeleton className="absolute inset-1 rounded" />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthGridSkeleton() {
  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const weeks = 5;

  return (
    <div className="p-4">
      <div className="rounded-2xl border bg-card overflow-hidden shadow-lg">
        {/* Header with day names */}
        <div className="grid grid-cols-7 bg-muted/30 border-b">
          {days.map((day, i) => (
            <div key={i} className="p-3 border-r last:border-r-0 text-center">
              <Skeleton className="h-4 w-8 mx-auto" />
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        {Array.from({ length: weeks }).map((_, weekIdx) => (
          <div
            key={weekIdx}
            className="grid grid-cols-7 border-b last:border-b-0"
          >
            {days.map((_, dayIdx) => (
              <div
                key={dayIdx}
                className="h-[120px] p-2 border-r last:border-r-0"
              >
                {/* Day number */}
                <Skeleton className="h-5 w-5 rounded-full mb-2" />

                {/* Random entries */}
                <div className="space-y-1">
                  {Array.from({
                    length: Math.floor(Math.random() * 3)
                  }).map((_, entryIdx) => (
                    <Skeleton key={entryIdx} className="h-5 w-full rounded" />
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
