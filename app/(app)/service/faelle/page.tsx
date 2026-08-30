import { redirect } from "next/navigation";

import {
  ServiceCaseCreateButton,
  ServiceCaseListContent,
} from "@/components/service/service-case-list-content";
import { ServiceNavigation } from "@/components/service/service-navigation";
import { getServiceCaseList } from "@/lib/service-cases/actions";

export default async function ServiceCasesPage() {
  const result = await getServiceCaseList();
  if (!result.success) {
    if (result.error === "not_authorized") redirect("/auftraege");
    if (["not_authenticated", "no_active_org", "not_a_member"].includes(result.error)) redirect("/login");
    return <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Servicefälle konnten nicht geladen werden.</p>;
  }
  return (
    <div className="space-y-6">
      <ServiceNavigation />
      <div className="flex items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold">Servicefälle</h1><p className="mt-1 text-sm text-muted-foreground">Störungen, Reparaturen und vermutete Gewährleistungsfälle vom Eingang bis zur Nacharbeit.</p></div>
        <div className="hidden md:block"><ServiceCaseCreateButton clients={result.workspace.clients} /></div>
      </div>
      <ServiceCaseListContent initialCases={result.workspace.cases} clients={result.workspace.clients} />
    </div>
  );
}
