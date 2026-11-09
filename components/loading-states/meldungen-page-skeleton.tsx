import { OwnProblemReportListSkeleton } from '@/components/problem-reports/own-problem-report-list';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';

export const MELDUNGEN_TITLE = 'Meine Meldungen';
export const MELDUNGEN_SUBTITLE = 'Was du dem WerkFlow-Support gemeldet hast, mit Stand und Antwort.';

// Mirrors the page: its header and the report list's own skeleton.
export function MeldungenPageSkeleton() {
  return (
    <PageShell>
      <PageHeader title={MELDUNGEN_TITLE} subtitle={MELDUNGEN_SUBTITLE} />
      <PageBody>
        <OwnProblemReportListSkeleton />
      </PageBody>
    </PageShell>
  );
}
