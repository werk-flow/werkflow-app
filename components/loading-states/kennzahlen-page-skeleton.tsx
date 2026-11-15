import { WEEKLY_NUMBER_ROW_COUNT, WEEKLY_NUMBER_COLUMNS } from '@/components/kennzahlen/weekly-numbers-view';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonTable } from '@/components/ui/skeleton-table';
import { WEEKLY_NUMBER_SECTIONS } from '@/lib/weekly-numbers/format';

/** The page's title and subtitle, shared with the loaded page so the header never jumps. */
export const KENNZAHLEN_TITLE = 'Wochenzahlen';
export const KENNZAHLEN_SUBTITLE =
  'Die Zahlen der ganzen Firma aus den letzten 12 Wochen, nie für einzelne Personen.';

// Mirrors `WeeklyNumbersView`: week cards on the phone, the table of numbers
// and weeks from the tablet breakpoint. Nothing in it is clickable, so nothing hovers.
export function KennzahlenContentSkeleton() {
  return (
    <>
      <SkeletonList count={2} className="space-y-3 md:hidden">
        <div className="w-full space-y-3">
          <Skeleton className="h-5 w-40" />
          {WEEKLY_NUMBER_SECTIONS.map((section) => (
            <div key={section.id} className="space-y-1 border-t pt-2">
              <Skeleton className="h-3 w-32" />
              {section.rows.map((row) => (
                <div key={row.id} className="flex justify-between gap-3">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-4 w-8" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </SkeletonList>
      <SkeletonTable
        columns={WEEKLY_NUMBER_COLUMNS}
        rows={WEEKLY_NUMBER_ROW_COUNT}
        className="hidden border-0 md:block"
      />
    </>
  );
}

export function KennzahlenPageSkeleton() {
  return (
    <PageShell>
      <PageHeader title={KENNZAHLEN_TITLE} subtitle={KENNZAHLEN_SUBTITLE} />
      <PageBody>
        <KennzahlenContentSkeleton />
      </PageBody>
    </PageShell>
  );
}
