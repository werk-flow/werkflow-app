import { cache, Suspense } from "react";
import { redirect } from "next/navigation";

import { ServiceCaseListSkeleton } from "@/components/loading-states/service-cases-page-skeleton";
import {
  ServiceCaseCreateButton,
  ServiceCaseListContent,
} from "@/components/service/service-case-list-content";
import { Skeleton } from "@/components/ui/skeleton";
import { getServiceCaseList } from "@/lib/service-cases/actions";

// One request-scoped read shared by the toolbar action and the list, so the
// static toolbar paints before the data and the workspace still loads once.
const loadServiceCases = cache(getServiceCaseList);

export default function ServiceCasesPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Servicefälle</h2><p className="mt-1 text-sm text-muted-foreground">Störungen, Reparaturen und vermutete Gewährleistungsfälle vom Eingang bis zur Nacharbeit.</p></div>
        <div className="hidden md:block">
          <Suspense fallback={<Skeleton className="h-9 w-44" />}>
            <ServiceCaseCreateAction />
          </Suspense>
        </div>
      </div>
      <Suspense fallback={<ServiceCaseListSkeleton />}>
        <ServiceCaseList />
      </Suspense>
    </div>
  );
}

async function ServiceCaseCreateAction() {
  const result = await loadServiceCases();
  if (!result.success) return null;
  return <ServiceCaseCreateButton clients={result.workspace.clients} />;
}

async function ServiceCaseList() {
  const result = await loadServiceCases();
  if (!result.success) {
    if (result.error === "not_authorized") redirect("/auftraege");
    if (["not_authenticated", "no_active_org", "not_a_member"].includes(result.error)) redirect("/login");
    return <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Servicefälle konnten nicht geladen werden.</p>;
  }
  return <ServiceCaseListContent initialCases={result.workspace.cases} clients={result.workspace.clients} />;
}
