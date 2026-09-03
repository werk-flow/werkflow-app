"use client";

import { useMemo, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

import { ClientSelectWithCreate } from "@/components/auftraege/client-select-with-create";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorText } from "@/components/ui/error-text";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import { createServiceCase, updateServiceCase } from "@/lib/service-cases/actions";
import {
  SERVICE_CASE_CHARGE_CONTEXTS,
  SERVICE_CASE_CHARGE_CONTEXT_LABELS,
  SERVICE_CASE_STATUSES,
  SERVICE_CASE_STATUS_LABELS,
  SERVICE_CASE_URGENCY_LABELS,
  type ServiceCaseChargeContext,
  type ServiceCaseClientOption,
  type ServiceCaseDetail,
  type ServiceCaseJobOption,
  type ServiceCaseStatus,
} from "@/lib/service-cases/types";

type FormState = {
  clientId: string;
  siteId: string;
  contactId: string;
  originalStatement: string;
  originalDetails: string;
  summary: string;
  urgency: "niedrig" | "normal" | "hoch" | "notfall";
  status: ServiceCaseStatus;
  chargeContext: ServiceCaseChargeContext;
  accessInstructions: string;
  triageNote: string;
  resolutionNote: string;
  jobId: string;
  equipmentIds: string[];
  reason: string;
};

const EMPTY_FORM: FormState = {
  clientId: "",
  siteId: "",
  contactId: "",
  originalStatement: "",
  originalDetails: "",
  summary: "",
  urgency: "normal",
  status: "new",
  chargeContext: "unknown",
  accessInstructions: "",
  triageNote: "",
  resolutionNote: "",
  jobId: "",
  equipmentIds: [],
  reason: "",
};

const ERRORS: Record<string, string> = {
  invalid_input: "Bitte prüfe die Angaben.",
  service_case_stale_version:
    "Der Servicefall wurde inzwischen geändert. Bitte lade die Seite neu.",
  service_case_job_mismatch:
    "Der Auftrag gehört nicht zu diesem Kunden und Einsatzort.",
  service_case_equipment_mismatch:
    "Mindestens eine Anlage gehört nicht zu diesem Einsatzort.",
  service_case_duplicate_relation_required:
    "Verknüpfe zuerst den ursprünglichen Servicefall als Duplikat.",
  service_case_request_mismatch:
    "Die Anfrage passt nicht mehr zum zugeordneten Kunden oder Einsatzort.",
};

type RequiredField =
  | "clientId"
  | "siteId"
  | "originalStatement"
  | "summary"
  | "resolutionNote"
  | "reason";

// Focus order on a failed submit; the ids double as the spec selectors.
const REQUIRED_FIELD_IDS: Array<[RequiredField, string]> = [
  ["clientId", "service-client"],
  ["siteId", "service-site"],
  ["originalStatement", "service-statement"],
  ["summary", "service-summary"],
  ["resolutionNote", "service-resolution"],
  ["reason", "service-reason"],
];

// Mirrors the server schema (serviceCaseCreateSchema / serviceCaseUpdateSchema)
// so the user sees the missing field instead of a generic "Bitte prüfe".
function missingFields(
  form: FormState,
  isUpdate: boolean,
  terminal: boolean,
): Partial<Record<RequiredField, string>> {
  const errors: Partial<Record<RequiredField, string>> = {};
  if (!isUpdate) {
    if (!form.clientId) errors.clientId = "Bitte wähle einen Kunden.";
    if (!form.siteId) errors.siteId = "Bitte wähle einen Einsatzort.";
    if (form.originalStatement.trim().length < 2) {
      errors.originalStatement = "Bitte erfasse die Kundenaussage.";
    }
  }
  if (form.summary.trim().length < 2) {
    errors.summary = "Bitte gib eine Kurzbeschreibung ein.";
  }
  if (isUpdate && terminal && form.resolutionNote.trim().length < 3) {
    errors.resolutionNote = "Für den Abschluss ist eine Begründung erforderlich.";
  }
  if (isUpdate && form.reason.trim().length < 3) {
    errors.reason = "Bitte gib einen Grund mit mindestens 3 Zeichen an.";
  }
  return errors;
}

function fromDetail(item: ServiceCaseDetail): FormState {
  return {
    clientId: item.clientId,
    siteId: item.siteId,
    contactId: item.contactId ?? "",
    originalStatement: item.originalStatement,
    originalDetails: item.originalDetails ?? "",
    summary: item.summary,
    urgency: item.urgency,
    status: item.status,
    chargeContext: item.chargeContext,
    accessInstructions: item.accessInstructions ?? "",
    triageNote: item.triageNote ?? "",
    resolutionNote: item.resolutionNote ?? "",
    jobId: item.jobId ?? "",
    equipmentIds: item.equipment.map((equipment) => equipment.id),
    reason: "",
  };
}

export function ServiceCaseFormDialog({
  open,
  onOpenChange,
  clients,
  initial,
  jobs = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: ServiceCaseClientOption[];
  initial?: ServiceCaseDetail;
  jobs?: ServiceCaseJobOption[];
}): ReactElement {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() =>
    initial ? fromDetail(initial) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const { run, isPending } = useServerAction(async () => {
    const result = initial
      ? await updateServiceCase({
          serviceCaseId: initial.id,
          expectedVersion: initial.version,
          summary: form.summary,
          urgency: form.urgency,
          status: form.status,
          chargeContext: form.chargeContext,
          accessInstructions: form.accessInstructions,
          triageNote: form.triageNote,
          resolutionNote: form.resolutionNote,
          jobId: form.jobId || null,
          equipmentIds: form.equipmentIds,
          reason: form.reason,
          idempotencyKey: crypto.randomUUID(),
        })
      : await createServiceCase({
          serviceCaseId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          clientId: form.clientId,
          siteId: form.siteId,
          contactId: form.contactId || null,
          originalStatement: form.originalStatement,
          originalDetails: form.originalDetails,
          summary: form.summary,
          urgency: form.urgency,
          chargeContext: form.chargeContext,
          accessInstructions: form.accessInstructions,
          triageNote: form.triageNote,
          equipmentIds: form.equipmentIds,
        });
    if (!result.success) {
      setError(ERRORS[result.error] ?? "Der Servicefall konnte nicht gespeichert werden.");
      return;
    }
    onOpenChange(false);
    if (!initial) {
      router.push(`/service/faelle/${result.serviceCase.case_number}`);
    } else {
      router.refresh();
    }
  });
  const client = clients.find((item) => item.id === form.clientId);
  const site = client?.sites.find((item) => item.id === form.siteId);
  const availableJobs = useMemo(
    () => jobs.filter((job) => job.clientId === form.clientId && job.siteId === form.siteId),
    [form.clientId, form.siteId, jobs],
  );
  const terminal = ["resolved", "closed_without_visit", "duplicate"].includes(
    form.status,
  );
  const fieldErrors = attempted ? missingFields(form, Boolean(initial), terminal) : {};

  function submit(): void {
    setError(null);
    setAttempted(true);
    const errors = missingFields(form, Boolean(initial), terminal);
    const firstInvalid = REQUIRED_FIELD_IDS.find(([key]) => errors[key]);
    if (firstInvalid) {
      document.getElementById(firstInvalid[1])?.focus();
      return;
    }
    void run();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {initial ? "Servicefall bearbeiten" : "Servicefall erfassen"}
          </DialogTitle>
          <DialogDescription>
            Erfasse die technische Nachfrage. Gewährleistung und Berechnung
            bleiben bis zur späteren Prüfung ausdrücklich vorläufig.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          {!initial && (
            <>
              <Field label="Kunde" htmlFor="service-client" required error={fieldErrors.clientId}>
                <ClientSelectWithCreate
                  clients={clients}
                  value={form.clientId}
                  onValueChange={(clientId) =>
                    setForm((value) => ({
                      ...value,
                      clientId,
                      siteId: "",
                      contactId: "",
                      equipmentIds: [],
                    }))
                  }
                />
              </Field>
              <Field label="Einsatzort" htmlFor="service-site" required error={fieldErrors.siteId}>
                <SearchableSelect
                  value={form.siteId}
                  onChange={(siteId) => setForm((value) => ({ ...value, siteId, equipmentIds: [] }))}
                  options={(client?.sites ?? []).map((item) => ({ value: item.id, label: item.name, description: item.address }))}
                  disabled={!client}
                  placeholder="Einsatzort wählen"
                  searchPlaceholder="Einsatzort suchen…"
                  emptyMessage="Kein Einsatzort gefunden"
                />
              </Field>
              <Field label="Ansprechpartner (optional)" htmlFor="service-contact" className="sm:col-span-2">
                <SearchableSelect
                  value={form.contactId}
                  onChange={(contactId) => setForm((value) => ({ ...value, contactId }))}
                  options={(client?.contacts ?? []).map((item) => ({ value: item.id, label: item.name }))}
                  disabled={!client}
                  placeholder="Kein Ansprechpartner"
                  searchPlaceholder="Ansprechpartner suchen…"
                  emptyMessage="Kein Ansprechpartner gefunden"
                  allowNone
                  noneLabel="Kein Ansprechpartner"
                />
              </Field>
              <Field label="Kundenaussage" htmlFor="service-statement" required error={fieldErrors.originalStatement} className="sm:col-span-2">
                <Textarea value={form.originalStatement} onChange={(event) => setForm((value) => ({ ...value, originalStatement: event.target.value }))} placeholder="Möglichst nah an der ursprünglichen Aussage erfassen" />
              </Field>
            </>
          )}
          <Field label="Kurzbeschreibung" htmlFor="service-summary" required error={fieldErrors.summary} className="sm:col-span-2">
            <Input value={form.summary} onChange={(event) => setForm((value) => ({ ...value, summary: event.target.value }))} />
          </Field>
          <Field label="Dringlichkeit" htmlFor="service-urgency">
            <Select value={form.urgency} onValueChange={(urgency) => setForm((value) => ({ ...value, urgency: urgency as FormState["urgency"] }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(SERVICE_CASE_URGENCY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {initial && (
            <Field label="Status" htmlFor="service-status">
              <Select value={form.status} onValueChange={(status) => setForm((value) => ({ ...value, status: status as ServiceCaseStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SERVICE_CASE_STATUSES.map((value) => <SelectItem key={value} value={value}>{SERVICE_CASE_STATUS_LABELS[value]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Vorläufiger Kostenkontext" htmlFor="service-charge" className="sm:col-span-2">
            <Select value={form.chargeContext} onValueChange={(chargeContext) => setForm((value) => ({ ...value, chargeContext: chargeContext as ServiceCaseChargeContext }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SERVICE_CASE_CHARGE_CONTEXTS.map((value) => <SelectItem key={value} value={value}>{SERVICE_CASE_CHARGE_CONTEXT_LABELS[value]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {initial && (
            <Field label="Operativer Auftrag (optional)" htmlFor="service-job" className="sm:col-span-2">
              <SearchableSelect
                value={form.jobId}
                onChange={(jobId) => setForm((value) => ({ ...value, jobId }))}
                options={availableJobs.map((job) => ({ value: job.id, label: `${job.jobNumber ? `${job.jobNumber} · ` : ""}${job.title}` }))}
                placeholder="Noch kein Auftrag"
                searchPlaceholder="Auftrag suchen…"
                emptyMessage="Kein passender Auftrag gefunden"
                allowNone
                noneLabel="Noch kein Auftrag"
              />
            </Field>
          )}
          <Field label="Zugang und Hinweise vor Ort" htmlFor="service-access" className="sm:col-span-2">
            <Textarea value={form.accessInstructions} onChange={(event) => setForm((value) => ({ ...value, accessInstructions: event.target.value }))} placeholder="Zum Beispiel Zugang, Ansprechpartner oder Sicherheitsbesonderheiten" />
          </Field>
          <Field label="Interne Einschätzung" htmlFor="service-triage" className="sm:col-span-2">
            <Textarea value={form.triageNote} onChange={(event) => setForm((value) => ({ ...value, triageNote: event.target.value }))} />
          </Field>
          {site?.equipment.length ? (
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium">Betroffene Anlagen</legend>
              <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                {site.equipment.map((equipment) => (
                  <label key={equipment.id} className="flex items-start gap-2 text-sm">
                    <Checkbox checked={form.equipmentIds.includes(equipment.id)} onCheckedChange={(checked) => setForm((value) => ({ ...value, equipmentIds: checked ? [...value.equipmentIds, equipment.id] : value.equipmentIds.filter((id) => id !== equipment.id) }))} />
                    <span><span className="block font-medium">{equipment.name}</span><span className="text-xs text-muted-foreground">{equipment.equipmentNumber}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {terminal && (
            <Field label="Abschlussbegründung" htmlFor="service-resolution" required error={fieldErrors.resolutionNote} className="sm:col-span-2">
              <Textarea value={form.resolutionNote} onChange={(event) => setForm((value) => ({ ...value, resolutionNote: event.target.value }))} />
            </Field>
          )}
          {initial && (
            <Field label="Grund der Änderung" htmlFor="service-reason" required error={fieldErrors.reason} className="sm:col-span-2">
              <Input value={form.reason} onChange={(event) => setForm((value) => ({ ...value, reason: event.target.value }))} />
            </Field>
          )}
        </div>
        <ErrorText>{error}</ErrorText>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Abbrechen</Button>
          <Button type="button" onClick={submit} disabled={isPending}>{isPending ? "Speichert…" : "Speichern"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
