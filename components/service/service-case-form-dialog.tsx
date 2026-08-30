"use client";

import { useMemo, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
              <div className="space-y-2">
                <Label htmlFor="service-client">Kunde</Label>
                <Select
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
                >
                  <SelectTrigger id="service-client"><SelectValue placeholder="Kunde wählen" /></SelectTrigger>
                  <SelectContent>
                    {clients.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="service-site">Einsatzort</Label>
                <Select
                  value={form.siteId}
                  onValueChange={(siteId) => setForm((value) => ({ ...value, siteId, equipmentIds: [] }))}
                  disabled={!client}
                >
                  <SelectTrigger id="service-site"><SelectValue placeholder="Einsatzort wählen" /></SelectTrigger>
                  <SelectContent>
                    {client?.sites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="service-contact">Ansprechpartner (optional)</Label>
                <Select value={form.contactId || "none"} onValueChange={(contactId) => setForm((value) => ({ ...value, contactId: contactId === "none" ? "" : contactId }))} disabled={!client}>
                  <SelectTrigger id="service-contact"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Kein Ansprechpartner</SelectItem>{client?.contacts.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="service-statement">Kundenaussage</Label>
                <Textarea id="service-statement" value={form.originalStatement} onChange={(event) => setForm((value) => ({ ...value, originalStatement: event.target.value }))} placeholder="Möglichst nah an der ursprünglichen Aussage erfassen" />
              </div>
            </>
          )}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="service-summary">Kurzbeschreibung</Label>
            <Input id="service-summary" value={form.summary} onChange={(event) => setForm((value) => ({ ...value, summary: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="service-urgency">Dringlichkeit</Label>
            <Select value={form.urgency} onValueChange={(urgency) => setForm((value) => ({ ...value, urgency: urgency as FormState["urgency"] }))}>
              <SelectTrigger id="service-urgency"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(SERVICE_CASE_URGENCY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {initial && (
            <div className="space-y-2">
              <Label htmlFor="service-status">Status</Label>
              <Select value={form.status} onValueChange={(status) => setForm((value) => ({ ...value, status: status as ServiceCaseStatus }))}>
                <SelectTrigger id="service-status"><SelectValue /></SelectTrigger>
                <SelectContent>{SERVICE_CASE_STATUSES.map((value) => <SelectItem key={value} value={value}>{SERVICE_CASE_STATUS_LABELS[value]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="service-charge">Vorläufiger Kostenkontext</Label>
            <Select value={form.chargeContext} onValueChange={(chargeContext) => setForm((value) => ({ ...value, chargeContext: chargeContext as ServiceCaseChargeContext }))}>
              <SelectTrigger id="service-charge"><SelectValue /></SelectTrigger>
              <SelectContent>{SERVICE_CASE_CHARGE_CONTEXTS.map((value) => <SelectItem key={value} value={value}>{SERVICE_CASE_CHARGE_CONTEXT_LABELS[value]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {initial && (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="service-job">Operativer Auftrag (optional)</Label>
              <Select value={form.jobId || "none"} onValueChange={(jobId) => setForm((value) => ({ ...value, jobId: jobId === "none" ? "" : jobId }))}>
                <SelectTrigger id="service-job"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">Noch kein Auftrag</SelectItem>{availableJobs.map((job) => <SelectItem key={job.id} value={job.id}>{job.jobNumber ? `${job.jobNumber} · ` : ""}{job.title}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="service-access">Zugang und Hinweise vor Ort</Label>
            <Textarea id="service-access" value={form.accessInstructions} onChange={(event) => setForm((value) => ({ ...value, accessInstructions: event.target.value }))} placeholder="Zum Beispiel Zugang, Ansprechpartner oder Sicherheitsbesonderheiten" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="service-triage">Interne Einschätzung</Label>
            <Textarea id="service-triage" value={form.triageNote} onChange={(event) => setForm((value) => ({ ...value, triageNote: event.target.value }))} />
          </div>
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
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="service-resolution">Abschlussbegründung</Label>
              <Textarea id="service-resolution" value={form.resolutionNote} onChange={(event) => setForm((value) => ({ ...value, resolutionNote: event.target.value }))} />
            </div>
          )}
          {initial && (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="service-reason">Grund der Änderung</Label>
              <Input id="service-reason" value={form.reason} onChange={(event) => setForm((value) => ({ ...value, reason: event.target.value }))} />
            </div>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Abbrechen</Button>
          <Button type="button" onClick={() => void run()} disabled={isPending}>{isPending ? "Speichert…" : "Speichern"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
