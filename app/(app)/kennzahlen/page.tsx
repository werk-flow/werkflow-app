import { redirect } from 'next/navigation';

import { WeeklyNumbersView } from '@/components/kennzahlen/weekly-numbers-view';
import { KENNZAHLEN_SUBTITLE, KENNZAHLEN_TITLE } from '@/components/loading-states/kennzahlen-page-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { resolvePageMembership } from '@/lib/org/page-context';
import { readWeeklyOutcomeNumbers } from '@/lib/weekly-numbers/reads';

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

  const result = await readWeeklyOutcomeNumbers();
  // A failed read goes to the (app) error boundary, which every route already
  // loads: a client component of this page's own regroups the start-up chunks
  // of every route (werk-flow/werkflow-app#496).
  if (!result.success) throw new Error(`Failed to load weekly numbers: ${result.error}`);

  return (
    <PageShell>
      <PageHeader title={KENNZAHLEN_TITLE} subtitle={KENNZAHLEN_SUBTITLE} />
      <PageBody>
        <WeeklyNumbersView weeks={result.weeks} />
      </PageBody>
    </PageShell>
  );
}
