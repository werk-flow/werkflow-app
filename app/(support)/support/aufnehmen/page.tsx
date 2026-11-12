import { Suspense } from 'react';
import { notFound } from 'next/navigation';

import {
  SUPPORT_AREA,
  SUPPORT_FILING_SUBTITLE,
  SUPPORT_FILING_TITLE,
  SUPPORT_QUEUE_CRUMB,
  SupportFilingFormSkeleton,
} from '@/components/loading-states/support-page-skeletons';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SupportFilingForm } from '@/components/support/support-filing-form';
import { listSupportFilingOptions } from '@/lib/problem-reports/support-actions';
import { isSupportRefusal } from '@/lib/problem-reports/support-messages';
import { isUuid } from '@/lib/validation/uuid';

type FilingSearchParams = Promise<Record<string, string | string[] | undefined>>;

// The organizations, and the members of the one the address names, read per
// request through their action, which admits the caller as support itself.
async function FilingData({ searchParams }: { searchParams: FilingSearchParams }) {
  const { organisation } = await searchParams;
  const organizationId = typeof organisation === 'string' && isUuid(organisation) ? organisation : null;
  const result = await listSupportFilingOptions(organizationId);
  if (!result.success) {
    if (isSupportRefusal(result.error)) notFound();
    return (
      <RegionLoadError title="Die Organisationen konnten nicht geladen werden">
        Die Auswahl ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  const known = result.options.organizations.some((organization) => organization.id === organizationId);
  return <SupportFilingForm options={result.options} organizationId={known ? organizationId : null} />;
}

export default function SupportFilingPage({ searchParams }: { searchParams: FilingSearchParams }) {
  return (
    <PageShell>
      <PageHeader
        eyebrow={SUPPORT_AREA}
        breadcrumbs={[SUPPORT_QUEUE_CRUMB, { label: SUPPORT_FILING_TITLE }]}
        title={SUPPORT_FILING_TITLE}
        subtitle={SUPPORT_FILING_SUBTITLE}
      />
      <PageBody maxWidth="content">
        <Suspense fallback={<SupportFilingFormSkeleton />}>
          <FilingData searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </PageShell>
  );
}
