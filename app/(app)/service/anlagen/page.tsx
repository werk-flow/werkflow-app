import { cache, Suspense } from "react";
import { redirect } from "next/navigation";

import { EquipmentListSkeleton } from "@/components/loading-states/equipment-page-skeleton";
import {
  EquipmentCreateButton,
  EquipmentListContent,
} from "@/components/service/equipment-list-content";
import { Skeleton } from "@/components/ui/skeleton";
import { getInstalledEquipmentList } from "@/lib/installed-equipment/actions";

// One request-scoped read shared by the toolbar action and the list, so the
// static toolbar paints before the data and the list still loads once.
const loadEquipment = cache(getInstalledEquipmentList);

export default function InstalledEquipmentPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Anlagen & Geräte</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Installierte Anlagen an Kundeneinsatzorten mit Kennungen, Dokumenten
            und Servicehistorie.
          </p>
        </div>
        <div className="hidden md:block">
          <Suspense fallback={<Skeleton className="h-9 w-40" />}>
            <EquipmentCreateAction />
          </Suspense>
        </div>
      </div>
      <Suspense fallback={<EquipmentListSkeleton />}>
        <EquipmentList />
      </Suspense>
    </div>
  );
}

async function EquipmentCreateAction() {
  const result = await loadEquipment();
  if (!result.success) return null;
  return (
    <EquipmentCreateButton
      equipment={result.equipment}
      clients={result.clients}
    />
  );
}

async function EquipmentList() {
  const result = await loadEquipment();
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
    <EquipmentListContent
      initialEquipment={result.equipment}
      clients={result.clients}
    />
  );
}
