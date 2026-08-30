import { redirect } from "next/navigation";

import {
  EquipmentCreateButton,
  EquipmentListContent,
} from "@/components/service/equipment-list-content";
import { getInstalledEquipmentList } from "@/lib/installed-equipment/actions";
import { ServiceNavigation } from "@/components/service/service-navigation";

export default async function InstalledEquipmentPage() {
  const result = await getInstalledEquipmentList();
  if (!result.success) {
    if (result.error === "not_authorized") redirect("/auftraege");
    if (
      result.error === "not_authenticated" ||
      result.error === "no_active_org" ||
      result.error === "not_a_member"
    ) {
      redirect("/login");
    }
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Anlagen und Geräte konnten nicht geladen werden.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ServiceNavigation />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Anlagen & Geräte</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Installierte Anlagen an Kundeneinsatzorten mit Kennungen, Dokumenten
            und Servicehistorie.
          </p>
        </div>
        <div className="hidden md:block">
          <EquipmentCreateButton
            equipment={result.equipment}
            clients={result.clients}
          />
        </div>
      </div>
      <EquipmentListContent
        initialEquipment={result.equipment}
        clients={result.clients}
      />
    </div>
  );
}
