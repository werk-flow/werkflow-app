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
import { ErrorText } from "@/components/ui/error-text";
import { SectionError } from "@/components/ui/section-error";
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

type RequiredField =
  | "date"
  | "durationHours"
  | "completedOn"
  | "evidenceIds"
  | "serviceCaseId"
  | "reason";

// Focus order on a failed submit.
const REQUIRED_FIELD_IDS: Array<[RequiredField, string]> = [
  ["date", "due-date"],
  ["durationHours", "due-duration"],
  ["completedOn", "due-completed"],
  ["serviceCaseId", "maintenance-service-case"],
  ["reason", "due-reason"],
  ["evidenceIds", "due-evidence"],
];

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
  const [attempted, setAttempted] = useState(false);
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
  // The reason field is hidden for schedule, so it must never count as missing there.
  const showReason = action !== "schedule";
  const reasonRequired =
    showReason && action !== "create_visit" && action !== "complete";

  // Mirrors the maintenance validation schemas per action so the user sees the
  // missing field instead of the generic invalid_input message.
  function missingFields(): Partial<Record<RequiredField, string>> {
    const errors: Partial<Record<RequiredField, string>> = {};
    if (action === "schedule") {
      if (!date) errors.date = "Bitte wähle ein Datum.";
      if ((parseHoursInputToMinutes(durationHours) ?? 0) < 15) {
        errors.durationHours = "Bitte gib mindestens 0,25 Stunden an.";
      }
    }
    if (action === "complete") {
      if (!completedOn) errors.completedOn = "Bitte gib das Abschlussdatum an.";
      if (evidenceIds.length === 0) {
        errors.evidenceIds = "Wähle mindestens einen versionierten Arbeitsnachweis.";
      }
    }
    if (action === "link_service_case" && !serviceCaseId) {
      errors.serviceCaseId = "Bitte wähle einen Servicefall.";
    }
    if (reasonRequired && reason.trim().length < 3) {
      errors.reason = "Bitte gib eine Begründung mit mindestens 3 Zeichen an.";
    }
    return errors;
  }
  const fieldErrors = attempted ? missingFields() : {};

  function submit(): void {
    setError(null);
    setAttempted(true);
    const errors = missingFields();
    const firstInvalid = REQUIRED_FIELD_IDS.find(([key]) => errors[key]);
    if (firstInvalid) {
      document.getElementById(firstInvalid[1])?.focus();
      return;
    }
    void run();
  }

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
          <Field label="Aktion" htmlFor="due-action">
            <Select
              value={action}
              onValueChange={(value) => setAction(value as ActionKind)}
            >
              <SelectTrigger>
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
          </Field>
          {action === "schedule" && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Datum" htmlFor="due-date" required error={fieldErrors.date}>
                <DatePicker
                  ariaLabel="Datum"
                  value={toLocalDate(date)}
                  onChange={(value) =>
                    setDate(value ? formatBerlinLocalDate(value) : "")
                  }
                />
              </Field>
              <Field label="Uhrzeit" htmlFor="due-time" required>
                <TimeInput value={time} onChange={setTime} />
              </Field>
              <Field
                label="Dauer (Stunden)"
                htmlFor="due-duration"
                required
                error={fieldErrors.durationHours}
              >
                <DurationHoursInput
                  id="due-duration"
                  value={durationHours}
                  onChange={setDurationHours}
                />
              </Field>
            </div>
          )}
          {action === "complete" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Ergebnis" htmlFor="due-outcome">
                  <Select
                    value={scopeOutcome}
                    onValueChange={(value) =>
                      setScopeOutcome(value as MaintenanceScopeOutcome)
                    }
                  >
                    <SelectTrigger>
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
                </Field>
                <Field
                  label="Abgeschlossen am"
                  htmlFor="due-completed"
                  required
                  error={fieldErrors.completedOn}
                >
                  <DatePicker
                    ariaLabel="Abgeschlossen am"
                    value={toLocalDate(completedOn)}
                    onChange={(value) =>
                      setCompletedOn(value ? formatBerlinLocalDate(value) : "")
                    }
                  />
                </Field>
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
                  <SectionError>
                    Die Arbeitsnachweise konnten nicht geladen werden. Schließe
                    den Dialog und versuche es erneut.
                  </SectionError>
                ) : evidence.length ? (
                  <div
                    id="due-evidence"
                    tabIndex={-1}
                    className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3"
                  >
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
                <ErrorText>{fieldErrors.evidenceIds}</ErrorText>
              </fieldset>
            </>
          )}
          {action === "link_service_case" && (
            <Field
              label="Servicefall"
              htmlFor="maintenance-service-case"
              required
              error={fieldErrors.serviceCaseId}
            >
              <SearchableSelect
                value={serviceCaseId}
                onChange={setServiceCaseId}
                options={serviceCases.map((serviceCase) => ({
                  value: serviceCase.id,
                  label: `${serviceCase.caseNumber} · ${serviceCase.summary}`,
                }))}
                placeholder="Servicefall suchen"
                emptyMessage="Kein passender Servicefall gefunden"
              />
            </Field>
          )}
          {showReason && (
            <Field
              label={reasonRequired ? "Begründung" : "Notiz (optional)"}
              htmlFor="due-reason"
              required={reasonRequired}
              error={fieldErrors.reason}
            >
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
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
          <Button
            type="button"
            onClick={submit}
            disabled={
              isPending ||
              (action === "complete" &&
                (isEvidenceLoading || evidenceLoadFailed))
            }
          >
            {isPending ? "Speichert…" : "Aktion ausführen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
