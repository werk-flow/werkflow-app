"use client";

import { useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

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
          <div className="space-y-2">
            <Label htmlFor="maintenance-client">Kunde</Label>
            <Select
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
            >
              <SelectTrigger id="maintenance-client">
                <SelectValue placeholder="Kunde wählen" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="maintenance-site">Einsatzort</Label>
            <Select
              value={form.siteId}
              onValueChange={(siteId) =>
                setForm((value) => ({
                  ...value,
                  siteId,
                  maintenanceCoverageId: "",
                  equipmentIds: [],
                }))
              }
              disabled={!client || Boolean(initial)}
            >
              <SelectTrigger id="maintenance-site">
                <SelectValue placeholder="Einsatzort wählen" />
              </SelectTrigger>
              <SelectContent>
                {client?.sites.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="maintenance-coverage">
              Operative Abdeckung (optional)
            </Label>
            <Select
              value={form.maintenanceCoverageId || "none"}
              onValueChange={(maintenanceCoverageId) =>
                setForm((value) => ({
                  ...value,
                  maintenanceCoverageId:
                    maintenanceCoverageId === "none"
                      ? ""
                      : maintenanceCoverageId,
                }))
              }
              disabled={!site || Boolean(initial)}
            >
              <SelectTrigger id="maintenance-coverage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Keine Abdeckung verknüpfen</SelectItem>
                {availableCoverages.map((coverage) => (
                  <SelectItem key={coverage.id} value={coverage.id}>
                    {coverage.coverageNumber}
                    {coverage.reference ? ` · ${coverage.reference}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="maintenance-template">
              Veröffentlichte Arbeitsvorlage
            </Label>
            <Select
              value={form.templateVersionId}
              onValueChange={(templateVersionId) =>
                setForm((value) => ({ ...value, templateVersionId }))
              }
            >
              <SelectTrigger id="maintenance-template">
                <SelectValue placeholder="Arbeitsvorlage wählen" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem
                    key={template.versionId}
                    value={template.versionId}
                  >
                    {template.name} · Version {template.versionNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="maintenance-effective">Gültig ab</Label>
            <DatePicker
              id="maintenance-effective"
              ariaLabel="Gültig ab"
              value={toLocalDate(form.effectiveFromDate)}
              onChange={(date) =>
                setForm((value) => ({
                  ...value,
                  effectiveFromDate: date ? formatBerlinLocalDate(date) : "",
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maintenance-first-due">Erste Fälligkeit</Label>
            <DatePicker
              id="maintenance-first-due"
              ariaLabel="Erste Fälligkeit"
              value={toLocalDate(form.firstDueDate)}
              onChange={(date) =>
                setForm((value) => ({
                  ...value,
                  firstDueDate: date ? formatBerlinLocalDate(date) : "",
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maintenance-interval">Intervall in Monaten</Label>
            <QuantityStepper
              id="maintenance-interval"
              min={1}
              value={form.intervalMonths}
              onChange={(intervalMonths) =>
                setForm((value) => ({ ...value, intervalMonths }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maintenance-duration">
              Geplante Dauer in Minuten
            </Label>
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="maintenance-window-before">
              Frühestens (Tage vorher)
            </Label>
            <QuantityStepper
              id="maintenance-window-before"
              min={0}
              value={form.dueWindowBeforeDays}
              onChange={(dueWindowBeforeDays) =>
                setForm((value) => ({ ...value, dueWindowBeforeDays }))
              }
              unitLabel="Tage"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maintenance-window-after">
              Spätestens (Tage danach)
            </Label>
            <QuantityStepper
              id="maintenance-window-after"
              min={0}
              value={form.dueWindowAfterDays}
              onChange={(dueWindowAfterDays) =>
                setForm((value) => ({ ...value, dueWindowAfterDays }))
              }
              unitLabel="Tage"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="maintenance-basis">
              Nächste Fälligkeit berechnen
            </Label>
            <Select
              value={form.nextDueBasis}
              onValueChange={(nextDueBasis) =>
                setForm((value) => ({
                  ...value,
                  nextDueBasis: nextDueBasis as MaintenanceNextDueBasis,
                }))
              }
            >
              <SelectTrigger id="maintenance-basis">
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
          </div>
          {site?.equipment.length ? (
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium">
                Anlagen im Wartungsumfang
              </legend>
              <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
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
            </fieldset>
          ) : site ? (
            <p
              role="alert"
              className="sm:col-span-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm"
            >
              An diesem Einsatzort ist noch keine aktive Anlage erfasst.
            </p>
          ) : null}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="maintenance-instructions">
              Hinweise für die Ausführung
            </Label>
            <Textarea
              id="maintenance-instructions"
              value={form.operationalInstructions}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  operationalInstructions: event.target.value,
                }))
              }
              placeholder="Zugang, Prüfhinweise oder Besonderheiten für den Einsatz"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="maintenance-overlap">
              Begründung bei Überschneidung (falls erforderlich)
            </Label>
            <Textarea
              id="maintenance-overlap"
              value={form.overlapReason}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  overlapReason: event.target.value,
                }))
              }
              placeholder="Warum darf dieselbe Anlage in mehreren laufenden Plänen enthalten sein?"
            />
          </div>
          {initial ? (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="maintenance-reason">
                Grund der neuen Revision
              </Label>
              <Input
                id="maintenance-reason"
                value={form.reason}
                onChange={(event) =>
                  setForm((value) => ({ ...value, reason: event.target.value }))
                }
              />
            </div>
          ) : (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="maintenance-status">Startstatus</Label>
              <Select
                value={form.status}
                onValueChange={(status) =>
                  setForm((value) => ({
                    ...value,
                    status: status as FormState["status"],
                  }))
                }
              >
                <SelectTrigger id="maintenance-status">
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
            </div>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Abbrechen
          </Button>
          <Button type="button" onClick={() => void run()} disabled={isPending}>
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
