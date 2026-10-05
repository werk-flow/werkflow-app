import { notFound, redirect } from 'next/navigation';

import { EquipmentDetailContent } from '@/components/service/equipment-detail-content';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { getEquipmentDocuments } from '@/lib/documents/actions';
import { getInstalledEquipmentDetailByNumber } from '@/lib/installed-equipment/actions';
import { getJobsForClient } from '@/lib/jobs/actions';

type InstalledEquipmentDetailPageProps = {
  params: Promise<{ equipmentNumber: string }>;
};

export default async function InstalledEquipmentDetailPage({ params }: InstalledEquipmentDetailPageProps) {
  const { equipmentNumber } = await params;
  const detailResult = await getInstalledEquipmentDetailByNumber(decodeURIComponent(equipmentNumber));
  if (!detailResult.success) {
    if (detailResult.error === 'not_authorized') redirect('/auftraege');
    if (
      detailResult.error === 'not_authenticated' ||
      detailResult.error === 'no_active_org' ||
      detailResult.error === 'not_a_member'
    ) {
      redirect('/login');
    }
    if (detailResult.error === 'installed_equipment_not_found') notFound();
    return (
      <RegionLoadError title="Die Anlage konnte nicht geladen werden">
        Die Anlage ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  const [documentsResult, workResult] = await Promise.all([
    getEquipmentDocuments(detailResult.equipment.id),
    getJobsForClient(detailResult.equipment.clientId),
  ]);
  return (
    <EquipmentDetailContent
      initial={detailResult.equipment}
      documents={documentsResult.success ? documentsResult.documents : []}
      documentsLoadFailed={!documentsResult.success}
      work={workResult.success ? { jobs: workResult.jobs, projects: workResult.projects } : null}
    />
  );
}
