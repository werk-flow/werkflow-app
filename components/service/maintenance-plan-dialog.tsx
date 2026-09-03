"use client";

import { useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

import { ClientSelectWithCreate } from "@/components/auftraege/client-select-with-create";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
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
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { useServerAction } from "@/hooks/use-server-action";
import {
  createMaintenancePlan,
  reviseMaintenancePlan,
} from "@/lib/maintenance/actions";
import {
  MAINTENANCE_NEXT_DUE_BASES,
  MAINTENANCE_NEXT_DUE_BASIS_LABELS,
  type MaintenanceClientOption,
  type MaintenanceCoverageItem,
  type MaintenanceNextDueBasis,
  type MaintenancePlanItem,
  type MaintenanceTemplateOption,
} from "@/lib/maintenance/types";
import { formatBerlinLocalDate } from "@/lib/planning/date-time";

function toLocalDate(value: string): Date | undefined {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : undefined;
}

type FormState = {
  clientId: string;
  siteId: string;
  maintenanceCoverageId: string;
  status: "draft" | "active";
  templateVersionId: string;
  effectiveFromDate: string;
  firstDueDate: string;
  intervalMonths: string;
  dueWindowBeforeDays: string;
  dueWindowAfterDays: string;
  plannedDurationMinutes: string;
  nextDueBasis: MaintenanceNextDueBasis;
  operationalInstructions: string;
  overlapReason: string;
  reason: string;
  equipmentIds: string[];
};

const EMPTY_FORM: FormState = {
  clientId: "",
  siteId: "",
  maintenanceCoverageId: "",
  status: "active",
  templateVersionId: "",
  effectiveFromDate: "",
  firstDueDate: "",
  intervalMonths: "12",
  dueWindowBeforeDays: "14",
  dueWindowAfterDays: "14",
  plannedDurationMinutes: "120",
  nextDueBasis: "planned_due_date",
  operationalInstructions: "",
  overlapReason: "",
  reason: "Wartungsplan angelegt",
  equipmentIds: [],
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: "Bitte prüfe die Angaben und wähle mindestens eine Anlage.",
  maintenance_plan_equipment_mismatch:
    "Mindestens eine Anlage gehört nicht zu diesem Einsatzort oder ist nicht mehr verfügbar.",
  maintenance_plan_coverage_mismatch:
    "Die gewählte Abdeckung gehört nicht zu diesem Kunden und Einsatzort.",
  maintenance_template_version_unavailable:
    "Die gewählte Arbeitsvorlage ist nicht mehr veröffentlicht.",
  maintenance_overlap_reason_required:
    "Für Anlagen mit einem weiteren aktiven Wartungsplan ist eine Begründung erforderlich.",
  maintenance_stale_version:
    "Der Wartungsplan wurde inzwischen geändert. Bitte lade die Seite neu.",
  maintenance_generation_failed:
    "Der Wartungsplan wurde gespeichert, aber die Fälligkeiten konnten nicht erzeugt werden. Lade die Seite neu und versuche die Aktivierung erneut.",
};

type RequiredField =
  | "clientId"
  | "siteId"
  | "templateVersionId"
  | "effectiveFromDate"
  | "firstDueDate"
  | "equipmentIds"
  | "reason";

// Focus order on a failed submit; the ids double as the spec selectors.
const REQUIRED_FIELD_IDS: Array<[RequiredField, string]> = [
  ["clientId", "maintenance-client"],
  ["siteId", "maintenance-site"],
  ["templateVersionId", "maintenance-template"],
  ["effectiveFromDate", "maintenance-effective"],
  ["firstDueDate", "maintenance-first-due"],
  ["reason", "maintenance-reason"],
  ["equipmentIds", "maintenance-equipment"],
];

// Mirrors maintenancePlanSchema so the user sees the missing field instead of
// the generic invalid_input message.
function missingFields(
  form: FormState,
  isRevision: boolean,
): Partial<Record<RequiredField, string>> {
  const errors: Partial<Record<RequiredField, string>> = {};
  if (!form.clientId) errors.clientId = "Bitte wähle einen Kunden.";
  if (!form.siteId) errors.siteId = "Bitte wähle einen Einsatzort.";
  if (!form.templateVersionId) {
    errors.templateVersionId = "Bitte wähle eine veröffentlichte Arbeitsvorlage.";
  }
  if (!form.effectiveFromDate) {
    errors.effectiveFromDate = "Bitte gib an, ab wann der Plan gilt.";
  }
  if (!form.firstDueDate) {
    errors.firstDueDate = "Bitte gib die erste Fälligkeit an.";
  }
  if (form.siteId && form.equipmentIds.length === 0) {
    errors.equipmentIds = "Wähle mindestens eine Anlage für den Wartungsumfang.";
  }
  if (isRevision && form.reason.trim().length < 3) {
    errors.reason = "Bitte gib einen Grund mit mindestens 3 Zeichen an.";
  }
  return errors;
}

function formFromPlan(plan: MaintenancePlanItem): FormState {
  return {
    clientId: plan.clientId,
    siteId: plan.siteId,
    maintenanceCoverageId: plan.maintenanceCoverageId ?? "",
    status: plan.status === "active" ? "active" : "draft",
    templateVersionId: plan.templateVersionId,
    effectiveFromDate: plan.effectiveFromDate,
    firstDueDate: plan.firstDueDate,
    intervalMonths: String(plan.intervalMonths),
    dueWindowBeforeDays: String(plan.dueWindowBeforeDays),
    dueWindowAfterDays: String(plan.dueWindowAfterDays),
    plannedDurationMinutes: String(plan.plannedDurationMinutes),
    nextDueBasis: plan.nextDueBasis,
    operationalInstructions: plan.operationalInstructions ?? "",
    overlapReason: plan.overlapReason ?? "",
    reason: "Wartungsumfang angepasst",
    equipmentIds: plan.equipment.map((equipment) => equipment.id),
  };
}

export function MaintenancePlanDialog({
  open,
  onOpenChange,
  clients,
  templates,
  coverages,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: MaintenanceClientOption[];
  templates: MaintenanceTemplateOption[];
  coverages: MaintenanceCoverageItem[];
  initial?: MaintenancePlanItem;
}): ReactElement {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() =>
    initial ? formFromPlan(initial) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const mutationIdentity = useRef({
    planId: initial?.id ?? crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  });
  const client = clients.find((item) => item.id === form.clientId);
  const site = client?.sites.find((item) => item.id === form.siteId);
  const availableCoverages = coverages.filter(
    (coverage) =>
      coverage.clientId === form.clientId && coverage.siteId === form.siteId,
  );
  const { run, isPending } = useServerAction(async () => {
    setError(null);
    const shared = {
      planId: mutationIdentity.current.planId,
      revisionId: mutationIdentity.current.revisionId,
      clientId: form.clientId,
      siteId: form.siteId,
      maintenanceCoverageId: form.maintenanceCoverageId || null,
      status: form.status,
      templateVersionId: form.templateVersionId,
      effectiveFromDate: form.effectiveFromDate,
      firstDueDate: form.firstDueDate,
      intervalMonths: Number(form.intervalMonths),
      dueWindowBeforeDays: Number(form.dueWindowBeforeDays),
      dueWindowAfterDays: Number(form.dueWindowAfterDays),
      plannedDurationMinutes: Number(form.plannedDurationMinutes),
      nextDueBasis: form.nextDueBasis,
      operationalInstructions: form.operationalInstructions || null,
      overlapReason: form.overlapReason || null,
      reason: form.reason,
      equipmentIds: form.equipmentIds,
      idempotencyKey: mutationIdentity.current.idempotencyKey,
    };
    const result = initial
      ? await reviseMaintenancePlan({
          ...shared,
          expectedVersion: initial.version,
        })
      : await createMaintenancePlan(shared);
    if (!result.success) {
      setError(
        ERROR_MESSAGES[result.error] ??
          "Der Wartungsplan konnte nicht gespeichert werden.",
      );
      return;
    }
    onOpenChange(false);
    router.refresh();
  });
  const fieldErrors = attempted ? missingFields(form, Boolean(initial)) : {};

  function submit(): void {
    setError(null);
    setAttempted(true);
    const errors = missingFields(form, Boolean(initial));
    const firstInvalid = REQUIRED_FIELD_IDS.find(([key]) => errors[key]);
    if (firstInvalid) {
      document.getElementById(firstInvalid[1])?.focus();
      return;
    }
    void run();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {initial ? "Wartungsplan überarbeiten" : "Wartungsplan anlegen"}
          </DialogTitle>
          <DialogDescription>
            Der Plan gilt für genau einen Kunden und Einsatzort. Spätere
            Änderungen erzeugen eine neue Revision und verändern frühere
            Fälligkeiten nicht rückwirkend.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <Field
            label="Kunde"
            htmlFor="maintenance-client"
            required
            error={fieldErrors.clientId}
          >
            <ClientSelectWithCreate
              clients={clients}
              value={form.clientId}
              onValueChange={(clientId) =>
                setForm((value) => ({
                  ...value,
                  clientId,
                  siteId: "",
                  maintenanceCoverageId: "",
                  equipmentIds: [],
                }))
              }
              disabled={Boolean(initial)}
            />
          </Field>
          <Field
            label="Einsatzort"
            htmlFor="maintenance-site"
            required
            error={fieldErrors.siteId}
          >
            <SearchableSelect
              value={form.siteId}
              onChange={(siteId) =>
                setForm((value) => ({
                  ...value,
                  siteId,
                  maintenanceCoverageId: "",
                  equipmentIds: [],
                }))
              }
              options={(client?.sites ?? []).map((item) => ({
                value: item.id,
                label: item.name,
                description: item.address,
              }))}
              disabled={!client || Boolean(initial)}
              placeholder="Einsatzort wählen"
              searchPlaceholder="Einsatzort suchen…"
              emptyMessage="Kein Einsatzort gefunden"
            />
          </Field>
          <Field
            label="Operative Abdeckung (optional)"
            htmlFor="maintenance-coverage"
            className="sm:col-span-2"
          >
            <SearchableSelect
              value={form.maintenanceCoverageId}
              onChange={(maintenanceCoverageId) =>
                setForm((value) => ({ ...value, maintenanceCoverageId }))
              }
              options={availableCoverages.map((coverage) => ({
                value: coverage.id,
                label: `${coverage.coverageNumber}${coverage.reference ? ` · ${coverage.reference}` : ""}`,
              }))}
              disabled={!site || Boolean(initial)}
              placeholder="Keine Abdeckung verknüpfen"
              searchPlaceholder="Abdeckung suchen…"
              emptyMessage="Keine Abdeckung gefunden"
              allowNone
              noneLabel="Keine Abdeckung verknüpfen"
            />
          </Field>
          <Field
            label="Veröffentlichte Arbeitsvorlage"
            htmlFor="maintenance-template"
            required
            error={fieldErrors.templateVersionId}
            className="sm:col-span-2"
          >
            <SearchableSelect
              value={form.templateVersionId}
              onChange={(templateVersionId) =>
                setForm((value) => ({ ...value, templateVersionId }))
              }
              options={templates.map((template) => ({
                value: template.versionId,
                label: `${template.name} · Version ${template.versionNumber}`,
              }))}
              placeholder="Arbeitsvorlage wählen"
              searchPlaceholder="Arbeitsvorlage suchen…"
              emptyMessage="Keine veröffentlichte Arbeitsvorlage gefunden"
            />
          </Field>
          <Field
            label="Gültig ab"
            htmlFor="maintenance-effective"
            required
            error={fieldErrors.effectiveFromDate}
          >
            <DatePicker
              ariaLabel="Gültig ab"
              value={toLocalDate(form.effectiveFromDate)}
              onChange={(date) =>
                setForm((value) => ({
                  ...value,
                  effectiveFromDate: date ? formatBerlinLocalDate(date) : "",
                }))
              }
            />
          </Field>
          <Field
            label="Erste Fälligkeit"
            htmlFor="maintenance-first-due"
            required
            error={fieldErrors.firstDueDate}
          >
            <DatePicker
              ariaLabel="Erste Fälligkeit"
              value={toLocalDate(form.firstDueDate)}
              onChange={(date) =>
                setForm((value) => ({
                  ...value,
                  firstDueDate: date ? formatBerlinLocalDate(date) : "",
                }))
              }
            />
          </Field>
          <Field label="Intervall in Monaten" htmlFor="maintenance-interval">
            <QuantityStepper
              id="maintenance-interval"
              min={1}
              value={form.intervalMonths}
              onChange={(intervalMonths) =>
                setForm((value) => ({ ...value, intervalMonths }))
              }
            />
          </Field>
          <Field
            label="Geplante Dauer in Minuten"
            htmlFor="maintenance-duration"
          >
            <QuantityStepper
              id="maintenance-duration"
              min={15}
              step={15}
              value={form.plannedDurationMinutes}
              onChange={(plannedDurationMinutes) =>
                setForm((value) => ({ ...value, plannedDurationMinutes }))
              }
              unitLabel="Min."
            />
          </Field>
          <Field
            label="Frühestens (Tage vorher)"
            htmlFor="maintenance-window-before"
          >
            <QuantityStepper
              id="maintenance-window-before"
              min={0}
              value={form.dueWindowBeforeDays}
              onChange={(dueWindowBeforeDays) =>
                setForm((value) => ({ ...value, dueWindowBeforeDays }))
              }
              unitLabel="Tage"
            />
          </Field>
          <Field
            label="Spätestens (Tage danach)"
            htmlFor="maintenance-window-after"
          >
            <QuantityStepper
              id="maintenance-window-after"
              min={0}
              value={form.dueWindowAfterDays}
              onChange={(dueWindowAfterDays) =>
                setForm((value) => ({ ...value, dueWindowAfterDays }))
              }
              unitLabel="Tage"
            />
          </Field>
          <Field
            label="Nächste Fälligkeit berechnen"
            htmlFor="maintenance-basis"
            className="sm:col-span-2"
          >
            <Select
              value={form.nextDueBasis}
              onValueChange={(nextDueBasis) =>
                setForm((value) => ({
                  ...value,
                  nextDueBasis: nextDueBasis as MaintenanceNextDueBasis,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAINTENANCE_NEXT_DUE_BASES.map((basis) => (
                  <SelectItem key={basis} value={basis}>
                    {MAINTENANCE_NEXT_DUE_BASIS_LABELS[basis]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {site?.equipment.length ? (
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium">
                Anlagen im Wartungsumfang
              </legend>
              <div
                id="maintenance-equipment"
                tabIndex={-1}
                className="grid gap-2 rounded-md border p-3 sm:grid-cols-2"
              >
                {site.equipment.map((equipment) => (
                  <label
                    key={equipment.id}
                    className="flex items-start gap-2 text-sm"
                  >
                    <Checkbox
                      checked={form.equipmentIds.includes(equipment.id)}
                      onCheckedChange={(checked) =>
                        setForm((value) => ({
                          ...value,
                          equipmentIds: checked
                            ? [...value.equipmentIds, equipment.id]
                            : value.equipmentIds.filter(
                                (id) => id !== equipment.id,
                              ),
                        }))
                      }
                    />
                    <span>
                      <span className="block font-medium">
                        {equipment.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {equipment.equipmentNumber}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <ErrorText>{fieldErrors.equipmentIds}</ErrorText>
            </fieldset>
          ) : site ? (
            <p
              role="status"
              className="sm:col-span-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm"
            >
              An diesem Einsatzort ist noch keine aktive Anlage erfasst.
            </p>
          ) : null}
          <Field
            label="Hinweise für die Ausführung"
            htmlFor="maintenance-instructions"
            className="sm:col-span-2"
          >
            <Textarea
              value={form.operationalInstructions}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  operationalInstructions: event.target.value,
                }))
              }
              placeholder="Zugang, Prüfhinweise oder Besonderheiten für den Einsatz"
            />
          </Field>
          <Field
            label="Begründung bei Überschneidung (falls erforderlich)"
            htmlFor="maintenance-overlap"
            className="sm:col-span-2"
          >
            <Textarea
              value={form.overlapReason}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  overlapReason: event.target.value,
                }))
              }
              placeholder="Warum darf dieselbe Anlage in mehreren laufenden Plänen enthalten sein?"
            />
          </Field>
          {initial ? (
            <Field
              label="Grund der neuen Revision"
              htmlFor="maintenance-reason"
              required
              error={fieldErrors.reason}
              className="sm:col-span-2"
            >
              <Input
                value={form.reason}
                onChange={(event) =>
                  setForm((value) => ({ ...value, reason: event.target.value }))
                }
              />
            </Field>
          ) : (
            <Field
              label="Startstatus"
              htmlFor="maintenance-status"
              className="sm:col-span-2"
            >
              <Select
                value={form.status}
                onValueChange={(status) =>
                  setForm((value) => ({
                    ...value,
                    status: status as FormState["status"],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">
                    Aktiv – Fälligkeiten jetzt erzeugen
                  </SelectItem>
                  <SelectItem value="draft">
                    Entwurf – noch keine Fälligkeiten
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
        <ErrorText>{error}</ErrorText>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Abbrechen
          </Button>
          <Button type="button" onClick={submit} disabled={isPending}>
            {isPending
              ? "Speichert…"
              : initial
                ? "Neue Revision speichern"
                : "Wartungsplan anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
