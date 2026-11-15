import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { WeeklyNumbersView } from '@/components/kennzahlen/weekly-numbers-view';
import {
  KENNZAHLEN_SUBTITLE,
  KENNZAHLEN_TITLE,
  KennzahlenContentSkeleton,
} from '@/components/loading-states/kennzahlen-page-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { resolvePageMembership } from '@/lib/org/page-context';
import { readWeeklyOutcomeNumbers } from '@/lib/weekly-numbers/reads';

async function WeeklyNumbersData() {
  const result = await readWeeklyOutcomeNumbers();
  if (!result.success) {
    return (
      <RegionLoadError title="Die Wochenzahlen konnten nicht geladen werden">
        Die Zahlen sind gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  return <WeeklyNumbersView weeks={result.weeks} />;
}

// Only Admin sees the company's weekly numbers (werk-flow/werkflow-planning#278).
// Büro and field workers go to the dashboard before any read; the reader
// checks the Admin again.
export default async function KennzahlenPage() {
  const { membership } = await resolvePageMembership();

  if (!membership) {
    return (
      <PageShell>
        <PageHeader title={KENNZAHLEN_TITLE} />
        <PageBody>
          <p className="text-muted-foreground">Bitte wähle zuerst eine Organisation aus.</p>
        </PageBody>
      </PageShell>
    );
  }
  if (membership.role !== 'admin') redirect('/dashboard');

  return (
    <PageShell>
      <PageHeader title={KENNZAHLEN_TITLE} subtitle={KENNZAHLEN_SUBTITLE} />
      <PageBody>
        <Suspense fallback={<KennzahlenContentSkeleton />}>
          <WeeklyNumbersData />
        </Suspense>
      </PageBody>
    </PageShell>
  );
}
