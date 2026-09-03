import { cache, Suspense } from "react";
import { redirect } from "next/navigation";

import { MaintenanceContentSkeleton } from "@/components/loading-states/maintenance-page-skeleton";
import {
  MaintenanceContent,
  MaintenanceCreateButtons,
} from "@/components/service/maintenance-content";
import { Skeleton } from "@/components/ui/skeleton";
import { getMaintenanceWorkspace } from "@/lib/maintenance/actions";

// One request-scoped read shared by the toolbar actions and the workspace, so
// the static toolbar paints before the data and the workspace still loads once.
const loadMaintenanceWorkspace = cache(getMaintenanceWorkspace);

export default function MaintenancePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Wartung</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Wiederkehrende Wartung pro Einsatzort planen, fällige Arbeit in
            Aufträge überführen und mit versionierten Nachweisen abschließen.
          </p>
        </div>
        <Suspense
          fallback={
            <div className="flex gap-2">
              <Skeleton className="h-9 w-44" />
              <Skeleton className="h-9 w-48" />
            </div>
          }
        >
          <MaintenanceActions />
        </Suspense>
      </div>
      <Suspense fallback={<MaintenanceContentSkeleton />}>
        <MaintenanceWorkspace />
      </Suspense>
    </div>
  );
}

async function MaintenanceActions() {
  const result = await loadMaintenanceWorkspace();
  if (!result.success) return null;
  return (
    <MaintenanceCreateButtons
      clients={result.workspace.clients}
      templates={result.workspace.templates}
      coverages={result.workspace.coverages}
    />
  );
}

async function MaintenanceWorkspace() {
  const result = await loadMaintenanceWorkspace();
  if (!result.success) {
    if (result.error === "not_authorized") redirect("/auftraege");
    if (result.error === "not_authenticated") redirect("/login");
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
      >
        {result.error === "no_active_org"
          ? "Es ist keine aktive Organisation ausgewählt."
          : result.error === "not_a_member"
            ? "Du bist kein Mitglied der ausgewählten Organisation."
            : "Die Wartungsübersicht konnte nicht geladen werden."}
      </p>
    );
  }
  return <MaintenanceContent initial={result.workspace} />;
}
