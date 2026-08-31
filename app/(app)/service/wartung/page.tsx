import { redirect } from "next/navigation";

import { MaintenanceContent } from "@/components/service/maintenance-content";
import { ServiceNavigation } from "@/components/service/service-navigation";
import { getMaintenanceWorkspace } from "@/lib/maintenance/actions";

export default async function MaintenancePage() {
  const result = await getMaintenanceWorkspace();
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
  return (
    <div className="space-y-6">
      <ServiceNavigation />
      <div>
        <h1 className="text-2xl font-bold">Wartung</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Wiederkehrende Wartung pro Einsatzort planen, fällige Arbeit in
          Aufträge überführen und mit versionierten Nachweisen abschließen.
        </p>
      </div>
      <MaintenanceContent initial={result.workspace} />
    </div>
  );
}
