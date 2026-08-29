import { notFound, redirect } from "next/navigation";

import { EquipmentDetailContent } from "@/components/service/equipment-detail-content";
import { getEquipmentDocuments } from "@/lib/documents/actions";
import {
  getInstalledEquipmentDetailByNumber,
  getInstalledEquipmentList,
} from "@/lib/installed-equipment/actions";
import { getJobsForClient } from "@/lib/jobs/actions";

type InstalledEquipmentDetailPageProps = {
  params: Promise<{ equipmentNumber: string }>;
};

export default async function InstalledEquipmentDetailPage({
  params,
}: InstalledEquipmentDetailPageProps) {
  const { equipmentNumber } = await params;
  const detailResult = await getInstalledEquipmentDetailByNumber(
    decodeURIComponent(equipmentNumber),
  );
  if (!detailResult.success) {
    if (detailResult.error === "not_authorized") redirect("/auftraege");
    if (
      detailResult.error === "not_authenticated" ||
      detailResult.error === "no_active_org" ||
      detailResult.error === "not_a_member"
    ) {
      redirect("/login");
    }
    notFound();
  }
  const [documentsResult, listResult, workResult] = await Promise.all([
    getEquipmentDocuments(detailResult.equipment.id),
    getInstalledEquipmentList(),
    getJobsForClient(detailResult.equipment.clientId),
  ]);
  return (
    <EquipmentDetailContent
      initial={detailResult.equipment}
      documents={documentsResult.success ? documentsResult.documents : []}
      documentsLoadFailed={!documentsResult.success}
      clients={listResult.success ? listResult.clients : []}
      equipmentList={listResult.success ? listResult.equipment : []}
      jobs={workResult.success ? workResult.jobs : []}
      projects={workResult.success ? workResult.projects : []}
    />
  );
}
