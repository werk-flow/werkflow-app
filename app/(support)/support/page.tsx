import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  SUPPORT_AREA,
  SUPPORT_QUEUE_SUBTITLE,
  SUPPORT_QUEUE_TITLE,
} from '@/components/loading-states/support-page-skeletons';
import { ProblemReportSignalsLive } from '@/components/problem-reports/problem-report-signals-live';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SupportQueue } from '@/components/support/support-queue';
import { SupportQueueSkeleton } from '@/components/support/support-queue-columns';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { listSupportProblemReports } from '@/lib/problem-reports/support-actions';
import { isSupportRefusal } from '@/lib/problem-reports/support-messages';
import { parseSupportQueueQuery } from '@/lib/problem-reports/support-queue-query';

type QueueSearchParams = Promise<Record<string, string | string[] | undefined>>;

// The queue reads per request through its action, which admits the caller as
// support itself.
async function QueueData({ searchParams }: { searchParams: QueueSearchParams }) {
  const query = parseSupportQueueQuery(await searchParams);
  const result = await listSupportProblemReports(query);
  if (!result.success) {
    if (isSupportRefusal(result.error)) notFound();
    return (
      <RegionLoadError title="Die Meldungen konnten nicht geladen werden">
        Die Liste ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  return (
    <>
      <ProblemReportSignalsLive />
      <SupportQueue page={result.page} query={query} />
    </>
  );
}

export default function SupportQueuePage({ searchParams }: { searchParams: QueueSearchParams }) {
  return (
    <PageShell>
      <PageHeader
        eyebrow={SUPPORT_AREA}
        title={SUPPORT_QUEUE_TITLE}
        subtitle={SUPPORT_QUEUE_SUBTITLE}
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton label="Meldungen aktualisieren" />
            <Button asChild>
              <Link href="/support/aufnehmen">Meldung aufnehmen</Link>
            </Button>
          </div>
        }
      />
      <PageBody>
        <Suspense fallback={<SupportQueueSkeleton />}>
          <QueueData searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </PageShell>
  );
}
