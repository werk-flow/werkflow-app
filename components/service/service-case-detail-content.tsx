"use client";
import { SectionError } from "@/components/ui/section-error";

import Link from "next/link";
import { useState, type ReactElement } from "react";
import { ArrowLeft, CalendarClock, ExternalLink, FileCheck2, History, LinkIcon, Loader2, MapPin, Pencil, Wrench } from "lucide-react";

import { ContextualDocumentsSection } from "@/components/dokumente/contextual-documents-section";
import { useBanner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/date-time-field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorText } from "@/components/ui/error-text";
import { Field } from "@/components/ui/field";
import { InlinePending } from "@/components/ui/inline-pending";
import { Input } from "@/components/ui/input";
import { ListRow } from "@/components/ui/list-row";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useBusyIds } from "@/hooks/use-busy-id";
import { useLiveView } from "@/hooks/use-live-view";
import { useServerAction } from "@/hooks/use-server-action";
import { createCustomerFollowUp } from "@/lib/customer-relationships/actions";
import { parseBerlinDateTimeInput, tomorrowMorningInBerlin } from "@/lib/customer-relationships/date-time";
import type { OrganizationDocument } from "@/lib/documents/types";
import { getServiceCaseDetailByNumber, linkServiceCaseEvidence, linkServiceCaseRelation } from "@/lib/service-cases/actions";
import {
  SERVICE_CASE_CHARGE_CONTEXT_LABELS,
  SERVICE_CASE_RELATION_LABELS,
  SERVICE_CASE_RELATION_TYPES,
  SERVICE_CASE_STATUS_LABELS,
  SERVICE_CASE_URGENCY_LABELS,
  type ServiceCaseDetailWorkspace,
  type ServiceCaseRelationType,
} from "@/lib/service-cases/types";
import { WORK_ARTIFACT_KIND_LABELS } from "@/lib/work-artifacts/types";
import { ServiceCaseFormDialog } from "./service-case-form-dialog";

const EVENT_LABELS: Record<string, string> = {
  created: "Servicefall erfasst",
  triage_updated: "Einschätzung geändert",
  status_changed: "Status geändert",
  job_linked: "Auftrag verknüpft",
  job_unlinked: "Auftragsverknüpfung entfernt",
  equipment_links_updated: "Betroffene Anlagen geändert",
  relation_linked: "Zusammenhang verknüpft",
  evidence_linked: "Arbeitsnachweis verknüpft",
  document_linked: "Dokument verknüpft",
  document_unlinked: "Dokumentverknüpfung entfernt",
};

const RELATION_ERRORS: Record<string, string> = {
  service_case_stale_version:
    "Der Servicefall wurde inzwischen geändert. Prüfe den aktuellen Stand und versuche es erneut.",
  service_case_relation_cycle:
    "Diese Verknüpfung würde einen widersprüchlichen Kreis erzeugen.",
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function Fact({ label, value }: { label: string; value: string | null | undefined }): ReactElement {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{value || "Nicht erfasst"}</dd></div>;
}

function RelationDialog({ workspace, open, onOpenChange, onSaved }: {
  workspace: ServiceCaseDetailWorkspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after success so the section settles through the live read. */
  onSaved: () => void;
}): ReactElement {
  const [relatedId, setRelatedId] = useState("");
  const [relationType, setRelationType] = useState<ServiceCaseRelationType>("related");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(async () => {
    const result = await linkServiceCaseRelation({
      serviceCaseId: workspace.serviceCase.id,
      relatedServiceCaseId: relatedId,
      relationType,
      expectedVersion: workspace.serviceCase.version,
      reason,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!result.success) {
      setError(
        RELATION_ERRORS[result.error] ??
          "Der Zusammenhang konnte nicht verknüpft werden.",
      );
      return;
    }
    onOpenChange(false);
    onSaved();
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Servicefälle verknüpfen</DialogTitle><DialogDescription>Beide Fälle bleiben eigenständig und vollständig nachvollziehbar.</DialogDescription></DialogHeader>
        <div className="space-y-4 py-2">
          <Field label="Servicefall" htmlFor="relation-case" required><SearchableSelect value={relatedId} onChange={setRelatedId} options={workspace.relatedCases.map((item) => ({ value: item.id, label: `${item.caseNumber} · ${item.summary}` }))} placeholder="Servicefall suchen" /></Field>
          <Field label="Beziehung" htmlFor="relation-type"><Select value={relationType} onValueChange={(value) => setRelationType(value as ServiceCaseRelationType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SERVICE_CASE_RELATION_TYPES.map((value) => <SelectItem key={value} value={value}>{SERVICE_CASE_RELATION_LABELS[value]}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Begründung" htmlFor="relation-reason" required><Input value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Abbrechen</Button><Button type="button" onClick={() => void run()} disabled={isPending || !relatedId || reason.trim().length < 3}>{isPending && <Loader2 className="size-4 animate-spin" />}Verknüpfen</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EvidenceDialog({ workspace, open, onOpenChange, onSaved }: {
  workspace: ServiceCaseDetailWorkspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after success so the section settles through the live read. */
  onSaved: () => void;
}): ReactElement {
  const [revisionId, setRevisionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(async () => {
    const result = await linkServiceCaseEvidence({
      serviceCaseId: workspace.serviceCase.id,
      workArtifactRevisionId: revisionId,
      expectedVersion: workspace.serviceCase.version,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!result.success) {
      setError("Der Arbeitsnachweis konnte nicht verknüpft werden.");
      return;
    }
    onOpenChange(false);
    onSaved();
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Arbeitsnachweis verknüpfen</DialogTitle><DialogDescription>Verknüpft wird genau diese Version aus dem zugeordneten Auftrag. Der Nachweis wird nicht kopiert.</DialogDescription></DialogHeader>
        <Field label="Nachweisversion" htmlFor="evidence-revision" required className="py-2">
          <SearchableSelect
            value={revisionId}
            onChange={setRevisionId}
            options={workspace.evidenceOptions.map((option) => ({
              value: option.revisionId,
              label: `${option.title} · ${WORK_ARTIFACT_KIND_LABELS[option.kind]} · Version ${option.revisionNumber}`,
            }))}
            placeholder="Arbeitsnachweis suchen"
            emptyMessage="Keine unverknüpfte Version gefunden"
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Abbrechen</Button><Button type="button" onClick={() => void run()} disabled={isPending || !revisionId}>{isPending && <Loader2 className="size-4 animate-spin" />}Verknüpfen</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FollowUpDialog({ workspace, open, onOpenChange }: {
  workspace: ServiceCaseDetailWorkspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const currentOwner = workspace.followUpOwners.find(
    (owner) => owner.userId === workspace.currentActorId,
  );
  const [title, setTitle] = useState(`Servicefall ${workspace.serviceCase.caseNumber} nachfassen`);
  const [note, setNote] = useState("");
  const [ownerUserId, setOwnerUserId] = useState(currentOwner?.userId ?? "");
  const [dueAt, setDueAt] = useState(() => tomorrowMorningInBerlin());
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const { showBanner } = useBanner();
  const { run, isPending } = useServerAction(async () => {
    const dueDate = parseBerlinDateTimeInput(dueAt);
    if (!dueDate) return;
    const result = await createCustomerFollowUp(workspace.serviceCase.clientId, {
      title,
      note,
      ownerUserId,
      dueAt: dueDate.toISOString(),
      sourceType: "service_case",
      sourceId: workspace.serviceCase.id,
    });
    if (!result.success) {
      setError("Die Nachfassaktion konnte nicht angelegt werden.");
      return;
    }
    onOpenChange(false);
    // The follow-up lives under Aufgaben, not on this page: the banner is the
    // only confirmation the user gets here.
    showBanner({ variant: "success", message: "Nachfassaktion wurde angelegt." });
  });
  const titleError = attempted && !title.trim() ? "Bitte gib einen Titel ein." : undefined;
  const ownerError = attempted && !ownerUserId ? "Bitte wähle eine zuständige Person." : undefined;
  const dueError = attempted && !parseBerlinDateTimeInput(dueAt) ? "Bitte gib eine Fälligkeit an." : undefined;
  function submit(): void {
    setError(null);
    setAttempted(true);
    const firstInvalidId = !title.trim() ? "service-follow-up-title" : !ownerUserId ? "service-follow-up-owner" : !parseBerlinDateTimeInput(dueAt) ? "service-follow-up-due-date" : null;
    if (firstInvalidId) {
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
    void run();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nachfassaktion anlegen</DialogTitle><DialogDescription>Lege einen klaren nächsten Schritt für diesen Servicefall fest. Die Aktion erscheint in der bestehenden Aufgabenübersicht.</DialogDescription></DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="space-y-4">
          <p className="rounded-md bg-muted px-3 py-2 text-sm">Quelle: {workspace.serviceCase.caseNumber}</p>
          <Field label="Titel" htmlFor="service-follow-up-title" required error={titleError}><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} autoFocus /></Field>
          <Field label="Zuständig" htmlFor="service-follow-up-owner" required error={ownerError}><SearchableSelect value={ownerUserId} onChange={setOwnerUserId} options={workspace.followUpOwners.map((owner) => ({ value: owner.userId, label: owner.name }))} placeholder="Person wählen" searchPlaceholder="Person suchen..." emptyMessage="Keine Person gefunden" /></Field>
          <Field label="Fällig am" htmlFor="service-follow-up-due-date" required error={dueError}><DateTimeField idPrefix="service-follow-up-due" value={dueAt} onChange={setDueAt} dateAriaLabel="Fälligkeitsdatum" invalid={Boolean(dueError)} /></Field>
          <Field label="Notiz" htmlFor="service-follow-up-note"><Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} /></Field>
          <ErrorText>{error}</ErrorText>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Abbrechen</Button><Button type="submit" disabled={isPending}>{isPending && <Loader2 className="size-4 animate-spin" />}Speichern</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ServiceCaseDetailContent({ initial, documents, documentsLoadFailed }: {
  initial: ServiceCaseDetailWorkspace;
  documents: OrganizationDocument[];
  documentsLoadFailed: boolean;
}): ReactElement {
  const [editOpen, setEditOpen] = useState(false);
  const [relationOpen, setRelationOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const live = useLiveView({
    tables: ["service_cases"],
    initialData: initial,
    resetKey: initial.serviceCase.id,
    eventFilter: (event) => { const row = event.new ?? event.old; return !row?.id || row.id === initial.serviceCase.id; },
    read: async () => {
      const result = await getServiceCaseDetailByNumber(initial.serviceCase.caseNumber);
      return result.success ? { ok: true as const, data: result.workspace } : { ok: false as const, error: result.error };
    },
  });
  const workspace = live.data ?? initial;
  const item = workspace.serviceCase;
  // Section-scoped settle window after a dialog action: the touched section
  // shows the indicator until the live read lands.
  const settling = useBusyIds<"case" | "relations" | "evidence">();
  const settleOn = (section: "case" | "relations" | "evidence") => () => void settling.run(section, live.refresh);
  return (
    <div className="space-y-6">
      {live.isStale && <p role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">Der Servicefall konnte nicht aktualisiert werden. Angezeigt wird der letzte bekannte Stand.</p>}
      <div>
        <Link href="/service/faelle" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="size-4" />Servicefälle</Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm text-muted-foreground">{item.caseNumber}</span><span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{SERVICE_CASE_STATUS_LABELS[item.status]}</span><span className="text-sm text-muted-foreground">{SERVICE_CASE_URGENCY_LABELS[item.urgency]}</span></div><h2 className="mt-1 text-xl font-semibold">{item.summary}</h2><p className="mt-1 text-sm text-muted-foreground">{item.intakeType === "request" ? "Aus Anfrage übernommen" : "Direkt erfasst"} · Aktualisiert {formatDateTime(item.updatedAt)}</p></div>
          <span className="flex items-center gap-2"><InlinePending active={settling.isBusy("case")} label="Änderungen werden übernommen" /><Button type="button" onClick={() => setEditOpen(true)} disabled={live.isStale}><Pencil className="size-4" />Bearbeiten</Button></span>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <main className="space-y-6">
          <section className="rounded-lg border p-4 shadow-xs">
            <h2 className="text-base font-semibold">Ursprüngliche Kundenaussage</h2>
            <blockquote className="mt-3 whitespace-pre-wrap border-l-2 border-primary pl-3 text-sm">{item.originalStatement}</blockquote>
            {item.originalDetails && <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{item.originalDetails}</p>}
            {item.sourceRequestId && <Link href={`/anfragen/${item.sourceRequestId}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Ursprüngliche Anfrage öffnen<ExternalLink className="size-3" /></Link>}
          </section>
          <section className="rounded-lg border p-4 shadow-xs">
            <h2 className="text-base font-semibold">Einschätzung</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2"><Fact label="Vorläufiger Kostenkontext" value={SERVICE_CASE_CHARGE_CONTEXT_LABELS[item.chargeContext]} /><Fact label="Zugang und Hinweise vor Ort" value={item.accessInstructions} /><div className="sm:col-span-2"><Fact label="Interne Einschätzung" value={item.triageNote} /></div>{item.resolutionNote && <div className="sm:col-span-2"><Fact label="Abschlussbegründung" value={item.resolutionNote} /></div>}</dl>
            <p className="mt-4 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Diese Einordnung dient nur der Einsatzplanung. Sie ist keine rechtliche Gewährleistungs- oder endgültige Kostenentscheidung.</p>
          </section>
          {documentsLoadFailed ? <SectionError>Dokumente und Bilder konnten nicht geladen werden.</SectionError> : <ContextualDocumentsSection title="Dokumente & Bilder" description="Dokumente werden aus der zentralen Ablage verknüpft. Es entsteht keine Dateikopie." documents={documents} documentTarget={{ kind: "service_case", serviceCaseId: item.id }} contextLabel={item.caseNumber} canUpload canManage keepUploadedDocumentsVisible />}
          <section className="rounded-lg border p-4 shadow-xs" data-testid="service-case-evidence">
            <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Arbeitsnachweise</h2><p className="mt-1 text-sm text-muted-foreground">Exakte Versionen aus dem zugeordneten Auftrag.</p></div><span className="flex items-center gap-2"><InlinePending active={settling.isBusy("evidence")} label="Änderungen werden übernommen" /><Button type="button" variant="outline" size="sm" onClick={() => setEvidenceOpen(true)} disabled={live.isStale || !item.jobId || workspace.evidenceOptions.length === 0}><FileCheck2 className="size-4" />Verknüpfen</Button></span></div>
            {item.evidence.length ? <div className="mt-3 divide-y rounded-md border">{item.evidence.map((evidence) => <div key={evidence.id} className="p-3 text-sm"><span className="font-medium">{evidence.title}</span><span className="ml-2 text-xs text-muted-foreground">{WORK_ARTIFACT_KIND_LABELS[evidence.kind]} · Version {evidence.revisionNumber}</span></div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">{item.jobId ? "Noch kein Arbeitsnachweis verknüpft." : "Ordne zuerst einen Auftrag zu."}</p>}
          </section>
          <section className="rounded-lg border p-4 shadow-xs" data-testid="service-case-relations">
            <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Zusammenhänge</h2><p className="mt-1 text-sm text-muted-foreground">Duplikate und Folgefälle bleiben als eigene Vorgänge erhalten.</p></div><span className="flex items-center gap-2"><InlinePending active={settling.isBusy("relations")} label="Änderungen werden übernommen" /><Button type="button" variant="outline" size="sm" onClick={() => setRelationOpen(true)} disabled={live.isStale || workspace.relatedCases.length === 0}><LinkIcon className="size-4" />Verknüpfen</Button></span></div>
            {item.relations.length ? <div className="mt-3 space-y-2">{item.relations.map((relation) => <ListRow key={relation.id} asChild interactive className="text-sm"><Link href={`/service/faelle/${relation.relatedCaseNumber}`}><span className="min-w-0"><span className="block font-medium">{SERVICE_CASE_RELATION_LABELS[relation.relationType]} {relation.relatedCaseNumber}</span><span className="block truncate text-xs text-muted-foreground">{relation.relatedSummary} · {relation.reason}</span></span><ExternalLink className="size-4 shrink-0" /></Link></ListRow>)}</div> : <p className="mt-3 text-sm text-muted-foreground">Noch keine verwandten Servicefälle.</p>}
          </section>
          <section className="rounded-lg border p-4 shadow-xs"><div className="flex items-center gap-2"><History className="size-4 text-muted-foreground" /><h2 className="text-base font-semibold">Verlauf</h2></div><div className="mt-4 divide-y">{item.events.map((event) => <div key={event.id} className="py-3 first:pt-0 last:pb-0"><div className="flex items-start justify-between gap-3"><span className="text-sm font-medium">{EVENT_LABELS[event.eventType] ?? event.eventType}</span><time className="text-xs text-muted-foreground">{formatDateTime(event.recordedAt)}</time></div><p className="mt-1 text-xs text-muted-foreground">{event.actorName}{event.reason ? ` · ${event.reason}` : ""}</p></div>)}</div></section>
        </main>
        <aside className="space-y-4">
          <section className="rounded-lg border p-4 shadow-xs"><h2 className="text-base font-semibold">Kunde & Einsatzort</h2><Link href={`/kunden/${item.clientId}`} className="mt-3 block font-medium text-primary hover:underline">{item.clientName}</Link><p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground"><MapPin className="mt-0.5 size-4 shrink-0" /><span>{item.siteName}<br />{item.siteAddress}</span></p>{item.contactName && <p className="mt-2 text-sm">Ansprechpartner: {item.contactName}</p>}</section>
          <section className="rounded-lg border p-4 shadow-xs"><h2 className="text-base font-semibold">Betroffene Anlagen</h2>{item.equipment.length ? <div className="mt-3 space-y-2">{item.equipment.map((equipment) => <ListRow key={equipment.id} asChild interactive className="text-sm"><Link href={`/service/anlagen/${equipment.equipmentNumber}`}><span className="min-w-0"><span className="block truncate font-medium">{equipment.name}</span><span className="text-xs text-muted-foreground">{equipment.equipmentNumber}</span></span><Wrench className="size-4 shrink-0" /></Link></ListRow>)}</div> : <p className="mt-2 text-sm text-muted-foreground">Noch keine Anlage zugeordnet.</p>}</section>
          <section className="rounded-lg border p-4 shadow-xs"><h2 className="text-base font-semibold">Operativer Auftrag</h2>{item.jobId ? <Button asChild variant="outline" className="mt-3 w-full"><Link href={`/auftraege/${encodeURIComponent(item.jobNumber ?? item.jobId)}`}>{item.jobNumber ?? "Auftrag öffnen"}<ExternalLink className="size-4" /></Link></Button> : <><p className="mt-2 text-sm text-muted-foreground">Lege den Auftrag im bestehenden Auftragsbereich an und ordne ihn anschließend hier zu.</p><Button asChild variant="outline" className="mt-3 w-full"><Link href="/auftraege/neu">Auftrag anlegen</Link></Button></>}</section>
          <section className="rounded-lg border p-4 shadow-xs" data-testid="service-case-follow-up"><h2 className="text-base font-semibold">Nächster Schritt</h2><p className="mt-2 text-sm text-muted-foreground">Plane eine Büro-, Gewährleistungs- oder Kundenrückfrage als bestehende Nachfassaktion.</p><Button type="button" variant="outline" className="mt-3 w-full" onClick={() => setFollowUpOpen(true)} disabled={live.isStale || workspace.followUpOwners.length === 0}><CalendarClock className="size-4" />Nachfassaktion anlegen</Button></section>
        </aside>
      </div>
      {editOpen && <ServiceCaseFormDialog open onOpenChange={setEditOpen} clients={workspace.clients} initial={item} jobs={workspace.jobs} onSaved={settleOn("case")} />}
      {relationOpen && <RelationDialog open onOpenChange={setRelationOpen} workspace={workspace} onSaved={settleOn("relations")} />}
      {evidenceOpen && <EvidenceDialog open onOpenChange={setEvidenceOpen} workspace={workspace} onSaved={settleOn("evidence")} />}
      {followUpOpen && <FollowUpDialog open onOpenChange={setFollowUpOpen} workspace={workspace} />}
    </div>
  );
}
