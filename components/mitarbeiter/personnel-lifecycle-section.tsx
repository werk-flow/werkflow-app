"use client";

import { useMemo, useState } from "react";
import { Download, FileDown, FileLock2, Loader2, Plus, UserRoundCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { DateTimeField } from "@/components/ui/date-time-field";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorText } from "@/components/ui/error-text";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { useBanner } from "@/components/ui/banner";
import { useRealtimeRouterRefresh } from "@/hooks/use-realtime-router-refresh";
import { useServerAction } from "@/hooks/use-server-action";
import { parseBerlinDateTimeInput } from "@/lib/customer-relationships/date-time";
import { uploadPersonnelDocumentDirect } from "@/lib/documents/upload-client";
import {
  createPersonnelOnboardingPlan,
  exportPersonnelLifecycleManifest,
  getPersonnelDocumentSignedUrl,
  savePersonnelOnboardingRequirement,
  setPersonnelAccessTransition,
  setPersonnelDocumentRelease,
  setPersonnelEmploymentTransition,
  type PersonnelLifecycleView,
} from "@/lib/personnel/lifecycle-actions";
import {
  ACCESS_STATE_LABELS,
  EMPLOYMENT_LIFECYCLE_LABELS,
  REQUIREMENT_STATE_LABELS,
  type PersonnelAccessTransitionKind,
  type PersonnelDocumentAccessClass,
  type PersonnelEmploymentTransitionKind,
  type PersonnelRequirementState,
  type PersonnelRequirementType,
} from "@/lib/personnel/lifecycle";
import { toLocalDateString } from "@/lib/utils";

const ACCESS_TRANSITIONS: Array<{ value: PersonnelAccessTransitionKind; label: string }> = [
  { value: "schedule_activation", label: "Zugang planen" },
  { value: "activate_now", label: "Jetzt aktivieren" },
  { value: "suspend_now", label: "Sofort sperren" },
  { value: "schedule_suspension", label: "Sperre planen" },
  { value: "cancel_scheduled", label: "Planung zurücknehmen" },
  { value: "reactivate", label: "Reaktivieren" },
  { value: "end_access", label: "Zugang beenden" },
];

const EMPLOYMENT_TRANSITIONS: Array<{ value: PersonnelEmploymentTransitionKind; label: string }> = [
  { value: "plan_start", label: "Eintritt planen" },
  { value: "start", label: "Beschäftigung starten" },
  { value: "record_notice", label: "Austritt vormerken" },
  { value: "plan_exit", label: "Austritt planen" },
  { value: "mark_inactive", label: "Inaktiv setzen" },
  { value: "exit", label: "Austritt festhalten" },
  { value: "cancel_scheduled", label: "Planung zurücknehmen" },
  { value: "reverse", label: "Übergang rückgängig machen" },
  { value: "reactivate", label: "Beschäftigung reaktivieren" },
];

const REQUIREMENT_TYPES: Array<{ value: PersonnelRequirementType; label: string }> = [
  { value: "document", label: "Dokument" },
  { value: "qualification", label: "Qualifikation" },
  { value: "employment_condition", label: "Beschäftigungsbedingung" },
  { value: "work_schedule", label: "Arbeitszeitmodell" },
  { value: "team", label: "Team" },
  { value: "access", label: "Zugang" },
  { value: "acknowledgement", label: "Bestätigung" },
  { value: "manual", label: "Manueller Punkt" },
];

const ACCESS_CLASS_OPTIONS: Array<{ value: PersonnelDocumentAccessClass; label: string; description: string }> = [
  { value: "personnel_standard", label: "Personalunterlage", description: "Admin und Büro; Freigabe an die betroffene Person möglich" },
  { value: "admin_restricted", label: "Nur Admin", description: "Verträge oder besonders sensible Personalunterlagen" },
  { value: "health_evidence", label: "Gesundheitsnachweis", description: "Minimaler Nachweis mit besonders enger Sichtbarkeit" },
];

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: "Bitte prüfe die Eingaben.",
  stale_version: "Der Stand hat sich geändert. Die Ansicht wird aktualisiert.",
  not_authorized: "Du darfst diese Aktion nicht ausführen.",
  membership_required: "Vor der Aktivierung muss ein eingelöster Zugang bestehen.",
  last_admin_protected: "Der letzte aktive Admin kann nicht gesperrt werden.",
  organization_owner_protected: "Der Organisationsinhaber kann hier nicht gesperrt oder inaktiv gesetzt werden.",
  last_responsibility_holder: "Mindestens eine Verantwortung hätte danach keine wirksame Vertretung.",
  unresolved_work: "Offene Zuständigkeiten oder Aufträge müssen zuerst geprüft werden.",
  future_effective_at_required: "Wähle für eine Planung einen Zeitpunkt in der Zukunft.",
  immediate_effective_at_required: "Für diese Aktion gilt der aktuelle Zeitpunkt. Wähle für eine spätere Sperre den geplanten Übergang.",
  future_effective_date_required: "Wähle für eine Planung ein Datum in der Zukunft.",
  no_scheduled_transition: "Es gibt keinen geplanten Übergang, der zurückgenommen werden kann.",
  access_requirements_incomplete: "Mindestens eine ausdrücklich zugangsblockierende Anforderung ist noch offen.",
  requirement_not_open: "Diese Anforderung ist nicht mehr offen und kann nicht bestätigt werden.",
  file_missing: "Die Datei konnte nach dem Hochladen nicht bestätigt werden.",
  mutation_failed: "Die Änderung konnte nicht gespeichert werden.",
};

function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? "Die Aktion ist fehlgeschlagen. Bitte versuche es erneut.";
}

/** Field errors are keyed by control id; the first key wins focus. */
function focusFirstInvalid(errors: Record<string, string>): boolean {
  const firstInvalidId = Object.keys(errors)[0];
  if (!firstInvalidId) return false;
  document.getElementById(firstInvalidId)?.focus();
  return true;
}

function formatDate(value: string | null): string {
  if (!value) return "Nicht festgelegt";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "Europe/Berlin" }).format(new Date(value));
}

function berlinIsoDateAtOffset(offsetDays: number): string {
  const berlinDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const value = new Date(`${berlinDate}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function todayDate(): Date {
  return new Date(`${berlinIsoDateAtOffset(0)}T12:00:00`);
}

function defaultAccessDateTime(): string {
  return `${berlinIsoDateAtOffset(1)}T09:00`;
}

function isScheduledAccessTransition(kind: PersonnelAccessTransitionKind): boolean {
  return kind === "schedule_activation" || kind === "schedule_suspension";
}

export function PersonnelLifecycleSection({
  data,
  canManage,
  canAdministerAccess,
}: {
  data: PersonnelLifecycleView;
  canManage: boolean;
  canAdministerAccess: boolean;
}) {
  const { showBanner } = useBanner();
  const [accessOpen, setAccessOpen] = useState(false);
  const [employmentOpen, setEmploymentOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [requirementOpen, setRequirementOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [accessKind, setAccessKind] = useState<PersonnelAccessTransitionKind>("schedule_activation");
  const [accessAt, setAccessAt] = useState(defaultAccessDateTime);
  const [employmentKind, setEmploymentKind] = useState<PersonnelEmploymentTransitionKind>("record_notice");
  const [employmentDate, setEmploymentDate] = useState<Date | undefined>(todayDate());
  const [reason, setReason] = useState("");
  const [acceptUnresolved, setAcceptUnresolved] = useState(false);
  const [planName, setPlanName] = useState("Onboarding");
  const [planTemplateVersionId, setPlanTemplateVersionId] = useState<string>("");
  const [planStartDate, setPlanStartDate] = useState<Date | undefined>();
  const [requirementTitle, setRequirementTitle] = useState("");
  const [requirementType, setRequirementType] = useState<PersonnelRequirementType>("manual");
  const [requirementRequired, setRequirementRequired] = useState(true);
  const [requirementBlocksAccess, setRequirementBlocksAccess] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("");
  const [accessClass, setAccessClass] = useState<PersonnelDocumentAccessClass>("personnel_standard");

  useRealtimeRouterRefresh({
    tables: [
      "personnel_access_lifecycles",
      "personnel_employment_lifecycles",
      "personnel_documents",
      "personnel_document_releases",
      "personnel_onboarding_templates",
      "personnel_onboarding_plans",
      "personnel_onboarding_requirements",
    ],
  });

  const { run, isPending } = useServerAction(async (task: () => Promise<void>) => task());
  const currentPlan = data.plans[0] ?? null;
  const incompleteRequirements = useMemo(
    () => currentPlan?.requirements.filter((item) => !["fulfilled", "waived", "cancelled"].includes(item.state)) ?? [],
    [currentPlan],
  );
  const hasUnresolvedWork =
    data.transitionInventory.activeJobs.length > 0 ||
    data.transitionInventory.strandedResponsibilities.length > 0;

  async function submitAccess(): Promise<void> {
    setError(null);
    const instant = isScheduledAccessTransition(accessKind)
      ? parseBerlinDateTimeInput(accessAt)?.toISOString()
      : new Date().toISOString();
    const nextErrors: Record<string, string> = {};
    if (!instant) nextErrors["access-transition-date"] = "Bitte gib einen Zeitpunkt an.";
    if (reason.trim().length < 2) nextErrors["access-reason"] = "Bitte gib einen Grund an.";
    setFieldErrors(nextErrors);
    if (focusFirstInvalid(nextErrors)) return;
    await run(async () => {
      const result = await setPersonnelAccessTransition({
        employeeRecordId: data.employeeRecordId,
        expectedVersion: data.access.version,
        transitionKind: accessKind,
        effectiveAt: instant,
        reason,
        operationId: crypto.randomUUID(),
      });
      if (!result.success) {
        setError(errorMessage(result.error));
        return;
      }
      setAccessOpen(false);
      setReason("");
      showBanner({ variant: "success", message: "Zugangsstatus wurde gespeichert." });
    });
  }

  async function submitEmployment(): Promise<void> {
    setError(null);
    const nextErrors: Record<string, string> = {};
    if (!employmentDate) nextErrors["employment-date"] = "Bitte gib ein Datum an.";
    if (reason.trim().length < 2) nextErrors["employment-reason"] = "Bitte gib einen Grund an.";
    setFieldErrors(nextErrors);
    if (focusFirstInvalid(nextErrors) || !employmentDate) return;
    await run(async () => {
      const result = await setPersonnelEmploymentTransition({
        employeeRecordId: data.employeeRecordId,
        expectedVersion: data.employment.version,
        transitionKind: employmentKind,
        effectiveOn: toLocalDateString(employmentDate),
        reason,
        acceptUnresolvedWork: acceptUnresolved,
        operationId: crypto.randomUUID(),
      });
      if (!result.success) {
        setError(errorMessage(result.error));
        return;
      }
      setEmploymentOpen(false);
      setReason("");
      setAcceptUnresolved(false);
      showBanner({ variant: "success", message: "Beschäftigungsübergang wurde gespeichert." });
    });
  }

  async function submitPlan(): Promise<void> {
    setError(null);
    const nextErrors: Record<string, string> = {};
    if (!planName.trim()) nextErrors["plan-name"] = "Bitte gib eine Bezeichnung an.";
    setFieldErrors(nextErrors);
    if (focusFirstInvalid(nextErrors)) return;
    await run(async () => {
      const result = await createPersonnelOnboardingPlan({
        employeeRecordId: data.employeeRecordId,
        templateVersionId: planTemplateVersionId || null,
        name: planName,
        targetStartDate: planStartDate ? toLocalDateString(planStartDate) : null,
        operationId: crypto.randomUUID(),
      });
      if (!result.success) {
        setError(errorMessage(result.error));
        return;
      }
      setPlanOpen(false);
      showBanner({ variant: "success", message: "Onboardingplan wurde angelegt." });
    });
  }

  async function downloadManifest(): Promise<void> {
    await run(async () => {
      const result = await exportPersonnelLifecycleManifest(data.employeeRecordId);
      if (!result.success) {
        showBanner({ variant: "error", message: errorMessage(result.error) });
        return;
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `personalprozess-${data.employeeRecordId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }

  async function submitRequirement(): Promise<void> {
    if (!currentPlan) return;
    setError(null);
    const nextErrors: Record<string, string> = {};
    if (!requirementTitle.trim()) nextErrors["requirement-title"] = "Bitte gib einen Titel an.";
    setFieldErrors(nextErrors);
    if (focusFirstInvalid(nextErrors)) return;
    await run(async () => {
      const result = await savePersonnelOnboardingRequirement({
        planId: currentPlan.id,
        requirementId: null,
        expectedVersion: 0,
        requirementType,
        title: requirementTitle,
        description: null,
        isRequired: requirementRequired,
        blocksAccess: requirementBlocksAccess,
        ownerEmployeeRecordId: null,
        dueDate: null,
        state: "missing",
        blockerReason: null,
        operationId: crypto.randomUUID(),
      });
      if (!result.success) {
        setError(errorMessage(result.error));
        return;
      }
      setRequirementOpen(false);
      setRequirementTitle("");
      showBanner({ variant: "success", message: "Anforderung wurde ergänzt." });
    });
  }

  async function resolveRequirement(
    requirement: PersonnelLifecycleView["plans"][number]["requirements"][number],
    state: Extract<PersonnelRequirementState, "fulfilled" | "waived" | "cancelled">,
  ): Promise<void> {
    setError(null);
    await run(async () => {
      const result = await savePersonnelOnboardingRequirement({
        planId: requirement.planId,
        requirementId: requirement.id,
        expectedVersion: requirement.version,
        requirementType: requirement.requirementType,
        title: requirement.title,
        description: requirement.description,
        isRequired: requirement.isRequired,
        blocksAccess: requirement.blocksAccess,
        ownerEmployeeRecordId: requirement.ownerEmployeeRecordId,
        dueDate: requirement.dueDate,
        state,
        blockerReason: null,
        operationId: crypto.randomUUID(),
      });
      if (!result.success) {
        setError(errorMessage(result.error));
        return;
      }
      showBanner({ variant: "success", message: "Anforderung wurde aktualisiert." });
    });
  }

  async function submitUpload(): Promise<void> {
    setError(null);
    const nextErrors: Record<string, string> = {};
    if (!file) nextErrors["personnel-file"] = "Bitte wähle eine Datei aus.";
    if (documentType.trim().length < 2) nextErrors["document-type"] = "Bitte gib die Dokumentart an.";
    setFieldErrors(nextErrors);
    if (focusFirstInvalid(nextErrors) || !file) return;
    await run(async () => {
      const result = await uploadPersonnelDocumentDirect({
        employeeRecordId: data.employeeRecordId,
        file,
        documentType,
        accessClass,
        evidenceState: "valid",
        validUntil: null,
        operationId: crypto.randomUUID(),
      });
      if (!result.success) {
        setError(errorMessage(result.error));
        return;
      }
      setUploadOpen(false);
      setFile(null);
      setDocumentType("");
      showBanner({ variant: "success", message: "Geschützte Personalunterlage wurde gespeichert." });
    });
  }

  async function toggleRelease(document: PersonnelLifecycleView["documents"][number]): Promise<void> {
    await run(async () => {
      const result = await setPersonnelDocumentRelease({
        employeeRecordId: data.employeeRecordId,
        personnelDocumentId: document.id,
        documentVersionNumber: document.currentVersionNumber,
        release: !document.releasedToEmployee,
        reason: document.releasedToEmployee ? "Freigabe zurückgenommen" : null,
        operationId: crypto.randomUUID(),
      });
      showBanner(
        result.success
          ? { variant: "success", message: document.releasedToEmployee ? "Freigabe wurde zurückgenommen." : "Dokument wurde für die betroffene Person freigegeben." }
          : { variant: "error", message: errorMessage(result.error) },
      );
    });
  }

  async function downloadDocument(documentId: string): Promise<void> {
    await run(async () => {
      const result = await getPersonnelDocumentSignedUrl(documentId);
      if (!result.success) {
        showBanner({ variant: "error", message: errorMessage(result.error) });
        return;
      }
      window.location.assign(result.data.signedUrl);
    });
  }

  return (
    <section className="min-w-0 space-y-4 rounded-lg border bg-card p-4 shadow-xs md:col-span-2 2xl:col-span-1" aria-labelledby="personnel-lifecycle-title" data-testid="personnel-lifecycle">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="personnel-lifecycle-title" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <UserRoundCheck className="size-4" /> Personalprozess
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Zugang, Onboarding und Übergänge bleiben getrennt und nachvollziehbar.</p>
        </div>
        {isPending ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Änderung wird gespeichert" /> : null}
        {canAdministerAccess ? <Button size="sm" variant="outline" onClick={() => void downloadManifest()} disabled={isPending}><FileDown className="size-4" /> Arbeitsstand exportieren</Button> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Organisationszugang</span>
            <Badge variant={data.access.state === "suspended" || data.access.state === "ended" ? "destructive" : "secondary"}>
              {ACCESS_STATE_LABELS[data.access.state]}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {data.access.scheduledState
              ? `${ACCESS_STATE_LABELS[data.access.scheduledState]} ab ${formatDate(data.access.scheduledFor)}`
              : data.access.storedState === null
                ? "Noch keine kontrollierte Zugangsregel. Bestehender Mitgliedszugang bleibt unverändert."
                : `Wirksam seit ${formatDate(data.access.effectiveAt)}`}
          </p>
          {canAdministerAccess ? <Button className="mt-3" size="sm" variant="outline" onClick={() => { setError(null); setFieldErrors({}); setAccessOpen(true); }}>Zugang steuern</Button> : null}
        </div>

        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Beschäftigung</span>
            <Badge variant="secondary">
              {data.employment.state ? EMPLOYMENT_LIFECYCLE_LABELS[data.employment.state] : "Nicht eingerichtet"}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {data.employment.scheduledState
              ? `${EMPLOYMENT_LIFECYCLE_LABELS[data.employment.scheduledState]} ab ${formatDate(data.employment.scheduledFor)}`
              : data.employment.state
                ? `Wirksam seit ${formatDate(data.employment.effectiveOn)}`
                : "Eintritts- und Austrittsdaten bleiben bis zum ersten kontrollierten Übergang maßgeblich."}
          </p>
          {canAdministerAccess ? <Button className="mt-3" size="sm" variant="outline" onClick={() => { setError(null); setFieldErrors({}); setEmploymentOpen(true); }}>Übergang erfassen</Button> : null}
        </div>
      </div>

      {hasUnresolvedWork ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
          <p className="font-medium">Vor einem Austritt prüfen</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.transitionInventory.activeJobs.length} aktive Auftragszuweisungen, {data.transitionInventory.strandedResponsibilities.length} nicht ersetzte Verantwortungen.
          </p>
        </div>
      ) : null}

      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Onboarding</h3>
            <p className="text-xs text-muted-foreground">Fehlende Konfiguration gilt nicht als erledigt.</p>
          </div>
          {canManage ? (
            currentPlan ? (
              <Button size="sm" variant="outline" onClick={() => { setError(null); setFieldErrors({}); setRequirementOpen(true); }}><Plus className="size-4" /> Anforderung</Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => { setError(null); setFieldErrors({}); setPlanOpen(true); }}><Plus className="size-4" /> Plan anlegen</Button>
            )
          ) : null}
        </div>
        {!currentPlan ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Nicht eingerichtet. Es wurde kein Plan aus Bestandsdaten abgeleitet.</p>
        ) : incompleteRequirements.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Keine offenen Anforderungen.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {incompleteRequirements.map((requirement) => (
              <li key={requirement.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{requirement.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {requirement.isRequired ? "Erforderlich" : "Optional"}
                    {requirement.blocksAccess ? " · blockiert Aktivierung" : ""}
                    {requirement.dueDate ? ` · fällig ${formatDate(requirement.dueDate)}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1">
                  <Badge variant={requirement.state === "blocked" ? "destructive" : "secondary"}>{REQUIREMENT_STATE_LABELS[requirement.state]}</Badge>
                  {canManage ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => void resolveRequirement(requirement, "fulfilled")} disabled={isPending}>Erledigen</Button>
                      <Button size="sm" variant="ghost" onClick={() => void resolveRequirement(requirement, "waived")} disabled={isPending}>Erlassen</Button>
                      <Button size="sm" variant="ghost" onClick={() => void resolveRequirement(requirement, "cancelled")} disabled={isPending}>Abbrechen</Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-medium"><FileLock2 className="size-4" /> Geschützte Personalunterlagen</h3>
            <p className="text-xs text-muted-foreground">Getrennt von „Dokumente & Bilder“ und an den Personalstammsatz gebunden.</p>
          </div>
          {canManage ? <Button size="sm" variant="outline" onClick={() => { setError(null); setFieldErrors({}); setUploadOpen(true); }}><Plus className="size-4" /> Datei</Button> : null}
        </div>
        {data.documents.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Keine geschützten Personalunterlagen vorhanden.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {data.documents.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{document.displayName}</p>
                  <p className="text-xs text-muted-foreground">{document.documentType} · {document.releasedToEmployee ? "für Person freigegeben" : "nicht freigegeben"}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => void downloadDocument(document.documentId)} disabled={isPending}><Download className="size-4" /> Öffnen</Button>
                  {canManage ? <Button size="sm" variant="ghost" onClick={() => void toggleRelease(document)} disabled={isPending || !data.userId}>{document.releasedToEmployee ? "Freigabe entziehen" : "Freigeben"}</Button> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={accessOpen} onOpenChange={(open) => { if (!isPending) setAccessOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Organisationszugang steuern</DialogTitle><DialogDescription>Die Änderung gilt nur für diese Organisation. Das globale Konto bleibt unberührt.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <Field label="Übergang" htmlFor="access-transition-kind"><SearchableSelect options={ACCESS_TRANSITIONS} value={accessKind} onChange={(value) => setAccessKind(value as PersonnelAccessTransitionKind)} searchPlaceholder="Übergang suchen…" /></Field>
            {isScheduledAccessTransition(accessKind) && <Field label="Zeitpunkt" htmlFor="access-transition-date" required error={fieldErrors["access-transition-date"]}><DateTimeField idPrefix="access-transition" value={accessAt} onChange={setAccessAt} disabled={isPending} /></Field>}
            <Field label="Grund" htmlFor="access-reason" required error={fieldErrors["access-reason"]}><Textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={isPending} /></Field>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter><Button variant="outline" onClick={() => setAccessOpen(false)} disabled={isPending}>Abbrechen</Button><Button onClick={() => void submitAccess()} disabled={isPending}>{isPending && <Loader2 className="size-4 animate-spin" />}Speichern</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={employmentOpen} onOpenChange={(open) => { if (!isPending) setEmploymentOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Beschäftigungsübergang erfassen</DialogTitle><DialogDescription>Historische Zuordnungen bleiben erhalten. Vollständiges Offboarding folgt separat.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <Field label="Übergang" htmlFor="employment-transition-kind"><SearchableSelect options={EMPLOYMENT_TRANSITIONS} value={employmentKind} onChange={(value) => setEmploymentKind(value as PersonnelEmploymentTransitionKind)} searchPlaceholder="Übergang suchen…" /></Field>
            <Field label="Wirksam am" htmlFor="employment-date" required error={fieldErrors["employment-date"]}><DatePicker value={employmentDate} onChange={setEmploymentDate} disabled={isPending} ariaLabel="Wirksam am" /></Field>
            <Field label="Grund" htmlFor="employment-reason" required error={fieldErrors["employment-reason"]}><Textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={isPending} /></Field>
            {hasUnresolvedWork ? <label className="flex items-start gap-2 rounded-md border p-3 text-sm"><Checkbox checked={acceptUnresolved} onCheckedChange={(value) => setAcceptUnresolved(value === true)} /><span>Offene Zuordnungen wurden geprüft und sollen sichtbar im Übergang erhalten bleiben. Es wird nichts still gelöscht.</span></label> : null}
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter><Button variant="outline" onClick={() => setEmploymentOpen(false)} disabled={isPending}>Abbrechen</Button><Button onClick={() => void submitEmployment()} disabled={isPending}>{isPending && <Loader2 className="size-4 animate-spin" />}Speichern</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={planOpen} onOpenChange={(open) => { if (!isPending) setPlanOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Onboardingplan anlegen</DialogTitle><DialogDescription>Du kannst leer beginnen oder eine veröffentlichte Vorlage als bearbeitbare Kopie verwenden. Bestandsdaten gelten nie automatisch als erledigt.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <Field label="Bezeichnung" htmlFor="plan-name" required error={fieldErrors["plan-name"]}><Input value={planName} onChange={(event) => setPlanName(event.target.value)} /></Field>
            <Field label="Vorlage" htmlFor="onboarding-plan-template"><SearchableSelect options={[{ value: "", label: "Ohne Vorlage" }, ...data.templates.map((template) => ({ value: template.currentVersionId, label: `${template.name} · Version ${template.currentVersionNumber}` }))]} value={planTemplateVersionId} onChange={setPlanTemplateVersionId} searchPlaceholder="Vorlage suchen…" /></Field>
            <Field label="Zieldatum" htmlFor="onboarding-plan-target-date"><DatePicker value={planStartDate} onChange={setPlanStartDate} disabled={isPending} ariaLabel="Zieldatum" /></Field>
            {data.templates.length === 0 ? <p className="text-xs text-muted-foreground">Keine veröffentlichte Vorlage. Der Plan startet leer.</p> : null}
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter><Button variant="outline" onClick={() => setPlanOpen(false)} disabled={isPending}>Abbrechen</Button><Button onClick={() => void submitPlan()} disabled={isPending}>Plan anlegen</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={requirementOpen} onOpenChange={(open) => { if (!isPending) setRequirementOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Anforderung ergänzen</DialogTitle><DialogDescription>Die Anforderung verweist später auf vorhandene Nachweise. Sie kopiert keine Fachdaten.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <Field label="Art" htmlFor="onboarding-requirement-type"><SearchableSelect options={REQUIREMENT_TYPES} value={requirementType} onChange={(value) => setRequirementType(value as PersonnelRequirementType)} searchPlaceholder="Art suchen…" /></Field>
            <Field label="Titel" htmlFor="requirement-title" required error={fieldErrors["requirement-title"]}><Input value={requirementTitle} onChange={(event) => setRequirementTitle(event.target.value)} /></Field>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={requirementRequired} onCheckedChange={(value) => setRequirementRequired(value === true)} />Erforderlich</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={requirementBlocksAccess} onCheckedChange={(value) => setRequirementBlocksAccess(value === true)} />Blockiert die Zugangsaktivierung</label>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter><Button variant="outline" onClick={() => setRequirementOpen(false)} disabled={isPending}>Abbrechen</Button><Button onClick={() => void submitRequirement()} disabled={isPending}>Speichern</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={uploadOpen} onOpenChange={(open) => { if (!isPending) setUploadOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Geschützte Personalunterlage</DialogTitle><DialogDescription>Die Datei wird direkt in den privaten Speicher geladen. Sie erscheint nicht in der normalen Dokumentenbibliothek.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <Field label="Datei" htmlFor="personnel-file" required error={fieldErrors["personnel-file"]}><Input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={isPending} /></Field>
            <Field label="Dokumentart" htmlFor="document-type" required error={fieldErrors["document-type"]}><Input value={documentType} onChange={(event) => setDocumentType(event.target.value)} placeholder="z. B. Arbeitsvertrag" /></Field>
            <Field label="Zugriffsklasse" htmlFor="personnel-document-access-class"><SearchableSelect options={ACCESS_CLASS_OPTIONS} value={accessClass} onChange={(value) => setAccessClass(value as PersonnelDocumentAccessClass)} searchPlaceholder="Zugriffsklasse suchen…" /></Field>
            <p className="text-xs text-muted-foreground">Eine Empfangsbestätigung dokumentiert nur den Erhalt einer konkreten Version. Sie ist keine elektronische Unterschrift.</p>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter><Button variant="outline" onClick={() => setUploadOpen(false)} disabled={isPending}>Abbrechen</Button><Button onClick={() => void submitUpload()} disabled={isPending}>{isPending && <Loader2 className="size-4 animate-spin" />}Hochladen</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
