import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const SECTION_KEYS = [0, 1] as const;
const ROW_KEYS = [0, 1, 2] as const;

/** Mirrors the office start's sections: headings over a card of task rows and the „Alle in Aufgaben“ link. */
export function OfficeStartSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      {SECTION_KEYS.map((section) => (
        <div key={section} className="space-y-2">
          <div className="flex items-center gap-1.5 px-1">
            <Skeleton className="size-4" />
            <Skeleton className="h-4 w-36" />
          </div>
          <Card className="gap-0 divide-y py-0">
            {ROW_KEYS.map((row) => (
              <div key={row} className="space-y-1.5 px-4 py-3">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
            ))}
            <div className="flex justify-end px-4 py-2">
              <Skeleton className="h-8 w-32" />
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}

/** Mirrors the überfällige Wartung below the sections: a heading over one row. */
export function OverdueMaintenanceSkeleton({ testIdPrefix }: { testIdPrefix: string }) {
  return (
    <div
      className="space-y-2"
      aria-hidden="true"
      data-testid={`${testIdPrefix}-overdue-maintenance-placeholder`}
    >
      <div className="flex items-center gap-1.5 px-1">
        <Skeleton className="size-4" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Card className="gap-0 py-0">
        <div className="space-y-1.5 px-4 py-3">
          <Skeleton className="h-4 w-40 max-w-full" />
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
      </Card>
    </div>
  );
}
