import { RegionLoadError } from '@/components/shared/region-load-error';
import { notFound, redirect } from 'next/navigation';

import { ServiceCaseDetailContent } from '@/components/service/service-case-detail-content';
import { getServiceCaseDetailByNumber } from '@/lib/service-cases/actions';
import { getServiceCaseDocuments } from '@/lib/documents/actions';

export default async function ServiceCasePage({ params }: { params: Promise<{ caseNumber: string }> }) {
  const { caseNumber } = await params;
  const result = await getServiceCaseDetailByNumber(decodeURIComponent(caseNumber));
  if (!result.success) {
    if (result.error === 'service_case_not_found') notFound();
    if (result.error === 'not_authorized') redirect('/auftraege');
    if (['not_authenticated', 'no_active_org', 'not_a_member'].includes(result.error)) redirect('/login');
    return (
      <RegionLoadError title="Der Servicefall konnte nicht geladen werden">
        Der Servicefall ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  const documentsResult = await getServiceCaseDocuments(result.workspace.serviceCase.id);
  return (
    <ServiceCaseDetailContent
      initial={result.workspace}
      documents={documentsResult.success ? documentsResult.documents : []}
      documentsLoadFailed={!documentsResult.success}
    />
  );
}
