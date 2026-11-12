import { DetailColumns } from '@/components/shared/detail-columns';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { SupportQueueSkeleton } from '@/components/support/support-queue-columns';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export const SUPPORT_AREA = 'WerkFlow Support';
export const SUPPORT_QUEUE_TITLE = 'Meldungen';
export const SUPPORT_QUEUE_SUBTITLE = 'Die Meldungen aller Organisationen, die älteste zuerst.';
export const SUPPORT_FILING_TITLE = 'Meldung aufnehmen';
export const SUPPORT_FILING_SUBTITLE =
  'Für jemanden, der angerufen hat. Die Person sieht die Meldung danach in „Meine Meldungen“.';
export const SUPPORT_QUEUE_CRUMB = { label: SUPPORT_QUEUE_TITLE, href: '/support' } as const;

/** Mirrors the queue page: its header and the list's own skeleton. */
export function SupportQueuePageSkeleton() {
  return (
    <PageShell>
      <PageHeader
        eyebrow={SUPPORT_AREA}
        title={SUPPORT_QUEUE_TITLE}
        subtitle={SUPPORT_QUEUE_SUBTITLE}
        actions={
          <div className="flex items-center gap-2">
            <Skeleton className="size-8" />
            <Skeleton className="h-9 w-40" />
          </div>
        }
      />
      <PageBody>
        <SupportQueueSkeleton />
      </PageBody>
    </PageShell>
  );
}

function CardSkeleton({ lines }: { lines: number }) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <Skeleton className="h-5 w-28" />
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} className="h-5 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

/** The four cards of a report's page, in the page's own columns. */
function SupportReportDetailSkeleton() {
  return (
    <DetailColumns layout="main-and-wide-aside">
      <div className="min-w-0 space-y-6">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={2} />
      </div>
      <div className="min-w-0 space-y-6">
        <CardSkeleton lines={5} />
        <CardSkeleton lines={3} />
      </div>
    </DetailColumns>
  );
}

/** Mirrors a report's page while its number is not known yet. */
export function SupportReportPageSkeleton() {
  return (
    <PageShell>
      <PageHeader
        eyebrow={SUPPORT_AREA}
        breadcrumbs={[SUPPORT_QUEUE_CRUMB]}
        title={<Skeleton className="h-7 w-64" />}
        actions={<Skeleton className="size-8" />}
      />
      <PageBody>
        <SupportReportDetailSkeleton />
      </PageBody>
    </PageShell>
  );
}

/** The filing form's fields. */
export function SupportFilingFormSkeleton() {
  return (
    <div className="space-y-4">
      {['w-28', 'w-40', 'w-56'].map((labelWidth, index) => (
        <div key={labelWidth} className="grid gap-2">
          <Skeleton className={`h-4 ${labelWidth}`} />
          <Skeleton className={index === 2 ? 'h-16 w-full' : 'h-9 w-full'} />
        </div>
      ))}
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-9 w-44" />
    </div>
  );
}

/** Mirrors the filing page. */
export function SupportFilingPageSkeleton() {
  return (
    <PageShell>
      <PageHeader
        eyebrow={SUPPORT_AREA}
        breadcrumbs={[SUPPORT_QUEUE_CRUMB, { label: SUPPORT_FILING_TITLE }]}
        title={SUPPORT_FILING_TITLE}
        subtitle={SUPPORT_FILING_SUBTITLE}
      />
      <PageBody maxWidth="content">
        <SupportFilingFormSkeleton />
      </PageBody>
    </PageShell>
  );
}
