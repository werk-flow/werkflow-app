"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactElement } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  History,
  LinkIcon,
  MapPin,
  Pencil,
  RefreshCw,
  Replace,
  Unlink,
} from "lucide-react";

import { ContextualDocumentsSection } from "@/components/dokumente/contextual-documents-section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/ui/error-text";
import { ListRow } from "@/components/ui/list-row";
import { SectionError } from "@/components/ui/section-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useLiveView } from "@/hooks/use-live-view";
import { usePendingTask } from "@/hooks/use-server-action";
import {
  correctInstalledEquipmentTerminalAction,
  getInstalledEquipmentSourceOptions,
  getInstalledEquipmentDetailByNumber,
  setInstalledEquipmentArchived,
  setInstalledEquipmentWorkLink,
  linkInstalledEquipmentSource,
  transitionInstalledEquipment,
} from "@/lib/installed-equipment/actions";
import {
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_IDENTIFIER_TYPE_LABELS,
  EQUIPMENT_STATE_LABELS,
  EQUIPMENT_SUBTYPE_LABELS,
  getAllowedEquipmentTransitions,
  getEquipmentMutationErrorMessage,
  type EquipmentClientOption,
  type EquipmentDetail,
  type EquipmentListItem,
  type EquipmentState,
  type EquipmentSourceOption,
} from "@/lib/installed-equipment/types";
import type { OrganizationDocument } from "@/lib/documents/types";
import type { Job, ProjectWithDetails } from "@/lib/jobs/types";
import { EquipmentFormDialog } from "./equipment-form-dialog";

const EVENT_LABELS: Record<string, string> = {
  registered: "Anlage erfasst",
  details_corrected: "Anlagendaten geändert",
  installation_recorded: "Installation dokumentiert",
  commissioning_recorded: "Inbetriebnahme dokumentiert",
  warranty_recorded: "Gewährleistungsdaten geändert",
  activated: "Aktiviert",
  inactivated: "Vorübergehend außer Betrieb genommen",
  removed: "Entfernt",
  replaced: "Ersetzt",
  decommissioned: "Stillgelegt",
  terminal_action_corrected: "Abschlussaktion korrigiert",
  archived: "Archiviert",
  archive_restored: "Aus Archiv wiederhergestellt",
  work_linked: "Arbeitsbezug hinzugefügt",
  work_unlinked: "Arbeitsbezug entfernt",
  source_linked: "Herkunftsnachweis verknüpft",
  document_linked: "Dokument verknüpft",
  document_unlinked: "Dokumentverknüpfung entfernt",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "Nicht erfasst";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(
    new Date(year, month - 1, day),
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Fact({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | null | undefined;
  testId?: string;
}): ReactElement {
  return (
    <div data-testid={testId}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm">{value || "Nicht erfasst"}</dd>
    </div>
  );
}

type EquipmentDetailContentProps = {
  initial: EquipmentDetail;
  documents: OrganizationDocument[];
  documentsLoadFailed: boolean;
  clients: EquipmentClientOption[];
  equipmentList: EquipmentListItem[];
  jobs: Job[];
  projects: ProjectWithDetails[];
};

export function EquipmentDetailContent({
  initial,
  documents,
  documentsLoadFailed,
  clients,
  equipmentList,
  jobs,
  projects,
}: EquipmentDetailContentProps): ReactElement {
  const router = useRouter();
  const { run, isPending } = usePendingTask();
  const [editOpen, setEditOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [workLinkOpen, setWorkLinkOpen] = useState(false);
  const [workTargetType, setWorkTargetType] = useState<"job" | "project">(
    "job",
  );
  const [workTargetId, setWorkTargetId] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceOptions, setSourceOptions] = useState<EquipmentSourceOption[]>(
    [],
  );
  const [sourceValue, setSourceValue] = useState("");
  const [targetState, setTargetState] = useState<EquipmentState>("inactive");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const live = useLiveView({
    tables: ["installed_equipment"],
    initialData: initial,
    resetKey: initial.id,
    read: async () => {
      const result = await getInstalledEquipmentDetailByNumber(
        initial.equipmentNumber,
      );
      return result.success
        ? { ok: true as const, data: result.equipment }
        : { ok: false as const, error: result.error };
    },
  });
  const item = live.data ?? initial;
  const terminalEvent = item.events.find(
    (event) =>
      event.eventType === "replaced" || event.eventType === "decommissioned",
  );
  const transitionStates = getAllowedEquipmentTransitions(item.state);

  function perform(
    task: () => Promise<{ success: boolean; error?: string }>,
    onSuccess?: () => void,
  ): void {
    setError(null);
    void run(async () => {
      const result = await task();
      if (!result.success) {
        setError(
          getEquipmentMutationErrorMessage(
            result.error,
            "Die Änderung konnte nicht gespeichert werden.",
          ),
        );
        return;
      }
      setReason("");
      setStatusOpen(false);
      setCorrectionOpen(false);
      setArchiveOpen(false);
      await live.refresh();
      onSuccess?.();
      router.refresh();
    });
  }

  function openSourceDialog(): void {
    setError(null);
    setReason("");
    void run(async () => {
      const result = await getInstalledEquipmentSourceOptions(item.id);
      if (!result.success) {
        setError("Verfügbare Herkunftsnachweise konnten nicht geladen werden.");
        return;
      }
      setSourceOptions(result.options);
      setSourceValue("");
      setSourceOpen(true);
    });
  }

  function openStatusDialog(): void {
    const [firstTransition] = transitionStates;
    if (!firstTransition) return;
    setReason("");
    setTargetState(firstTransition);
    setStatusOpen(true);
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Link
              href="/service/anlagen"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Anlagen & Geräte
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{item.name}</h2>
              <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                {item.archivedAt
                  ? "Archiviert"
                  : EQUIPMENT_STATE_LABELS[item.state]}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {item.equipmentNumber} ·{" "}
              {EQUIPMENT_CATEGORY_LABELS[item.category]}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditOpen(true)}
              disabled={Boolean(item.voidedAt)}
            >
              <Pencil className="size-4" />
              Bearbeiten
            </Button>
            {!["replaced", "decommissioned"].includes(item.state) &&
              !item.archivedAt && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReplaceOpen(true)}
                >
                  <Replace className="size-4" />
                  Ersetzen
                </Button>
              )}
            <Button
              type="button"
              onClick={openStatusDialog}
              disabled={Boolean(
                item.archivedAt ||
                item.voidedAt ||
                transitionStates.length === 0,
              )}
            >
              Zustand ändern
            </Button>
          </div>
        </div>

        {live.isStale && (
          <p
            role="status"
            className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm"
          >
            Die zuletzt bekannten Daten werden angezeigt. Die Aktualisierung ist
            fehlgeschlagen.
          </p>
        )}
        {item.voidedAt && (
          <p
            role="status"
            className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm"
          >
            Dieser Nachfolger wurde durch eine Korrektur als irrtümlich erfasst
            markiert. Seine Historie bleibt erhalten.
          </p>
        )}
        <ErrorText>{error}</ErrorText>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <div className="space-y-6">
            <section className="rounded-lg border p-4 shadow-xs">
              <h2 className="text-base font-semibold">Anlagendaten</h2>
              <dl className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <Fact
                  label="Kategorie"
                  value={EQUIPMENT_CATEGORY_LABELS[item.category]}
                />
                <Fact
                  label="Untertyp"
                  value={
                    item.subtype ? EQUIPMENT_SUBTYPE_LABELS[item.subtype] : null
                  }
                />
                <Fact
                  label="Hersteller"
                  value={item.manufacturer}
                  testId="equipment-fact-manufacturer"
                />
                <Fact label="Modell" value={item.model} />
                <Fact label="Position" value={item.locationDetail} />
                <Fact
                  label="Installation"
                  value={formatDate(item.installationDate)}
                />
                <Fact
                  label="Inbetriebnahme"
                  value={formatDate(item.commissioningDate)}
                  testId="equipment-fact-commissioning"
                />
                <Fact
                  label="Gewährleistungsgeber"
                  value={item.warrantyProvider}
                />
                <Fact
                  label="Gewährleistungszeitraum"
                  value={
                    item.warrantyStartDate || item.warrantyEndDate
                      ? `${formatDate(item.warrantyStartDate)} bis ${formatDate(item.warrantyEndDate)}`
                      : null
                  }
                />
              </dl>
              {item.technicalNotes && (
                <div className="mt-5 border-t pt-4">
                  <Fact
                    label="Technische Hinweise"
                    value={item.technicalNotes}
                  />
                </div>
              )}
            </section>

            {documentsLoadFailed ? (
              <SectionError>
                Dokumente und Bilder konnten nicht geladen werden.
              </SectionError>
            ) : (
              <ContextualDocumentsSection
                title="Dokumente & Bilder"
                description="Dokumente werden aus der zentralen Dokumentenablage verknüpft. Es entsteht keine Dateikopie."
                documents={documents}
                documentTarget={{ kind: "equipment", equipmentId: item.id }}
                contextLabel={item.name}
                canUpload
                canManage
                keepUploadedDocumentsVisible
              />
            )}

            <section className="rounded-lg border p-4 shadow-xs">
              <div className="flex items-center gap-2">
                <History className="size-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">Servicehistorie</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Strukturierte Änderungen und exakte Bezüge, neueste zuerst.
              </p>
              <div className="mt-4 space-y-0">
                {item.events.map((event, index) => (
                  <div
                    key={event.id}
                    className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-3 pb-5 last:pb-0"
                  >
                    <div className="relative">
                      <span className="absolute left-1/2 top-1.5 size-2 -translate-x-1/2 rounded-full bg-primary" />
                      {index < item.events.length - 1 && (
                        <span className="absolute left-1/2 top-3 h-[calc(100%+0.5rem)] w-px -translate-x-1/2 bg-border" />
                      )}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-medium">
                          {EVENT_LABELS[event.eventType] ?? event.eventType}
                        </h3>
                        <time className="text-xs text-muted-foreground">
                          {formatDateTime(event.effectiveAt)}
                        </time>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {event.actorName} · erfasst{" "}
                        {formatDateTime(event.recordedAt)}
                      </p>
                      {event.reason && (
                        <p className="mt-2 text-sm">{event.reason}</p>
                      )}
                      {event.links.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {event.links.map((link) =>
                            link.href ? (
                              <Link
                                key={link.id}
                                href={link.href}
                                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                              >
                                {link.label}
                                <ExternalLink className="size-3" />
                              </Link>
                            ) : (
                              <span
                                key={link.id}
                                className="text-xs text-muted-foreground"
                              >
                                {link.label}
                              </span>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-lg border p-4 shadow-xs">
              <h2 className="text-base font-semibold">Kunde & Einsatzort</h2>
              <ListRow asChild interactive className="mt-3">
                <Link href={`/kunden/${encodeURIComponent(item.clientId)}`}>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {item.clientName}
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3" />
                      {item.siteName}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {item.siteAddress}
                    </span>
                  </span>
                </Link>
              </ListRow>
            </section>
            <section className="rounded-lg border p-4 shadow-xs">
              <h2 className="text-base font-semibold">Kennungen</h2>
              {item.identifiers.length ? (
                <dl className="mt-3 space-y-3">
                  {item.identifiers.map((identifier) => (
                    <Fact
                      key={identifier.id}
                      label={
                        EQUIPMENT_IDENTIFIER_TYPE_LABELS[
                          identifier.identifierType
                        ]
                      }
                      value={
                        identifier.issuer
                          ? `${identifier.value} · ${identifier.issuer}`
                          : identifier.value
                      }
                    />
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Keine Kennung erfasst.
                </p>
              )}
            </section>
            {(item.parent ||
              item.components.length ||
              item.predecessor ||
              item.successor) && (
              <section className="rounded-lg border p-4 shadow-xs">
                <h2 className="text-base font-semibold">Anlagenbeziehungen</h2>
                <div className="mt-3 space-y-2">
                  {item.parent && (
                    <ListRow asChild interactive className="text-sm">
                      <Link href={`/service/anlagen/${item.parent.equipmentNumber}`}>
                        <span>Übergeordnet: {item.parent.name}</span>
                        <ArrowRight className="size-4" />
                      </Link>
                    </ListRow>
                  )}
                  {item.components.map((component) => (
                    <ListRow key={component.id} asChild interactive className="text-sm">
                      <Link href={`/service/anlagen/${component.equipmentNumber}`}>
                        <span>Komponente: {component.name}</span>
                        <ArrowRight className="size-4" />
                      </Link>
                    </ListRow>
                  ))}
                  {item.predecessor && (
                    <ListRow asChild interactive className="text-sm">
                      <Link href={`/service/anlagen/${item.predecessor.equipmentNumber}`}>
                        <span>Vorgänger: {item.predecessor.name}</span>
                        <ArrowRight className="size-4" />
                      </Link>
                    </ListRow>
                  )}
                  {item.successor && (
                    <ListRow asChild interactive className="text-sm">
                      <Link href={`/service/anlagen/${item.successor.equipmentNumber}`}>
                        <span>Nachfolger: {item.successor.name}</span>
                        <ArrowRight className="size-4" />
                      </Link>
                    </ListRow>
                  )}
                </div>
              </section>
            )}
            <section className="rounded-lg border p-4 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Verknüpfte Arbeit</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setWorkLinkOpen(true)}
                >
                  <LinkIcon className="size-4" />
                  Verknüpfen
                </Button>
              </div>
              {item.workLinks.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {item.workLinks.map((link) => (
                    <div key={link.id} className="flex items-center gap-1">
                      <ListRow asChild interactive className="min-w-0 flex-1 text-sm">
                        <Link href={link.href}>
                          <span className="truncate">{link.label}</span>
                          <ExternalLink className="size-4 shrink-0" />
                        </Link>
                      </ListRow>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Verknüpfung ${link.label} entfernen`}
                        disabled={isPending}
                        onClick={() =>
                          perform(() =>
                            setInstalledEquipmentWorkLink({
                              equipmentId: item.id,
                              expectedVersion: item.version,
                              jobId: link.jobId,
                              projectId: link.projectId,
                              linked: false,
                              reason: "Verknüpfung entfernt",
                              idempotencyKey: crypto.randomUUID(),
                            }),
                          )
                        }
                      >
                        <Unlink className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Noch kein Auftrag oder Projekt verknüpft.
                </p>
              )}
            </section>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={openSourceDialog}
              disabled={isPending}
            >
              <LinkIcon className="size-4" />
              Herkunftsnachweis verknüpfen
            </Button>
            {terminalEvent && !item.archivedAt && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setReason("");
                  setCorrectionOpen(true);
                }}
              >
                <RefreshCw className="size-4" />
                Abschlussaktion korrigieren
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => {
                setReason("");
                setArchiveOpen(true);
              }}
              disabled={
                !item.archivedAt &&
                !["removed", "replaced", "decommissioned"].includes(item.state)
              }
            >
              {item.archivedAt ? "Aus Archiv wiederherstellen" : "Archivieren"}
            </Button>
          </aside>
        </div>
      </div>

      {editOpen && (
        <EquipmentFormDialog
          open
          onOpenChange={setEditOpen}
          mode="edit"
          clients={clients}
          equipment={equipmentList}
          initial={item}
        />
      )}
      {replaceOpen && (
        <EquipmentFormDialog
          open
          onOpenChange={setReplaceOpen}
          mode="replace"
          clients={clients}
          equipment={equipmentList}
          initial={item}
        />
      )}

      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zustand ändern</DialogTitle>
            <DialogDescription>
              Die Änderung wird mit Zeitpunkt, Person und Begründung in der
              Historie festgehalten.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Neuer Zustand" htmlFor="equipment-target-state">
              <Select
                value={targetState}
                onValueChange={(value: EquipmentState) => setTargetState(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {transitionStates.map((state) => (
                    <SelectItem key={state} value={state}>
                      {EQUIPMENT_STATE_LABELS[state]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Begründung" htmlFor="equipment-state-reason" required>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusOpen(false)}>
              Abbrechen
            </Button>
            <Button
              disabled={isPending || reason.trim().length < 3}
              onClick={() =>
                perform(() =>
                  transitionInstalledEquipment({
                    equipmentId: item.id,
                    expectedVersion: item.version,
                    toState: targetState,
                    effectiveAt: new Date().toISOString(),
                    reason,
                    idempotencyKey: crypto.randomUUID(),
                  }),
                )
              }
            >
              Änderung speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={workLinkOpen} onOpenChange={setWorkLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arbeit verknüpfen</DialogTitle>
            <DialogDescription>
              Nur Arbeit desselben Kunden und Einsatzorts kann verknüpft werden.
              Zugewiesene Mitarbeiter sehen danach die kompakte
              Anlagenprojektion im Auftrag.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Art" htmlFor="equipment-work-type">
              <Select
                value={workTargetType}
                onValueChange={(value: "job" | "project") => {
                  setWorkTargetType(value);
                  setWorkTargetId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="job">Auftrag</SelectItem>
                  <SelectItem value="project">Projekt</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field
              label={workTargetType === "job" ? "Auftrag" : "Projekt"}
              htmlFor="equipment-work-target"
              required
            >
              <SearchableSelect
                value={workTargetId}
                onChange={setWorkTargetId}
                options={(workTargetType === "job" ? jobs : projects)
                  .filter((target) => target.siteId === item.siteId)
                  .map((target) => ({
                    value: target.id,
                    label:
                      workTargetType === "job"
                        ? `${(target as Job).jobNumber ?? "Ohne Nummer"} · ${(target as Job).title}`
                        : `${(target as ProjectWithDetails).projectNumber ?? "Ohne Nummer"} · ${(target as ProjectWithDetails).name}`,
                  }))}
                placeholder="Auswählen"
                searchPlaceholder="Suchen..."
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWorkLinkOpen(false)}>
              Abbrechen
            </Button>
            <Button
              disabled={isPending || !workTargetId}
              onClick={() =>
                perform(
                  () =>
                    setInstalledEquipmentWorkLink({
                      equipmentId: item.id,
                      expectedVersion: item.version,
                      jobId: workTargetType === "job" ? workTargetId : null,
                      projectId:
                        workTargetType === "project" ? workTargetId : null,
                      linked: true,
                      reason: "Arbeitsbezug hinzugefügt",
                      idempotencyKey: crypto.randomUUID(),
                    }),
                  () => setWorkLinkOpen(false),
                )
              }
            >
              Verknüpfen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Herkunftsnachweis verknüpfen</DialogTitle>
            <DialogDescription>
              Verknüpfe den genauen Auftrag, Arbeitsnachweis, freigegebenen
              Übergabestand oder die exakte Dokumentversion. Der Bezug wird
              unveränderlich in der Historie festgehalten.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Nachweis" htmlFor="equipment-source" required>
              <SearchableSelect
                value={sourceValue}
                onChange={setSourceValue}
                options={sourceOptions.map((option) => ({
                  value: option.value,
                  label: option.label,
                  description: option.description,
                }))}
                placeholder="Nachweis auswählen"
                searchPlaceholder="Nachweis suchen..."
                emptyMessage="Keine passenden Nachweise verfügbar"
              />
            </Field>
            <Field
              label="Bedeutung des Nachweises"
              htmlFor="equipment-source-reason"
              required
            >
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="z. B. Installation laut Übergabestand"
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSourceOpen(false)}>
              Abbrechen
            </Button>
            <Button
              disabled={isPending || !sourceValue || reason.trim().length < 3}
              onClick={() => {
                const option = sourceOptions.find(
                  (candidate) => candidate.value === sourceValue,
                );
                if (!option) return;
                perform(
                  () =>
                    linkInstalledEquipmentSource({
                      equipmentId: item.id,
                      expectedVersion: item.version,
                      targetType: option.targetType,
                      targetId: option.targetId,
                      documentVersionNumber: option.documentVersionNumber,
                      reason,
                      idempotencyKey: crypto.randomUUID(),
                    }),
                  () => setSourceOpen(false),
                );
              }}
            >
              Verknüpfen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abschlussaktion korrigieren?</AlertDialogTitle>
            <AlertDialogDescription>
              Die ursprüngliche Aktion bleibt sichtbar. Bei einer Ersetzung wird
              der irrtümliche Nachfolger als korrigierter Datensatz erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field label="Korrekturgrund" htmlFor="equipment-correction-reason" required>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || reason.trim().length < 3}
              onClick={(event) => {
                event.preventDefault();
                if (!terminalEvent) return;
                perform(() =>
                  correctInstalledEquipmentTerminalAction({
                    equipmentId: item.id,
                    expectedVersion: item.version,
                    correctsEventId: terminalEvent.id,
                    effectiveAt: new Date().toISOString(),
                    reason,
                    idempotencyKey: crypto.randomUUID(),
                  }),
                );
              }}
            >
              Korrektur festhalten
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {item.archivedAt
                ? "Anlage wiederherstellen?"
                : "Anlage archivieren?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Die Identität, Dokumente, Arbeitsbezüge und Historie bleiben
              erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field label="Begründung" htmlFor="equipment-archive-reason" required>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || reason.trim().length < 3}
              onClick={(event) => {
                event.preventDefault();
                perform(() =>
                  setInstalledEquipmentArchived({
                    equipmentId: item.id,
                    expectedVersion: item.version,
                    archived: !item.archivedAt,
                    reason,
                    idempotencyKey: crypto.randomUUID(),
                  }),
                );
              }}
            >
              {item.archivedAt ? "Wiederherstellen" : "Archivieren"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
