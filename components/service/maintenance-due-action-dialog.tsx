"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
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
import { DurationHoursInput } from "@/components/ui/duration-hours-input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TimeInput } from "@/components/ui/time-input";
import { useServerAction } from "@/hooks/use-server-action";
import {
  completeMaintenanceDueWork,
  createMaintenanceVisit,
  getMaintenanceEvidenceOptions,
  linkMaintenanceServiceCase,
  scheduleMaintenanceVisit,
  setMaintenanceDueException,
} from "@/lib/maintenance/actions";
import {
  MAINTENANCE_SCOPE_OUTCOMES,
  MAINTENANCE_SCOPE_OUTCOME_LABELS,
  type MaintenanceDueItem,
  type MaintenanceEvidenceOption,
  type MaintenanceScopeOutcome,
  type MaintenanceWorkspace,
} from "@/lib/maintenance/types";
import { formatBerlinLocalDate } from "@/lib/planning/date-time";
import {
  formatMinutesAsHoursInput,
  parseHoursInputToMinutes,
} from "@/lib/jobs/planned-working";

function toLocalDate(value: string): Date | undefined {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : undefined;
}

type ActionKind =
  | "create_visit"
  | "schedule"
  | "complete"
  | "link_service_case"
  | "skipped"
  | "cancelled"
  | "superseded";

export function MaintenanceDueActionDialog({
  open,
  onOpenChange,
  due,
  defaultAction,
  plannedDurationMinutes,
  serviceCases,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  due: MaintenanceDueItem;
  defaultAction: ActionKind;
  plannedDurationMinutes: number;
  serviceCases: MaintenanceWorkspace["serviceCases"];
}): ReactElement {
  const router = useRouter();
  const [action, setAction] = useState<ActionKind>(defaultAction);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(due.dueDate);
  const [time, setTime] = useState("08:00");
  const [durationHours, setDurationHours] = useState(
    formatMinutesAsHoursInput(plannedDurationMinutes),
  );
  const [scopeOutcome, setScopeOutcome] =
    useState<MaintenanceScopeOutcome>("complete");
  const [completedOn, setCompletedOn] = useState(
    formatBerlinLocalDate(new Date()),
  );
  const [evidence, setEvidence] = useState<MaintenanceEvidenceOption[]>([]);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [isEvidenceLoading, setIsEvidenceLoading] = useState(true);
  const [evidenceLoadFailed, setEvidenceLoadFailed] = useState(false);
  const [serviceCaseId, setServiceCaseId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!open || !due.jobId) return;
    let current = true;
    void getMaintenanceEvidenceOptions(due.jobId)
      .then((result) => {
        if (!current) return;
        if (result.success) {
          setEvidence(result.options);
        } else {
          setEvidence([]);
          setEvidenceLoadFailed(true);
        }
        setIsEvidenceLoading(false);
      })
      .catch(() => {
        if (!current) return;
        setEvidence([]);
        setEvidenceLoadFailed(true);
        setIsEvidenceLoading(false);
      });
    return () => {
      current = false;
    };
  }, [due.jobId, open]);
  const { run, isPending } = useServerAction(async () => {
    setError(null);
    let result;
    if (action === "create_visit") {
      result = await createMaintenanceVisit({
        dueWorkIds: [due.id],
        expectedVersions: [due.version],
        reason: reason || "Wartungsauftrag angelegt",
        idempotencyKey: idempotencyKey.current,
      });
    } else if (action === "schedule" && due.jobId) {
      result = await scheduleMaintenanceVisit({
        dueWorkId: due.id,
        expectedVersion: due.version,
        jobId: due.jobId,
        startsAtLocal: `${date}T${time}`,
        durationMinutes: parseHoursInputToMinutes(durationHours) ?? 0,
        idempotencyKey: idempotencyKey.current,
      });
    } else if (action === "complete") {
      result = await completeMaintenanceDueWork({
        dueWorkId: due.id,
        expectedVersion: due.version,
        scopeOutcome,
        completedOn,
        workArtifactRevisionIds: evidenceIds,
        reason: reason || "Wartungsumfang dokumentiert",
        idempotencyKey: idempotencyKey.current,
      });
    } else if (action === "link_service_case") {
      result = await linkMaintenanceServiceCase({
        planId: due.planId,
        dueWorkId: due.id,
        expectedDueVersion: due.version,
        serviceCaseId,
        reason,
        idempotencyKey: idempotencyKey.current,
      });
    } else if (["skipped", "cancelled", "superseded"].includes(action)) {
      result = await setMaintenanceDueException({
        dueWorkId: due.id,
        expectedVersion: due.version,
        toStatus: action,
        reason,
        idempotencyKey: idempotencyKey.current,
      });
    } else {
      result = { success: false as const, error: "invalid_input" };
    }
    if (!result.success) {
      const messages: Record<string, string> = {
        invalid_input: "Bitte prüfe die Angaben.",
        maintenance_stale_version:
          "Die Fälligkeit wurde inzwischen geändert. Bitte lade die Seite neu.",
        maintenance_due_evidence_required:
          "Wähle mindestens einen versionierten Arbeitsnachweis.",
        maintenance_due_evidence_mismatch:
          "Ein gewählter Nachweis gehört nicht zu diesem Auftrag.",
        maintenance_completion_date_invalid:
          "Das Abschlussdatum muss im Wartungsfenster liegen und darf nicht in der Zukunft liegen.",
        maintenance_due_batch_incompatible:
          "Diese Fälligkeiten können nicht in einem Auftrag zusammengeführt werden.",
      };
      setError(
        messages[result.error] ??
          "Die Wartungsaktion konnte nicht gespeichert werden.",
      );
      return;
    }
    onOpenChange(false);
    router.refresh();
  });
  const canSchedule =
    due.status === "visit_created" && !due.planningOccurrenceId;
  const canComplete = due.status === "visit_created";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Fälligkeit bearbeiten</DialogTitle>
          <DialogDescription>
            {due.planNumber} · fällig am{" "}
            {new Intl.DateTimeFormat("de-DE").format(
              new Date(`${due.dueDate}T12:00:00Z`),
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="due-action">Aktion</Label>
            <Select
              value={action}
              onValueChange={(value) => setAction(value as ActionKind)}
            >
              <SelectTrigger id="due-action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {due.status === "open" && (
                  <SelectItem value="create_visit">
                    Wartungsauftrag anlegen
                  </SelectItem>
                )}
                {canSchedule && (
                  <SelectItem value="schedule">
                    Termin im Kalender planen
                  </SelectItem>
                )}
                {canComplete && (
                  <SelectItem value="complete">Wartung abschließen</SelectItem>
                )}
                {serviceCases.length > 0 && (
                  <SelectItem value="link_service_case">
                    Reaktiven Servicefall verknüpfen
                  </SelectItem>
                )}
                <SelectItem value="skipped">Fälligkeit überspringen</SelectItem>
                <SelectItem value="cancelled">Fälligkeit absagen</SelectItem>
                <SelectItem value="superseded">
                  Durch andere Fälligkeit ersetzen
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {action === "schedule" && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="due-date">Datum</Label>
                <DatePicker
                  id="due-date"
                  ariaLabel="Datum"
                  value={toLocalDate(date)}
                  onChange={(value) =>
                    setDate(value ? formatBerlinLocalDate(value) : "")
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="due-time">Uhrzeit</Label>
                <TimeInput id="due-time" value={time} onChange={setTime} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="due-duration">Dauer (Stunden)</Label>
                <DurationHoursInput
                  id="due-duration"
                  value={durationHours}
                  onChange={setDurationHours}
                />
              </div>
            </div>
          )}
          {action === "complete" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="due-outcome">Ergebnis</Label>
                  <Select
                    value={scopeOutcome}
                    onValueChange={(value) =>
                      setScopeOutcome(value as MaintenanceScopeOutcome)
                    }
                  >
                    <SelectTrigger id="due-outcome">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MAINTENANCE_SCOPE_OUTCOMES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {MAINTENANCE_SCOPE_OUTCOME_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="due-completed">Abgeschlossen am</Label>
                  <DatePicker
                    id="due-completed"
                    ariaLabel="Abgeschlossen am"
                    value={toLocalDate(completedOn)}
                    onChange={(value) =>
                      setCompletedOn(value ? formatBerlinLocalDate(value) : "")
                    }
                  />
                </div>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  Versionierte Arbeitsnachweise
                </legend>
                {isEvidenceLoading ? (
                  <p className="rounded-md border p-3 text-sm text-muted-foreground">
                    Arbeitsnachweise werden geladen…
                  </p>
                ) : evidenceLoadFailed ? (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    Die Arbeitsnachweise konnten nicht geladen werden. Schließe
                    den Dialog und versuche es erneut.
                  </p>
                ) : evidence.length ? (
                  <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
                    {evidence.map((option) => (
                      <label
                        key={option.revisionId}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={evidenceIds.includes(option.revisionId)}
                          onCheckedChange={(checked) =>
                            setEvidenceIds((ids) =>
                              checked
                                ? [...ids, option.revisionId]
                                : ids.filter((id) => id !== option.revisionId),
                            )
                          }
                        />
                        <span>
                          {option.title} · Revision {option.revisionNumber}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
                    Für diesen Auftrag liegt noch kein versionierter
                    Arbeitsnachweis vor.
                  </p>
                )}
              </fieldset>
            </>
          )}
          {action === "link_service_case" && (
            <div className="space-y-2">
              <Label htmlFor="maintenance-service-case">Servicefall</Label>
              <SearchableSelect
                id="maintenance-service-case"
                value={serviceCaseId}
                onChange={setServiceCaseId}
                options={serviceCases.map((serviceCase) => ({
                  value: serviceCase.id,
                  label: `${serviceCase.caseNumber} · ${serviceCase.summary}`,
                }))}
                placeholder="Servicefall suchen"
                emptyMessage="Kein passender Servicefall gefunden"
              />
            </div>
          )}
          {action !== "schedule" && (
            <div className="space-y-2">
              <Label htmlFor="due-reason">
                {action === "create_visit" || action === "complete"
                  ? "Notiz (optional)"
                  : "Begründung"}
              </Label>
              <Textarea
                id="due-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
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
          <Button
            type="button"
            onClick={() => void run()}
            disabled={
              isPending ||
              (action === "complete" &&
                (isEvidenceLoading ||
                  evidenceLoadFailed ||
                  evidenceIds.length === 0))
            }
          >
            {isPending ? "Speichert…" : "Aktion ausführen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
