"use client";

import Link from "next/link";
import { useMemo, useState, type ReactElement } from "react";
import { MapPin, Plus, Search, Siren } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLiveView } from "@/hooks/use-live-view";
import { getServiceCaseList } from "@/lib/service-cases/actions";
import {
  SERVICE_CASE_STATUSES,
  SERVICE_CASE_STATUS_LABELS,
  SERVICE_CASE_URGENCY_LABELS,
  type ServiceCaseClientOption,
  type ServiceCaseListItem,
  type ServiceCaseStatus,
} from "@/lib/service-cases/types";
import { ServiceCaseFormDialog } from "./service-case-form-dialog";

export function ServiceCaseListContent({
  initialCases,
  clients,
}: {
  initialCases: ServiceCaseListItem[];
  clients: ServiceCaseClientOption[];
}): ReactElement {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ServiceCaseStatus | "open" | "all">("open");
  const [createOpen, setCreateOpen] = useState(false);
  const live = useLiveView({
    tables: ["service_cases"],
    initialData: initialCases,
    read: async () => {
      const result = await getServiceCaseList();
      return result.success
        ? { ok: true as const, data: result.workspace.cases }
        : { ok: false as const, error: result.error };
    },
  });
  const cases = live.data ?? initialCases;
  const needle = search.trim().toLocaleLowerCase("de-DE");
  const filtered = useMemo(
    () =>
      cases.filter((item) => {
        if (status === "open" && ["resolved", "closed_without_visit", "duplicate"].includes(item.status)) return false;
        if (status !== "open" && status !== "all" && item.status !== status) return false;
        if (!needle) return true;
        return [item.caseNumber, item.summary, item.clientName, item.siteName, ...item.equipment.map((equipment) => `${equipment.equipmentNumber} ${equipment.name}`)].join(" ").toLocaleLowerCase("de-DE").includes(needle);
      }),
    [cases, needle, status],
  );

  return (
    <>
      {live.isStale && <p role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">Die angezeigten Servicefälle konnten nicht aktualisiert werden.</p>}
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" aria-label="Servicefälle durchsuchen" placeholder="Nummer, Kunde, Einsatzort oder Anlage suchen…" />
        </div>
        <Select value={status} onValueChange={(value) => setStatus(value as ServiceCaseStatus | "open" | "all")}>
          <SelectTrigger className="w-full md:w-60" aria-label="Servicefälle nach Status filtern"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="open">Offene Servicefälle</SelectItem><SelectItem value="all">Alle Status</SelectItem>{SERVICE_CASE_STATUSES.map((value) => <SelectItem key={value} value={value}>{SERVICE_CASE_STATUS_LABELS[value]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-12 text-center">
          <Siren className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-semibold">Keine passenden Servicefälle</h2>
          <p className="mt-1 text-sm text-muted-foreground">Erfasse einen direkten Servicefall oder passe den Filter an.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border shadow-xs">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] gap-4 border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid"><span>Servicefall</span><span>Kunde & Einsatzort</span><span>Dringlichkeit</span><span>Status</span></div>
          <div className="divide-y">
            {filtered.map((item) => (
              <Link key={item.id} href={`/service/faelle/${encodeURIComponent(item.caseNumber)}`} className="grid gap-2 px-4 py-3 transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] md:items-center md:gap-4">
                <span className="min-w-0"><span className="block truncate font-medium">{item.summary}</span><span className="block text-xs text-muted-foreground">{item.caseNumber}{item.equipment.length ? ` · ${item.equipment.length} Anlage${item.equipment.length === 1 ? "" : "n"}` : ""}</span></span>
                <span className="min-w-0 text-sm"><span className="block truncate">{item.clientName}</span><span className="flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="size-3 shrink-0" />{item.siteName}</span></span>
                <span className="text-sm">{SERVICE_CASE_URGENCY_LABELS[item.urgency]}</span>
                <span className="w-fit rounded-md bg-muted px-2 py-1 text-xs font-medium">{SERVICE_CASE_STATUS_LABELS[item.status]}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      <Button type="button" className="fixed bottom-6 right-6 shadow-lg md:hidden" onClick={() => setCreateOpen(true)}><Plus className="size-4" />Servicefall erfassen</Button>
      {createOpen && <ServiceCaseFormDialog open onOpenChange={setCreateOpen} clients={clients} />}
    </>
  );
}
export function ServiceCaseCreateButton({ clients }: { clients: ServiceCaseClientOption[] }): ReactElement {
  const [open, setOpen] = useState(false);
  return <><Button type="button" onClick={() => setOpen(true)}><Plus className="size-4" />Servicefall erfassen</Button>{open && <ServiceCaseFormDialog open onOpenChange={setOpen} clients={clients} />}</>;
}
