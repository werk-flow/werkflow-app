"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { CalendarClock, ClipboardList, FileCheck2, MapPin, Pencil, Plus } from "lucide-react";

import { useBanner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { InlinePending } from "@/components/ui/inline-pending";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { SkeletonColumn } from "@/components/ui/skeleton-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBusyIds } from "@/hooks/use-busy-id";
import { useLiveView } from "@/hooks/use-live-view";
import { getMaintenanceWorkspace } from "@/lib/maintenance/actions";
import {
  MAINTENANCE_COVERAGE_STATUS_LABELS,
  MAINTENANCE_DUE_STATUS_LABELS,
  MAINTENANCE_PLAN_STATUS_LABELS,
  MAINTENANCE_RENEWAL_SIGNAL_LABELS,
  type MaintenanceDueItem,
  type MaintenancePlanItem,
  type MaintenanceWorkspace,
} from "@/lib/maintenance/types";
import { MaintenanceCoverageDialog, type MaintenanceCoverageCreateSubmission, type MaintenanceCoveragePendingDraft } from "./maintenance-coverage-dialog";
import { MaintenanceCoverageDocumentsDialog } from "./maintenance-coverage-documents-dialog";
import { MaintenanceCoverageFollowUpDialog } from "./maintenance-coverage-follow-up-dialog";
import { MaintenanceDueActionDialog } from "./maintenance-due-action-dialog";
import { MaintenancePlanActionDialog } from "./maintenance-plan-action-dialog";
import { MaintenancePlanDialog, type MaintenancePlanCreateSubmission, type MaintenancePlanPendingDraft } from "./maintenance-plan-dialog";

type MaintenanceCreateSubmission = MaintenancePlanCreateSubmission | MaintenanceCoverageCreateSubmission;
type MaintenancePendingDraft = MaintenancePlanPendingDraft | MaintenanceCoveragePendingDraft;

// The page mounts the create buttons in their own Suspense tree beside the
// heading, so a submission reaches the workspace through this module channel
// instead of props. The workspace is the one listener: it renders the pending
// card or row, settles through its live read, and shows the failure banner.
const submissionListeners = new Set<(submission: MaintenanceCreateSubmission) => void>();
function announceSubmission(submission: MaintenanceCreateSubmission): void {
  for (const listener of submissionListeners) listener(submission);
}

const dateFormatter = new Intl.DateTimeFormat("de-DE");
function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(`${value}T12:00:00Z`)) : "Nicht festgelegt";
}

// One column definition for the due list header and its skeleton (design canon).
const TWO_LINE_CELL = <span className="block space-y-1.5"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-24" /></span>;
export const MAINTENANCE_DUE_COLUMNS: readonly SkeletonColumn[] = [
  { id: "due", header: "Fälligkeit", className: "w-32", skeleton: TWO_LINE_CELL },
  { id: "plan", header: "Plan & Anlage", skeleton: TWO_LINE_CELL },
  { id: "client", header: "Kunde & Auftrag", skeleton: TWO_LINE_CELL },
  { id: "action", header: "Aktion", className: "w-40", skeleton: <Skeleton className="h-8 w-28" /> },
];

type PlanAction = {
  plan: MaintenancePlanItem;
  toStatus?: "active" | "suspended" | "terminated";
  archived?: boolean;
};

type DueAction = {
  due: MaintenanceDueItem;
  defaultAction: "create_visit" | "schedule" | "complete";
};

export function MaintenanceContent({ initial }: { initial: MaintenanceWorkspace }): ReactElement {
  const [search, setSearch] = useState("");
  const [coverageDocuments, setCoverageDocuments] = useState<MaintenanceWorkspace["coverages"][number] | null>(null);
  const [coverageFollowUp, setCoverageFollowUp] = useState<MaintenanceWorkspace["coverages"][number] | null>(null);
  const [editPlan, setEditPlan] = useState<MaintenancePlanItem | null>(null);
  const [planAction, setPlanAction] = useState<PlanAction | null>(null);
  const [dueAction, setDueAction] = useState<DueAction | null>(null);
  const live = useLiveView({
    tables: ["maintenance_coverages", "maintenance_plans", "maintenance_due_work"],
    initialData: initial,
    read: async () => {
      const result = await getMaintenanceWorkspace();
      return result.success
        ? { ok: true as const, data: result.workspace }
        : { ok: false as const, error: result.error };
    },
  });
  const workspace = live.data ?? initial;
  const { showBanner } = useBanner();
  // Row- and card-scoped settle window after a dialog action: the touched
  // plan or due row shows the indicator until the live read lands.
  const settling = useBusyIds();
  const settleOn = (id: string) => () => void settling.run(id, live.refresh);
  const [pendingCreates, setPendingCreates] = useState<MaintenancePendingDraft[]>([]);
  const liveRefresh = live.refresh;
  const liveInvalidate = live.invalidate;
  useEffect(() => {
    const listener = ({ draft, result }: MaintenanceCreateSubmission) => {
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
  // Both lists are newest first, so a new record leads; a Realtime read that
  // arrives before the settle read drops the placeholder by id.
  const pendingPlans = pendingCreates.filter((draft): draft is MaintenancePlanPendingDraft => draft.kind === "plan" && !workspace.plans.some((plan) => plan.id === draft.id));
  const pendingCoverages = pendingCreates.filter((draft): draft is MaintenanceCoveragePendingDraft => draft.kind === "coverage" && !workspace.coverages.some((coverage) => coverage.id === draft.id));
  const needle = search.trim().toLocaleLowerCase("de-DE");
  const plans = useMemo(
    () => workspace.plans.filter((plan) =>
      !needle || [plan.planNumber, plan.clientName, plan.siteName, plan.templateName, ...plan.equipment.map((item) => `${item.equipmentNumber} ${item.name}`)]
        .join(" ")
        .toLocaleLowerCase("de-DE")
        .includes(needle),
    ),
    [needle, workspace.plans],
  );
  const dueWork = useMemo(
    () => workspace.dueWork.filter((due) =>
      !needle || [due.planNumber, due.clientName, due.siteName, due.jobNumber, ...due.equipment.map((item) => `${item.equipmentNumber} ${item.name}`)]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("de-DE")
        .includes(needle),
    ),
    [needle, workspace.dueWork],
  );
  const openDue = dueWork.filter((due) => ["open", "visit_created"].includes(due.status));

  return (
    <>
      {live.isStale && <p role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">Die Wartungsdaten konnten nicht aktualisiert werden.</p>}
      <Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Wartung durchsuchen" placeholder="Plan, Kunde, Einsatzort, Auftrag oder Anlage suchen…" />
      <Tabs defaultValue="due" className="gap-4">
        <TabsList aria-label="Wartungsbereiche">
          <TabsTrigger value="due">Fälligkeiten <span className="text-xs text-muted-foreground">{openDue.length}</span></TabsTrigger>
          <TabsTrigger value="plans">Pläne <span className="text-xs text-muted-foreground">{plans.length}</span></TabsTrigger>
          <TabsTrigger value="coverages">Abdeckungen <span className="text-xs text-muted-foreground">{workspace.coverages.length}</span></TabsTrigger>
        </TabsList>
        <TabsContent value="due" className="space-y-3">
          {openDue.length === 0 ? (
            <EmptyState icon={<CalendarClock className="size-8" />} title="Keine offenen Wartungsfälligkeiten" description="Aktiviere einen Wartungsplan, damit Fälligkeiten für die nächsten 18 Monate erzeugt werden." />
          ) : (
            <div className="overflow-hidden rounded-lg border shadow-xs">
              <div className="hidden grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid">{MAINTENANCE_DUE_COLUMNS.map((column) => <span key={column.id}>{column.header}</span>)}</div>
              <div className="divide-y">
                {openDue.map((due) => {
                  const plan = workspace.plans.find((item) => item.id === due.planId);
                  return (
                    <div key={due.id} data-testid="maintenance-due-row" data-due-date={due.dueDate} className="grid gap-3 px-4 py-3 md:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-4">
                      <span><span className="block font-medium">{formatDate(due.dueDate)}</span><span className="text-xs text-muted-foreground">{MAINTENANCE_DUE_STATUS_LABELS[due.status]}</span></span>
                      <span className="min-w-0"><span className="block truncate font-medium">{due.planNumber}</span><span className="block truncate text-xs text-muted-foreground">{due.equipment.map((item) => item.name).join(", ")}</span></span>
                      <span className="min-w-0 text-sm"><span className="block truncate">{due.clientName}</span><span className="flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="size-3 shrink-0" />{due.siteName}{due.jobNumber ? ` · Auftrag ${due.jobNumber}` : ""}</span></span>
                      <fieldset disabled={settling.isBusy(due.id)} className="flex items-center gap-2 md:justify-end">
                        <InlinePending active={settling.isBusy(due.id)} label="Änderungen werden übernommen" />
                        {due.status === "open" ? <Button type="button" size="sm" onClick={() => setDueAction({ due, defaultAction: "create_visit" })}>Auftrag anlegen</Button> : !due.planningOccurrenceId ? <Button type="button" size="sm" variant="outline" onClick={() => setDueAction({ due, defaultAction: "schedule" })}>Termin planen</Button> : <Button type="button" size="sm" onClick={() => setDueAction({ due, defaultAction: "complete" })}>Abschließen</Button>}
                        {plan && due.status === "visit_created" && <Button type="button" size="sm" variant="ghost" onClick={() => setDueAction({ due, defaultAction: "complete" })}>Weitere Aktionen</Button>}
                      </fieldset>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </TabsContent>
        <TabsContent value="plans" className="space-y-3">
          {plans.length === 0 && pendingPlans.length === 0 ? (
            <EmptyState icon={<ClipboardList className="size-8" />} title="Noch keine Wartungspläne" description="Lege den ersten Plan aus Kunde, Einsatzort, Anlagen und einer veröffentlichten Arbeitsvorlage an." />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {pendingPlans.map((draft) => (
                <section key={draft.id} role="status" aria-label="Wird gespeichert" data-pending-row="" className="rounded-lg border p-4 opacity-70 shadow-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><h2 className="flex items-center gap-2 font-semibold"><InlinePending active />Wartungsplan wird gespeichert</h2><p className="mt-0.5 truncate text-sm text-muted-foreground">{draft.clientName} · {draft.siteName}</p></div>
                    <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{MAINTENANCE_PLAN_STATUS_LABELS[draft.status]}</span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div><dt className="text-xs text-muted-foreground">Arbeitsvorlage</dt><dd>{draft.templateName}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Rhythmus</dt><dd>Alle {draft.intervalMonths} Monate</dd></div>
                  </dl>
                </section>
              ))}
              {plans.map((plan) => (
                <section key={plan.id} data-testid="maintenance-plan-card" className="rounded-lg border p-4 shadow-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><h2 className="truncate font-semibold">{plan.planNumber}</h2><p className="mt-0.5 truncate text-sm text-muted-foreground">{plan.clientName} · {plan.siteName}</p></div>
                    <span className="flex shrink-0 items-center gap-2"><InlinePending active={settling.isBusy(plan.id)} label="Änderungen werden übernommen" /><span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{plan.archivedAt ? "Archiviert" : MAINTENANCE_PLAN_STATUS_LABELS[plan.status]}</span></span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div><dt className="text-xs text-muted-foreground">Arbeitsvorlage</dt><dd>{plan.templateName} · Rev. {plan.revisionNumber}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Rhythmus</dt><dd>Alle {plan.intervalMonths} Monate</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Nächste Fälligkeit</dt><dd>{formatDate(plan.nextDueDate)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Offene Fälligkeiten</dt><dd>{plan.openDueCount}</dd></div>
                    <div className="col-span-2"><dt className="text-xs text-muted-foreground">Anlagen</dt><dd>{plan.equipment.map((item) => `${item.equipmentNumber} · ${item.name}`).join(", ")}</dd></div>
                  </dl>
                  <fieldset disabled={settling.isBusy(plan.id)} className="mt-4 flex flex-wrap gap-2 border-t pt-3">
                    {!plan.archivedAt && plan.status !== "terminated" && <Button type="button" size="sm" variant="outline" onClick={() => setEditPlan(plan)}><Pencil className="size-3.5" />Überarbeiten</Button>}
                    {plan.status === "draft" && <Button type="button" size="sm" onClick={() => setPlanAction({ plan, toStatus: "active" })}>Aktivieren</Button>}
                    {plan.status === "active" && <Button type="button" size="sm" variant="outline" onClick={() => setPlanAction({ plan, toStatus: "suspended" })}>Pausieren</Button>}
                    {plan.status === "suspended" && <Button type="button" size="sm" onClick={() => setPlanAction({ plan, toStatus: "active" })}>Fortsetzen</Button>}
                    {plan.status !== "terminated" && <Button type="button" size="sm" variant="ghost" onClick={() => setPlanAction({ plan, toStatus: "terminated" })}>Beenden</Button>}
                    {plan.status === "terminated" && <Button type="button" size="sm" variant="outline" onClick={() => setPlanAction({ plan, archived: !plan.archivedAt })}>{plan.archivedAt ? "Wiederherstellen" : "Archivieren"}</Button>}
                  </fieldset>
                </section>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="coverages" className="space-y-3">
          {workspace.coverages.length === 0 && pendingCoverages.length === 0 ? (
            <EmptyState icon={<FileCheck2 className="size-8" />} title="Keine operativen Abdeckungen" description="Erfasse bestätigte Vertrags- und Fristdaten, wenn ein Plan darauf Bezug nehmen soll." />
          ) : (
            <div className="overflow-hidden rounded-lg border shadow-xs">
              <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-4 border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid"><span>Abdeckung</span><span>Kunde & Einsatzort</span><span>Wiedervorlage</span><span>Aktion</span></div>
              <div className="divide-y">
                {pendingCoverages.map((draft) => (
                  <div key={draft.id} role="status" aria-label="Wird gespeichert" data-pending-row="" className="grid gap-2 px-4 py-3 opacity-70 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-center md:gap-4">
                    <span className="flex items-center gap-2"><InlinePending active /><span><span className="block font-medium">Abdeckung wird gespeichert</span><span className="text-xs text-muted-foreground">{draft.reference ?? "Keine Referenz"}</span></span></span>
                    <span className="text-sm"><span className="block">{draft.clientName}</span><span className="text-xs text-muted-foreground">{draft.siteName}</span></span>
                  </div>
                ))}
                {workspace.coverages.map((coverage) => (
                  <div key={coverage.id} data-testid="maintenance-coverage-row" className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-center md:gap-4">
                    <span><span className="block font-medium">{coverage.coverageNumber}</span><span className="text-xs text-muted-foreground">{coverage.reference ?? "Keine Referenz"} · {MAINTENANCE_COVERAGE_STATUS_LABELS[coverage.status]}</span></span>
                    <span className="text-sm"><span className="block">{coverage.clientName}</span><span className="text-xs text-muted-foreground">{coverage.siteName}</span></span>
                    <span className="text-sm"><span className="block">{MAINTENANCE_RENEWAL_SIGNAL_LABELS[coverage.renewalSignal]}</span><span className="text-xs text-muted-foreground">{formatDate(coverage.reviewDueDate)}</span></span>
                    <span className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setCoverageFollowUp(coverage)}>Wiedervorlage</Button><Button type="button" size="sm" variant="outline" onClick={() => setCoverageDocuments(coverage)}>Dokumente</Button></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
      {coverageDocuments && <MaintenanceCoverageDocumentsDialog open onOpenChange={(open) => { if (!open) setCoverageDocuments(null); }} coverage={coverageDocuments} />}
      {coverageFollowUp && <MaintenanceCoverageFollowUpDialog open onOpenChange={(open) => { if (!open) setCoverageFollowUp(null); }} coverage={coverageFollowUp} currentActorId={workspace.currentActorId} owners={workspace.followUpOwners} />}
      {editPlan && <MaintenancePlanDialog open onOpenChange={(open) => { if (!open) setEditPlan(null); }} clients={workspace.clients} templates={workspace.templates} coverages={workspace.coverages} initial={editPlan} onSaved={settleOn(editPlan.id)} />}
      {planAction && <MaintenancePlanActionDialog open onOpenChange={(open) => { if (!open) setPlanAction(null); }} {...planAction} onSaved={settleOn(planAction.plan.id)} />}
      {dueAction && <MaintenanceDueActionDialog open onOpenChange={(open) => { if (!open) setDueAction(null); }} due={dueAction.due} defaultAction={dueAction.defaultAction} plannedDurationMinutes={workspace.plans.find((plan) => plan.id === dueAction.due.planId)?.plannedDurationMinutes ?? 120} serviceCases={workspace.serviceCases.filter((serviceCase) => serviceCase.clientId === dueAction.due.clientId && serviceCase.siteId === dueAction.due.siteId)} onSaved={settleOn(dueAction.due.id)} />}
    </>
  );
}

/** The toolbar actions; the page renders them beside the h2, ahead of the workspace. */
export function MaintenanceCreateButtons({ clients, templates, coverages }: Pick<MaintenanceWorkspace, "clients" | "templates" | "coverages">): ReactElement {
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [coverageDialogOpen, setCoverageDialogOpen] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={() => setCoverageDialogOpen(true)}><FileCheck2 className="size-4" />Abdeckung erfassen</Button>
      <Button type="button" onClick={() => setPlanDialogOpen(true)}><Plus className="size-4" />Wartungsplan anlegen</Button>
      {planDialogOpen && <MaintenancePlanDialog open onOpenChange={setPlanDialogOpen} clients={clients} templates={templates} coverages={coverages} onSubmitted={announceSubmission} />}
      {coverageDialogOpen && <MaintenanceCoverageDialog open onOpenChange={setCoverageDialogOpen} clients={clients} onSubmitted={announceSubmission} />}
    </div>
  );
}

function EmptyState({ icon, title, description }: { icon: ReactElement; title: string; description: string }): ReactElement {
  return <div className="rounded-lg border border-dashed px-6 py-12 text-center"><span className="mx-auto block w-fit text-muted-foreground">{icon}</span><h2 className="mt-3 text-lg font-semibold">{title}</h2><p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{description}</p></div>;
}
