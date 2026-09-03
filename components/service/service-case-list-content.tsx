"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { MapPin, Plus, Search, Siren } from "lucide-react";

import { useBanner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { InlinePending } from "@/components/ui/inline-pending";
import { Input } from "@/components/ui/input";
import { ListRow } from "@/components/ui/list-row";
import { PendingRow } from "@/components/ui/pending-row";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Skeleton } from "@/components/ui/skeleton";
import type { SkeletonColumn } from "@/components/ui/skeleton-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import {
  ServiceCaseFormDialog,
  type ServiceCaseCreateSubmission,
  type ServiceCasePendingDraft,
} from "./service-case-form-dialog";

// The page mounts the create button in its own Suspense tree beside the
// heading, so a submission reaches the list through this module channel
// instead of props. The list is the one listener: it renders the pending
// row, settles through its live read, and shows the failure banner.
const submissionListeners = new Set<(submission: ServiceCaseCreateSubmission) => void>();
function announceSubmission(submission: ServiceCaseCreateSubmission): void {
  for (const listener of submissionListeners) listener(submission);
}

// One column definition for the loaded table and its skeleton (design canon):
// header count, widths and hover cannot drift apart.
const TWO_LINE_CELL = <span className="block space-y-1.5"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-24" /></span>;
export const SERVICE_CASE_COLUMNS: readonly SkeletonColumn[] = [
  { id: "case", header: "Servicefall", skeleton: TWO_LINE_CELL },
  { id: "site", header: "Kunde & Einsatzort", skeleton: TWO_LINE_CELL },
  { id: "urgency", header: "Dringlichkeit", className: "w-36", skeleton: <Skeleton className="h-4 w-16" /> },
  { id: "status", header: "Status", className: "w-44", skeleton: <Skeleton className="h-6 w-24" /> },
];

function serviceCaseHref(caseNumber: string): string {
  return `/service/faelle/${encodeURIComponent(caseNumber)}`;
}

export function ServiceCaseListContent({
  initialCases,
  clients,
}: {
  initialCases: ServiceCaseListItem[];
  clients: ServiceCaseClientOption[];
}): ReactElement {
  const router = useRouter();
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
  const { showBanner } = useBanner();
  const [pendingCreates, setPendingCreates] = useState<ServiceCasePendingDraft[]>([]);
  const liveRefresh = live.refresh;
  const liveInvalidate = live.invalidate;
  useEffect(() => {
    const listener = ({ draft, result }: ServiceCaseCreateSubmission) => {
      liveInvalidate();
      setPendingCreates((current) => [...current, draft]);
      void result
        .then(async (outcome) => {
          if (outcome.success) await liveRefresh();
          else showBanner({ variant: "error", message: outcome.message });
        })
        .finally(() => setPendingCreates((current) => current.filter((item) => item.id !== draft.id)));
    };
    submissionListeners.add(listener);
    return () => {
      submissionListeners.delete(listener);
    };
  }, [liveInvalidate, liveRefresh, showBanner]);
  // The list is newest first, so a new record leads; a Realtime read that
  // arrives before the settle read drops the placeholder by id.
  const visiblePending = pendingCreates.filter((draft) => !cases.some((item) => item.id === draft.id));
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
        {/* Twelve options: at or above ten the registry requires a searchable control. */}
        <div className="w-full md:w-60">
          <SearchableSelect
            ariaLabel="Servicefälle nach Status filtern"
            value={status}
            onChange={(value) => setStatus(value as ServiceCaseStatus | "open" | "all")}
            options={[
              { value: "open", label: "Offene Servicefälle" },
              { value: "all", label: "Alle Status" },
              ...SERVICE_CASE_STATUSES.map((value) => ({ value, label: SERVICE_CASE_STATUS_LABELS[value] })),
            ]}
            searchPlaceholder="Status suchen"
            emptyMessage="Kein passender Status"
          />
        </div>
      </div>
      {filtered.length === 0 && visiblePending.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-12 text-center">
          <Siren className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-semibold">Keine passenden Servicefälle</h2>
          <p className="mt-1 text-sm text-muted-foreground">Erfasse einen direkten Servicefall oder passe den Filter an.</p>
        </div>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {visiblePending.map((draft) => (
              <ListRow key={draft.id} role="status" aria-label="Wird gespeichert" data-pending-row="" className="opacity-70">
                <span className="min-w-0 flex-1"><span className="flex items-center gap-2 font-medium"><InlinePending active /><span className="truncate">{draft.summary}</span></span><span className="block truncate text-xs text-muted-foreground">{draft.clientName} · {draft.siteName}</span></span>
                <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium">{SERVICE_CASE_STATUS_LABELS[draft.status]}</span>
              </ListRow>
            ))}
            {filtered.map((item) => (
              <ListRow key={item.id} asChild interactive>
                <Link href={serviceCaseHref(item.caseNumber)}>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{item.summary}</span><span className="block truncate text-xs text-muted-foreground">{item.caseNumber} · {item.clientName} · {item.siteName}</span></span>
                  <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium">{SERVICE_CASE_STATUS_LABELS[item.status]}</span>
                </Link>
              </ListRow>
            ))}
          </div>
          <div className="hidden rounded-lg border shadow-xs md:block">
            <Table>
              <TableHeader><TableRow>{SERVICE_CASE_COLUMNS.map((column) => <TableHead key={column.id} className={column.className}>{column.header}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {visiblePending.map((draft) => (
                  <PendingRow
                    key={draft.id}
                    columns={SERVICE_CASE_COLUMNS}
                    cells={{
                      case: <span><span className="block font-medium">{draft.summary}</span><Skeleton className="mt-1 h-3 w-24" /></span>,
                      site: <span><span className="block">{draft.clientName}</span><span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3 shrink-0" />{draft.siteName}</span></span>,
                      urgency: SERVICE_CASE_URGENCY_LABELS[draft.urgency],
                      status: <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{SERVICE_CASE_STATUS_LABELS[draft.status]}</span>,
                    }}
                  />
                ))}
                {filtered.map((item) => {
                  const href = serviceCaseHref(item.caseNumber);
                  return (
                    <TableRow key={item.id} interactive onClick={() => router.push(href)}>
                      <TableCell><Link href={href} className="font-medium" onClick={(event) => event.stopPropagation()}>{item.summary}</Link><span className="block text-xs text-muted-foreground">{item.caseNumber}{item.equipment.length ? ` · ${item.equipment.length} Anlage${item.equipment.length === 1 ? "" : "n"}` : ""}</span></TableCell>
                      <TableCell><span className="block">{item.clientName}</span><span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3 shrink-0" />{item.siteName}</span></TableCell>
                      <TableCell>{SERVICE_CASE_URGENCY_LABELS[item.urgency]}</TableCell>
                      <TableCell><span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{SERVICE_CASE_STATUS_LABELS[item.status]}</span></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      <Button type="button" className="fixed bottom-6 right-6 shadow-lg md:hidden" onClick={() => setCreateOpen(true)}><Plus className="size-4" />Servicefall erfassen</Button>
      {createOpen && <ServiceCaseFormDialog open onOpenChange={setCreateOpen} clients={clients} onSubmitted={announceSubmission} />}
    </>
  );
}
export function ServiceCaseCreateButton({ clients }: { clients: ServiceCaseClientOption[] }): ReactElement {
  const [open, setOpen] = useState(false);
  return <><Button type="button" onClick={() => setOpen(true)}><Plus className="size-4" />Servicefall erfassen</Button>{open && <ServiceCaseFormDialog open onOpenChange={setOpen} clients={clients} onSubmitted={announceSubmission} />}</>;
}
