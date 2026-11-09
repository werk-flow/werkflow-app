import { Suspense } from 'react';

import { MELDUNGEN_SUBTITLE, MELDUNGEN_TITLE } from '@/components/loading-states/meldungen-page-skeleton';
import { OwnProblemReportListSkeleton } from '@/components/problem-reports/own-problem-report-columns';
import { OwnProblemReportList } from '@/components/problem-reports/own-problem-report-list';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { listOwnProblemReports } from '@/lib/problem-reports/actions';

// Every role reads the reports they sent themselves, read per request: a
// status or an answer from support shows on the next open or refresh.
async function OwnProblemReports() {
  const result = await listOwnProblemReports();
  if (!result.success) {
    return (
      <RegionLoadError title="Deine Meldungen konnten nicht geladen werden">
        Die Liste ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  return <OwnProblemReportList reports={result.reports} />;
}

export default function MeldungenPage() {
  return (
    <PageShell>
      <PageHeader title={MELDUNGEN_TITLE} subtitle={MELDUNGEN_SUBTITLE} />
      <PageBody>
        <Suspense fallback={<OwnProblemReportListSkeleton />}>
          <OwnProblemReports />
        </Suspense>
      </PageBody>
    </PageShell>
  );
}
