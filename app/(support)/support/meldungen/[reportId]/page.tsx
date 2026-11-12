import { Suspense } from 'react';
import { notFound } from 'next/navigation';

import {
  SUPPORT_AREA,
  SUPPORT_QUEUE_CRUMB,
  SupportReportPageSkeleton,
} from '@/components/loading-states/support-page-skeletons';
import { ProblemReportSignalsLive } from '@/components/problem-reports/problem-report-signals-live';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SupportReportDetail } from '@/components/support/support-report-detail';
import { RefreshButton } from '@/components/ui/refresh-button';
import { readSupportProblemReport } from '@/lib/problem-reports/support-actions';
import { isSupportRefusal } from '@/lib/problem-reports/support-messages';

type ReportParams = Promise<{ reportId: string }>;

// One report, read per request through its action, which admits the caller
// as support itself. An id that names no report is the not-found page.
async function ReportData({ params }: { params: ReportParams }) {
  const { reportId } = await params;
  const result = await readSupportProblemReport(reportId);
  if (!result.success) {
    if (
      isSupportRefusal(result.error) ||
      result.error === 'report_not_found' ||
      result.error === 'invalid_input'
    )
      notFound();
    return (
      <PageShell>
        <PageHeader eyebrow={SUPPORT_AREA} breadcrumbs={[SUPPORT_QUEUE_CRUMB]} title="Meldung" />
        <PageBody>
          <RegionLoadError title="Die Meldung konnte nicht geladen werden">
            Sie ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
          </RegionLoadError>
        </PageBody>
      </PageShell>
    );
  }
  const { report } = result;
  const name = `Nr. ${report.number}`;
  return (
    <PageShell>
      <PageHeader
        eyebrow={SUPPORT_AREA}
        breadcrumbs={[SUPPORT_QUEUE_CRUMB, { label: name }]}
        title={`Meldung ${name}`}
        subtitle={report.organizationName}
        actions={<RefreshButton label="Meldung aktualisieren" />}
      />
      <PageBody>
        <SupportReportDetail key={report.id} report={report} />
      </PageBody>
    </PageShell>
  );
}

export default function SupportReportPage({ params }: { params: ReportParams }) {
  return (
    <>
      {/* Outside the report's read, so a later signal still reads a failed report again. */}
      <ProblemReportSignalsLive />
      <Suspense fallback={<SupportReportPageSkeleton />}>
        <ReportData params={params} />
      </Suspense>
    </>
  );
}
