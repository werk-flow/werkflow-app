"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactElement,
} from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CheckCircle2,
  CirclePause,
  Loader2,
  LockKeyhole,
  ParkingCircle,
  Play,
  Plus,
  RefreshCw,
  Unlink,
} from "lucide-react";

import { useRealtimeEvent } from "@/components/realtime/realtime-provider";
import { useBanner } from "@/components/ui/banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
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
import { FormDisclosure } from "@/components/ui/form-disclosure";
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
import { isFieldWorkPackReadOnly } from "@/lib/jobs/field-work-pack";
import {
  clearProjectWorkExecutionOverride,
  getWorkLifecycleSnapshot,
  getApprovedArtifactActionsForTarget,
  linkWorkDependencyArtifactApproval,
  parkWorkTarget,
  removeWorkDependency,
  reopenWorkBlocker,
  saveWorkBlocker,
  saveWorkDependency,
  searchWorkPredecessors,
  setDeclaredWorkDependencyState,
  setWorkBlockerResolved,
  transitionWorkExecution,
  unparkWorkTarget,
} from "@/lib/work-lifecycle/actions";
import {
  getAllowedWorkTransitions,
  getWorkNextAction,
  isTerminalWorkExecutionState,
  WORK_BLOCKER_REASON_LABELS,
  WORK_DEPENDENCY_EFFECT_LABELS,
  WORK_EXECUTION_LABELS,
  type WorkBlocker,
  type WorkBlockerReason,
  type WorkDeclaredDependencyKind,
  type WorkDependency,
  type WorkDependencyEffect,
  type WorkExecutionState,
  type WorkEntityOption,
  type WorkLifecycleSnapshot,
} from "@/lib/work-lifecycle/types";

const ERROR_MESSAGES: Record<string, string> = {
  work_transition_stale_version:
    "Der Arbeitsstand wurde inzwischen geändert. Die aktuelle Ansicht wurde geladen.",
  work_transition_not_allowed: "Dieser Zustandswechsel ist nicht erlaubt.",
  work_transition_not_authorized:
    "Du hast keine Berechtigung für diesen Zustandswechsel.",
  work_transition_reason_required:
    "Bitte gib einen nachvollziehbaren Grund an.",
  work_transition_start_blocked:
    "Offene Blocker oder Startvoraussetzungen verhindern den Start.",
  work_transition_completion_blocked:
    "Die Abschlussprüfungen sind noch nicht erfüllt.",
  work_transition_handover_requires_override:
    "Die Übergabe enthält noch nicht prüfbare Punkte. Bestätige die begründete Ausnahme.",
  work_blocker_stale_version: "Der Blocker wurde inzwischen geändert.",
  work_dependency_stale_version: "Die Voraussetzung wurde inzwischen geändert.",
  work_dependency_cycle: "Abhängigkeiten dürfen keinen Kreis bilden.",
  work_dependency_self: "Arbeit kann nicht von sich selbst abhängen.",
  work_action_failed: "Die Änderung konnte nicht gespeichert werden.",
};

function fromIsoDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("de-DE").format(new Date(`${value}T00:00:00`))
    : "Ohne Datum";
}

function StateIcon({ state }: { state: WorkExecutionState }) {
  if (state === "in_progress") return <Play className="size-4" />;
  if (state === "interrupted") return <CirclePause className="size-4" />;
  if (state === "cancelled") return <Ban className="size-4" />;
  if (state === "execution_complete" || state === "handed_over")
    return <CheckCircle2 className="size-4" />;
  return <RefreshCw className="size-4" />;
}

function TransitionDialog({
  snapshot,
  targetLabel,
  transition,
  isManager,
  onClose,
  onChanged,
}: {
  snapshot: WorkLifecycleSnapshot;
  targetLabel: string;
  transition: WorkExecutionState;
  isManager: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const needsReason =
    override ||
    snapshot.targetType === "project" ||
    transition === "cancelled" ||
    transition === "interrupted" ||
    transition === "handed_over" ||
    ["execution_complete", "handed_over", "cancelled"].includes(
      snapshot.executionState,
    );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await transitionWorkExecution({
        targetType: snapshot.targetType,
        targetId: snapshot.targetId,
        expectedVersion: snapshot.executionVersion,
        toState: transition,
        reason: reason.trim() || undefined,
        overrideGates: override,
      });
      if (!result.success) {
        setError(
          ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.work_action_failed,
        );
        if (result.error.includes("stale_version")) await onChanged();
        return;
      }
      await onChanged();
      onClose();
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{WORK_EXECUTION_LABELS[transition]}</DialogTitle>
            <DialogDescription>{`Arbeitsstand für „${targetLabel}“ ändern. Die Änderung wird mit Prüfstand und Version protokolliert.`}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            {needsReason && (
              <div className="space-y-2">
                <Label htmlFor="work-transition-reason">Grund</Label>
                <Textarea
                  id="work-transition-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={1000}
                  placeholder="Warum ist dieser Schritt jetzt richtig?"
                  required
                />
              </div>
            )}
            {isManager &&
              (transition === "execution_complete" ||
                transition === "handed_over") && (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={override}
                    onCheckedChange={(checked) => setOverride(checked === true)}
                  />
                  <span>
                    Manager-Ausnahme verwenden, falls eine prüfbare
                    Abschlussbedingung fehlt. Der Grund und der Prüfstand werden
                    protokolliert.
                  </span>
                </label>
              )}
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={pending || (needsReason && reason.trim().length < 3)}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}Änderung
              speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BlockerDialog({
  snapshot,
  kind,
  blocker,
  isManager,
  onClose,
  onChanged,
}: {
  snapshot: WorkLifecycleSnapshot;
  kind: "blocker" | "parking";
  blocker?: WorkBlocker;
  isManager: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [reason, setReason] = useState<WorkBlockerReason>(
    blocker?.reason ?? "other",
  );
  const [details, setDetails] = useState(blocker?.details ?? "");
  const [ownerId, setOwnerId] = useState(
    blocker?.responsible_employee_record_id ??
      (isManager ? "" : (snapshot.ownOwnerId ?? "")),
  );
  const [reviewDate, setReviewDate] = useState(
    isManager
      ? fromIsoDate(blocker?.next_review_date ?? undefined)
      : new Date(),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !ownerId ||
      !reviewDate ||
      (reason === "other" && details.trim().length < 3)
    ) {
      setError(
        reason === "other" && details.trim().length < 3
          ? "Beschreibe den Grund unter Details."
          : "Grund, verantwortliche Person und Wiedervorlage sind erforderlich.",
      );
      return;
    }
    startTransition(async () => {
      const input = {
        targetType: snapshot.targetType,
        targetId: snapshot.targetId,
        reason,
        details: details.trim() || undefined,
        responsibleEmployeeRecordId: ownerId,
        nextReviewDate: toIsoDate(reviewDate),
      };
      const result =
        kind === "parking"
          ? await parkWorkTarget({
              ...input,
              expectedExecutionVersion: snapshot.executionVersion,
            })
          : await saveWorkBlocker({
              ...input,
              blockerId: blocker?.id,
              expectedVersion: blocker?.version,
            });
      if (!result.success) {
        setError(
          ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.work_action_failed,
        );
        return;
      }
      await onChanged();
      onClose();
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>
              {kind === "parking"
                ? "Arbeit parken"
                : blocker
                  ? "Blocker bearbeiten"
                  : "Blocker erfassen"}
            </DialogTitle>
            <DialogDescription>
              Grund, Zuständigkeit und nächster Prüftermin bleiben sichtbar, bis
              der Eintrag begründet gelöst wird.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="work-blocker-reason">Grund</Label>
              <Select
                value={reason}
                onValueChange={(value) => setReason(value as WorkBlockerReason)}
              >
                <SelectTrigger id="work-blocker-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(WORK_BLOCKER_REASON_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="work-blocker-details">
                Nächster Schritt / Details
              </Label>
              <Textarea
                id="work-blocker-details"
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                maxLength={2000}
                placeholder="Was muss als Nächstes passieren?"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="work-blocker-owner">Verantwortlich</Label>
              <SearchableSelect
                id="work-blocker-owner"
                options={snapshot.ownerOptions}
                value={ownerId}
                onChange={setOwnerId}
                placeholder="Person auswählen"
                searchPlaceholder="Person suchen…"
                emptyMessage="Keine Person gefunden"
              />
            </div>
            {isManager ? (
              <div className="space-y-2">
                <Label htmlFor="work-blocker-review">Wiedervorlage</Label>
                <DatePicker
                  id="work-blocker-review"
                  ariaLabel="Wiedervorlagedatum"
                  value={reviewDate}
                  onChange={setReviewDate}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Die Wiedervorlage wird auf heute gesetzt.
              </p>
            )}
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({
  title,
  description,
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<{ success: boolean; error?: string }>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await onSubmit(reason.trim());
      if (!result.success) {
        setError(
          ERROR_MESSAGES[result.error ?? ""] ??
            ERROR_MESSAGES.work_action_failed,
        );
        return;
      }
      onClose();
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2 py-1">
            <Label htmlFor="work-reason">Begründung</Label>
            <Textarea
              id="work-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
              required
            />
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={pending || reason.trim().length < 3}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DependencyDialog({
  snapshot,
  onClose,
  onChanged,
}: {
  snapshot: WorkLifecycleSnapshot;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [type, setType] = useState<
    "job" | "project" | "instruction" | "declared"
  >("job");
  const [predecessor, setPredecessor] = useState("");
  const [effect, setEffect] = useState<WorkDependencyEffect>("blocks_start");
  const [description, setDescription] = useState("");
  const [remoteOptions, setRemoteOptions] = useState<WorkEntityOption[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (type === "declared" || search.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchWorkPredecessors({ type, query: search })
        .then((result) => {
          if (cancelled) return;
          if (result.success) setRemoteOptions(result.options);
          else setError(ERROR_MESSAGES.work_action_failed);
        })
        .catch(() => {
          if (!cancelled) setError(ERROR_MESSAGES.work_action_failed);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, type]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveWorkDependency({
        targetType: snapshot.targetType,
        targetId: snapshot.targetId,
        predecessor:
          type === "declared"
            ? { type, kind: predecessor as WorkDeclaredDependencyKind }
            : { type, id: predecessor },
        description: description.trim() || undefined,
        effect,
      });
      if (!result.success) {
        setError(
          ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.work_action_failed,
        );
        return;
      }
      await onChanged();
      onClose();
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Voraussetzung hinzufügen</DialogTitle>
            <DialogDescription>
              Verknüpfe bestehende Arbeit oder erfasse eine klar bezeichnete
              externe Voraussetzung.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="dependency-type">Art</Label>
              <Select
                value={type}
                onValueChange={(value) => {
                  setType(value as typeof type);
                  setPredecessor("");
                  setRemoteOptions(null);
                  setSearch("");
                }}
              >
                <SelectTrigger id="dependency-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="job">Auftrag</SelectItem>
                  <SelectItem value="project">Projekt</SelectItem>
                  <SelectItem value="instruction">
                    Aufgabe / Checklistenpunkt
                  </SelectItem>
                  <SelectItem value="declared">
                    Deklarierte Voraussetzung
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dependency-target">Voraussetzung</Label>
              <SearchableSelect
                id="dependency-target"
                options={remoteOptions ?? snapshot.predecessorOptions[type]}
                value={predecessor}
                onChange={setPredecessor}
                onSearchChange={(value) => {
                  setSearch(value);
                  if (value.trim().length < 2) setRemoteOptions(null);
                }}
                placeholder="Voraussetzung auswählen"
                searchPlaceholder="Voraussetzung suchen…"
                emptyMessage="Keine passende Voraussetzung"
              />
            </div>
            {type === "declared" && (
              <div className="space-y-2">
                <Label htmlFor="dependency-description">
                  Konkrete Bedingung
                </Label>
                <Textarea
                  id="dependency-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={1000}
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="dependency-effect">Auswirkung</Label>
              <Select
                value={effect}
                onValueChange={(value) =>
                  setEffect(value as WorkDependencyEffect)
                }
              >
                <SelectTrigger id="dependency-effect">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(WORK_DEPENDENCY_EFFECT_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                !predecessor ||
                (type === "declared" && description.trim().length < 3)
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}Hinzufügen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArtifactApprovalDependencyDialog({
  snapshot,
  dependency,
  onClose,
  onChanged,
}: {
  snapshot: WorkLifecycleSnapshot;
  dependency: WorkDependency;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [options, setOptions] = useState<WorkEntityOption[] | null>(null);
  const [actionId, setActionId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let active = true;
    void getApprovedArtifactActionsForTarget({ targetType: snapshot.targetType, targetId: snapshot.targetId })
      .then((result) => {
        if (!active) return;
        if (result.success) setOptions(result.options);
        else {
          setOptions([]);
          setError(ERROR_MESSAGES.work_action_failed);
        }
      }).catch(() => {
        if (!active) return;
        setOptions([]);
        setError(ERROR_MESSAGES.work_action_failed);
      });
    return () => { active = false; };
  }, [snapshot.targetId, snapshot.targetType]);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await linkWorkDependencyArtifactApproval({ dependencyId: dependency.id,
        expectedVersion: dependency.version, actionId, reason });
      if (!result.success) { setError(ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.work_action_failed); return; }
      await onChanged();
      onClose();
    });
  }
  return <Dialog open onOpenChange={(open) => !open && !pending && onClose()}><DialogContent><form onSubmit={submit} className="contents"><DialogHeader><DialogTitle>Freigabe verknüpfen</DialogTitle><DialogDescription>Nur eine aktuelle, intern freigegebene Version dieses Auftrags oder Projekts erfüllt die Voraussetzung.</DialogDescription></DialogHeader><DialogBody className="space-y-4 py-1"><div className="space-y-2"><Label htmlFor="dependency-artifact-approval">Freigegebener Arbeitsnachweis</Label>{options === null ? <p className="text-sm text-muted-foreground">Freigaben werden geladen…</p> : <SearchableSelect id="dependency-artifact-approval" options={options} value={actionId} onChange={setActionId} placeholder="Freigabe auswählen" searchPlaceholder="Arbeitsnachweis suchen…" emptyMessage="Keine aktuelle Freigabe vorhanden" />}</div><div className="space-y-2"><Label htmlFor="dependency-artifact-reason">Begründung</Label><Textarea id="dependency-artifact-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} /></div><ErrorText>{error}</ErrorText></DialogBody><DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={pending}>Abbrechen</Button><Button type="submit" disabled={pending || !actionId || reason.trim().length < 3}>{pending && <Loader2 className="size-4 animate-spin" />}Verknüpfen</Button></DialogFooter></form></DialogContent></Dialog>;
}

type DialogState =
  | { type: "transition"; state: WorkExecutionState }
  | { type: "blocker"; blocker?: WorkBlocker }
  | { type: "parking" }
  | { type: "resolve-blocker"; blocker: WorkBlocker }
  | { type: "reopen-blocker"; blocker: WorkBlocker }
  | { type: "unpark"; blocker: WorkBlocker }
  | { type: "dependency" }
  | { type: "artifact-approval-dependency"; dependency: WorkDependency }
  | {
      type: "dependency-state";
      dependency: WorkDependency;
      state: "open" | "satisfied" | "waived";
    }
  | { type: "remove-dependency"; dependency: WorkDependency }
  | { type: "clear-project-override" };

type WorkLifecycleCardProps = {
  initialSnapshot: WorkLifecycleSnapshot;
  targetLabel: string;
  isManager: boolean;
  fieldMode?: boolean;
  hasPendingDispatch?: boolean;
  readOnly?: boolean;
};

export function WorkLifecycleLoadError(): ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Card className="gap-3 p-4" role="alert">
      <div>
        <h2 className="text-sm font-semibold">Arbeitsstand nicht verfügbar</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Auftrag oder Projekt bleiben sichtbar. Der Arbeitsstand konnte gerade
          nicht geladen werden und wird nicht als erfüllt angenommen.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        Erneut laden
      </Button>
    </Card>
  );
}

export function WorkLifecycleCard({
  initialSnapshot,
  targetLabel,
  isManager,
  fieldMode = false,
  hasPendingDispatch = false,
  readOnly = false,
}: WorkLifecycleCardProps): ReactElement {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [remoteUpdate, setRemoteUpdate] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showBanner } = useBanner();
  const refresh = useCallback(async () => {
    const result = await getWorkLifecycleSnapshot({
      targetType: snapshot.targetType,
      targetId: snapshot.targetId,
    });
    if (result.success) {
      setSnapshot(result.snapshot);
      setRemoteUpdate(false);
    }
  }, [snapshot.targetId, snapshot.targetType]);
  const handleRealtime = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    if (dialog) {
      refreshTimerRef.current = null;
      setRemoteUpdate(true);
      return;
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, 200);
  }, [dialog, refresh]);
  useEffect(
    () => () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    [],
  );
  useRealtimeEvent(
    snapshot.targetType === "job" ? "jobs" : "projects",
    handleRealtime,
  );
  useRealtimeEvent("work_blockers", handleRealtime);
  useRealtimeEvent("work_dependencies", handleRealtime);
  useRealtimeEvent("job_instruction_items", handleRealtime);
  useRealtimeEvent("time_entries", handleRealtime);
  useRealtimeEvent("job_assignments", handleRealtime);
  useRealtimeEvent("planning_occurrence_assignments", handleRealtime);
  useRealtimeEvent("planning_occurrences", handleRealtime);
  useRealtimeEvent("job_capability_requirements", handleRealtime);
  useRealtimeEvent("employee_capabilities", handleRealtime);
  useRealtimeEvent("organization_capabilities", handleRealtime);
  useRealtimeEvent("job_material_lines", handleRealtime);
  useRealtimeEvent("inventory_stock_levels", handleRealtime);
  const transitions = getAllowedWorkTransitions(
    snapshot.executionState,
    isManager,
  );
  const parking = snapshot.blockers.find(
    (blocker) => blocker.kind === "parking",
  );
  const blockingCount = snapshot.blockers.filter(
    (blocker) => blocker.kind === "blocker",
  ).length;
  const unmetDependencies = snapshot.dependencies.filter(
    (dependency) => !dependency.is_satisfied && dependency.effect !== "warning",
  ).length;
  const canStart =
    !parking &&
    blockingCount === 0 &&
    snapshot.gates.openStartDependencies === 0;
  const startReadinessKnown = canStart && !snapshot.readinessLoadFailed;
  const nextAction = getWorkNextAction(snapshot);
  const ownerNames = useMemo(
    () =>
      new Map(snapshot.ownerOptions.map((owner) => [owner.value, owner.label])),
    [snapshot.ownerOptions],
  );
  const ownOwnerId = isManager ? null : snapshot.ownOwnerId;
  const primaryFieldTransition = snapshot.executionState === "not_started"
    || snapshot.executionState === "interrupted"
    ? "in_progress"
    : snapshot.executionState === "in_progress"
      ? "execution_complete"
      : null;
  const canCompleteExecution =
    snapshot.gates.incompleteRequiredInstructions === 0 &&
    snapshot.gates.reopenedInstructionPredecessors === 0 &&
    snapshot.gates.incompleteInstructionEvidence === 0 &&
    snapshot.gates.openBlockers === 0 &&
    snapshot.gates.openCompletionDependencies === 0 &&
    snapshot.gates.activeJobClocks === 0 &&
    snapshot.gates.incompleteProjectChildren === 0;
  const isFieldTransitionBlocked = (state: WorkExecutionState): boolean => fieldMode && (
    (state === "in_progress" && !canStart) ||
    (state === "execution_complete" && !canCompleteExecution)
  );
  const hasAvailablePrimaryFieldTransition = transitions.some(
    (state) => state === primaryFieldTransition && !isFieldTransitionBlocked(state),
  );

  const changed = async (
    message?: string,
    nextExecutionState?: WorkExecutionState,
  ) => {
    if (
      fieldMode &&
      nextExecutionState &&
      isFieldWorkPackReadOnly(nextExecutionState)
    ) {
      const url = new URL(window.location.href);
      url.searchParams.set("field_transition", "updated");
      window.location.assign(url.toString());
      return;
    }
    await refresh();
    if (fieldMode) router.refresh();
    if (message) showBanner({ variant: "success", message });
  };

  return (
    <Card id="arbeitsstand" className="gap-4 p-4" data-testid="work-lifecycle-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <StateIcon state={snapshot.executionState} />
            Arbeitsstand
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Nächster Schritt: {nextAction}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {WORK_EXECUTION_LABELS[snapshot.executionState]}
          </Badge>
          <Badge variant="outline">
            {snapshot.isPlanned ? "Geplant" : "Nicht geplant"}
          </Badge>
          <Badge variant={startReadinessKnown ? "secondary" : "outline"}>
            {snapshot.readinessLoadFailed
              ? "Startbereitschaft unbekannt"
              : canStart
                ? "Startbereit"
                : "Nicht startbereit"}
          </Badge>
          {parking && <Badge variant="secondary">Geparkt</Badge>}
          {blockingCount > 0 && (
            <Badge variant="destructive">{blockingCount} Blocker</Badge>
          )}
          {snapshot.isLegacy && snapshot.targetType === "job" && (
            <Badge variant="outline">Altbestand · noch ohne Verlauf</Badge>
          )}
          {snapshot.isLegacy && snapshot.targetType === "project" && (
            <Badge variant="outline">Automatisch abgeleitet</Badge>
          )}
        </div>
      </div>
      {remoteUpdate && (
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span>Während der Eingabe hat sich der Arbeitsstand geändert.</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void refresh()}
          >
            Aktualisieren
          </Button>
        </div>
      )}
      {!readOnly && <div className="flex flex-wrap gap-2">
        {transitions.map((state) => {
          const isBlockedFieldTransition = isFieldTransitionBlocked(state);
          const isPrimaryFieldAction = fieldMode
            && !hasPendingDispatch
            && !isBlockedFieldTransition
            && state === primaryFieldTransition;
          return (
          <Button
            key={state}
            data-testid={isPrimaryFieldAction ? "field-primary-next-action" : undefined}
            type="button"
            size="sm"
            variant={state === "cancelled"
              ? "destructive"
              : isPrimaryFieldAction
                ? "default"
                : "outline"}
            className={fieldMode ? "min-h-11" : undefined}
            disabled={isBlockedFieldTransition}
            aria-describedby={isBlockedFieldTransition ? "field-transition-blocked-reason" : undefined}
            title={isBlockedFieldTransition
              ? "Kläre zuerst die angezeigten offenen Punkte."
              : undefined}
            onClick={() => setDialog({ type: "transition", state })}
          >
            {WORK_EXECUTION_LABELS[state]}
          </Button>
          );
        })}
        {fieldMode && !hasPendingDispatch && !readOnly && transitions.length > 0
          && !hasAvailablePrimaryFieldTransition && (
            <Button asChild size="sm" className="min-h-11" data-testid="field-primary-next-action">
              <a href="#offene-punkte">Offene Punkte prüfen</a>
            </Button>
          )}
        {isManager &&
          snapshot.targetType === "project" &&
          !snapshot.isLegacy && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDialog({ type: "clear-project-override" })}
            >
              Automatisch ableiten
            </Button>
          )}
        {isManager &&
          !parking &&
          !isTerminalWorkExecutionState(snapshot.executionState) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDialog({ type: "parking" })}
            >
              <ParkingCircle className="size-4" />
              Parken
            </Button>
          )}
      </div>}
      {!readOnly && fieldMode && transitions.some(isFieldTransitionBlocked) && (
        <p id="field-transition-blocked-reason" className="text-sm text-muted-foreground">
          Kläre zuerst die angezeigten offenen Punkte.
        </p>
      )}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Einsatzbereitschaft</h3>
        {snapshot.readinessLoadFailed ? (
          <ErrorText>
            Die Einsatzbereitschaft konnte nicht geladen werden. Es wird nichts
            als erfüllt angenommen.
          </ErrorText>
        ) : snapshot.readiness ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {snapshot.readiness.dimensions.map((dimension) => (
              <div
                key={dimension.key}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{dimension.label}</span>
                  <Badge variant="outline">
                    {dimension.state === "ok"
                      ? "Erfüllt"
                      : dimension.state === "warning"
                        ? "Prüfen"
                        : "Nicht bewertet"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dimension.details[0]}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Projektweite Einsatzbereitschaft wird aus den einzelnen Aufträgen
            beurteilt.
          </p>
        )}
      </section>
      <div id="offene-punkte" className="grid scroll-mt-28 gap-4 lg:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Blocker & Parkplatz</h3>
            {!readOnly && (isManager || snapshot.targetType === "job") && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDialog({ type: "blocker" })}
              >
                <Plus className="size-4" />
                Blocker
              </Button>
            )}
          </div>
          {snapshot.blockers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine offenen Blocker.
            </p>
          ) : (
            snapshot.blockers.map((blocker) => (
              <div key={blocker.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {blocker.kind === "parking"
                        ? "Geparkt"
                        : blocker.reason
                          ? WORK_BLOCKER_REASON_LABELS[blocker.reason]
                          : "Kontext fehlt (Altbestand)"}
                    </p>
                    <p className="text-muted-foreground">
                      {blocker.details || "Kein nächster Schritt beschrieben."}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Verantwortlich:{" "}
                      {blocker.responsible_employee_record_id
                        ? (ownerNames.get(
                            blocker.responsible_employee_record_id,
                          ) ?? "Unbekannt")
                        : "nicht hinterlegt"}{" "}
                      · Wiedervorlage: {formatDate(blocker.next_review_date)}
                    </p>
                  </div>
                  {!readOnly && (isManager ||
                    (blocker.kind === "blocker" &&
                      ownOwnerId !== null &&
                      blocker.responsible_employee_record_id ===
                        ownOwnerId)) && (
                    <div className="flex gap-1">
                      {blocker.kind === "parking" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setDialog({ type: "unpark", blocker })}
                        >
                          Weiterplanen
                        </Button>
                      ) : (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setDialog({ type: "blocker", blocker })
                            }
                          >
                            Bearbeiten
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setDialog({ type: "resolve-blocker", blocker })
                            }
                          >
                            Lösen
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </section>
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Voraussetzungen</h3>
            {isManager && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDialog({ type: "dependency" })}
              >
                <Plus className="size-4" />
                Voraussetzung
              </Button>
            )}
          </div>
          {snapshot.dependencies.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine zusätzlichen Voraussetzungen.
            </p>
          ) : (
            snapshot.dependencies.map((dependency) => (
              <div
                key={dependency.id}
                data-testid="work-dependency-row"
                className="rounded-md border p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {dependency.description || "Verknüpfte Arbeit"}
                    </p>
                    <p className="text-muted-foreground">
                      {WORK_DEPENDENCY_EFFECT_LABELS[dependency.effect]} ·{" "}
                      {dependency.is_satisfied ? "erfüllt" : "offen"}
                    </p>
                  </div>
                  {isManager && (
                    <div className="flex gap-1">
                      {dependency.declared_kind === "approval" && !dependency.artifact_approval_action_id && !dependency.is_satisfied ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ type: "artifact-approval-dependency", dependency })}>
                          Freigabe verknüpfen
                        </Button>
                      ) : dependency.declared_kind && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setDialog({
                              type: "dependency-state",
                              dependency,
                              state: dependency.is_satisfied
                                ? "open"
                                : "satisfied",
                            })
                          }
                        >
                          {dependency.is_satisfied
                            ? "Wieder öffnen"
                            : "Erfüllt"}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Voraussetzung entfernen"
                        onClick={() =>
                          setDialog({ type: "remove-dependency", dependency })
                        }
                      >
                        <Unlink className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </section>
      </div>
      {isManager && snapshot.resolvedBlockers.length > 0 && (
        <FormDisclosure label="Gelöste Blocker">
          <div className="space-y-2 pt-3">
            {snapshot.resolvedBlockers.map((blocker) => (
              <div
                key={blocker.id}
                className="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {blocker.reason
                      ? WORK_BLOCKER_REASON_LABELS[blocker.reason]
                      : "Gelöster Altbestand"}
                  </p>
                  <p className="text-muted-foreground">
                    {blocker.resolution_note || "Ohne Lösungsnotiz"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog({ type: "reopen-blocker", blocker })}
                >
                  Wieder öffnen
                </Button>
              </div>
            ))}
          </div>
        </FormDisclosure>
      )}
      <FormDisclosure label="Abschlussprüfungen und Verlauf">
        <div className="grid gap-4 pt-3 md:grid-cols-2">
          <div className="space-y-1 text-sm">
            <p>
              {snapshot.gates.incompleteRequiredInstructions} erforderliche
              Aufgaben offen
            </p>
            <p>
              {snapshot.gates.openCompletionDependencies}{" "}
              Abschlussvoraussetzungen offen
            </p>
            <p>{snapshot.gates.activeJobClocks} laufende Zeiterfassungen</p>
            <p>
              {snapshot.gates.incompleteProjectChildren} nicht abgeschlossene
              Aufträge
            </p>
            <p>
              {snapshot.gates.incompleteInstructionEvidence} erforderliche
              Nachweise offen
            </p>
            <p>{snapshot.gates.measurementArtifacts} Aufmaße erfasst</p>
            <p>{snapshot.gates.openDefects} offene Mängel</p>
            <p>
              {snapshot.gates.pendingFormalApprovals} formale Freigaben offen
            </p>
            <p>
              {snapshot.gates.requiredCustomerDecisions} erforderliche
              Kundenentscheidungen offen
            </p>
            <p>
              {snapshot.gates.requiredSignatures} erforderliche Unterschriften
              offen
            </p>
            <p className="text-muted-foreground">
              {snapshot.gates.notAssessable.length > 0
                ? `${snapshot.gates.notAssessable.length} weitere Prüfpunkte sind noch nicht bewertbar.`
                : "Alle bekannten Prüfpunkte sind bewertbar."}
            </p>
          </div>
          <div className="space-y-2">
            {snapshot.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Noch keine P1-14-Änderung protokolliert.
              </p>
            ) : (
              snapshot.history.map((event) => (
                <div key={event.id} className="border-l-2 pl-3 text-sm">
                  <p>
                    {event.to_state
                      ? WORK_EXECUTION_LABELS[event.to_state]
                      : "Automatische Ableitung"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("de-DE", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(event.created_at))}
                    {event.reason ? ` · ${event.reason}` : ""}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </FormDisclosure>
      {unmetDependencies > 0 && (
        <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
          <LockKeyhole className="size-4" />
          {unmetDependencies} offene Voraussetzung(en) beeinflussen die nächste
          Änderung.
        </p>
      )}
      {dialog?.type === "transition" && (
        <TransitionDialog
          snapshot={snapshot}
          targetLabel={targetLabel}
          transition={dialog.state}
          isManager={isManager}
          onClose={() => setDialog(null)}
          onChanged={() =>
            changed("Arbeitsstand wurde aktualisiert.", dialog.state)
          }
        />
      )}
      {dialog?.type === "blocker" && (
        <BlockerDialog
          snapshot={snapshot}
          kind="blocker"
          blocker={dialog.blocker}
          isManager={isManager}
          onClose={() => setDialog(null)}
          onChanged={() => changed("Blocker wurde gespeichert.")}
        />
      )}
      {dialog?.type === "parking" && (
        <BlockerDialog
          snapshot={snapshot}
          kind="parking"
          isManager={isManager}
          onClose={() => setDialog(null)}
          onChanged={() => changed("Arbeit wurde geparkt.")}
        />
      )}
      {dialog?.type === "dependency" && (
        <DependencyDialog
          snapshot={snapshot}
          onClose={() => setDialog(null)}
          onChanged={() => changed("Voraussetzung wurde hinzugefügt.")}
        />
      )}
      {dialog?.type === "artifact-approval-dependency" && (
        <ArtifactApprovalDependencyDialog snapshot={snapshot} dependency={dialog.dependency}
          onClose={() => setDialog(null)} onChanged={() => changed("Freigabe wurde mit der Voraussetzung verknüpft.")} />
      )}
      {dialog?.type === "resolve-blocker" && (
        <ReasonDialog
          title="Blocker lösen"
          description="Die Lösung bleibt mit Version und Begründung im Verlauf erhalten."
          submitLabel="Lösen"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            const result = await setWorkBlockerResolved({
              blockerId: dialog.blocker.id,
              expectedVersion: dialog.blocker.version,
              resolutionNote: reason,
            });
            if (result.success) await changed("Blocker wurde gelöst.");
            return result;
          }}
        />
      )}
      {dialog?.type === "unpark" && (
        <ReasonDialog
          title="Parkplatz verlassen"
          description="Das Planen eines neuen Termins bleibt ein eigener Schritt."
          submitLabel="Weiterführen"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            const result = await unparkWorkTarget({
              targetType: snapshot.targetType,
              targetId: snapshot.targetId,
              blockerVersion: dialog.blocker.version,
              reason,
            });
            if (result.success) await changed("Arbeit ist nicht mehr geparkt.");
            return result;
          }}
        />
      )}
      {dialog?.type === "reopen-blocker" && (
        <ReasonDialog
          title="Blocker wieder öffnen"
          description="Der Blocker wird erneut aktiv; der bisherige Verlauf bleibt erhalten."
          submitLabel="Wieder öffnen"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            const result = await reopenWorkBlocker({
              blockerId: dialog.blocker.id,
              expectedVersion: dialog.blocker.version,
              reason,
            });
            if (result.success) await changed("Blocker wurde wieder geöffnet.");
            return result;
          }}
        />
      )}
      {dialog?.type === "dependency-state" && (
        <ReasonDialog
          title={
            dialog.state === "open"
              ? "Voraussetzung wieder öffnen"
              : "Voraussetzung als erfüllt markieren"
          }
          description="Die Änderung gilt nur für diese deklarierte Voraussetzung und wird protokolliert."
          submitLabel="Speichern"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            const result = await setDeclaredWorkDependencyState({
              dependencyId: dialog.dependency.id,
              expectedVersion: dialog.dependency.version,
              state: dialog.state,
              reason,
            });
            if (result.success) {
              setSnapshot((current) => ({
                ...current,
                dependencies: current.dependencies.map((dependency) =>
                  dependency.id === dialog.dependency.id
                    ? {
                        ...dependency,
                        manual_state: dialog.state,
                        version: result.dependency.version,
                        is_satisfied: dialog.state !== "open",
                      }
                    : dependency,
                ),
              }));
              await changed("Voraussetzung wurde aktualisiert.");
            }
            return result;
          }}
        />
      )}
      {dialog?.type === "remove-dependency" && (
        <ReasonDialog
          title="Voraussetzung entfernen"
          description="Die Verknüpfung wird beendet; ihr Verlauf bleibt erhalten."
          submitLabel="Entfernen"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            const result = await removeWorkDependency({
              dependencyId: dialog.dependency.id,
              expectedVersion: dialog.dependency.version,
              reason,
            });
            if (result.success) {
              setSnapshot((current) => ({
                ...current,
                dependencies: current.dependencies.filter(
                  (dependency) => dependency.id !== dialog.dependency.id,
                ),
              }));
              await changed("Voraussetzung wurde entfernt.");
            }
            return result;
          }}
        />
      )}
      {dialog?.type === "clear-project-override" && (
        <ReasonDialog
          title="Projektstand automatisch ableiten"
          description="Der Projektstand folgt danach wieder den zugehörigen Aufträgen. Die Änderung bleibt im Verlauf erhalten."
          submitLabel="Automatisch ableiten"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            const result = await clearProjectWorkExecutionOverride({
              projectId: snapshot.targetId,
              expectedVersion: snapshot.executionVersion,
              reason,
            });
            if (result.success)
              await changed(
                "Der Projektstand wird wieder automatisch abgeleitet.",
              );
            return result;
          }}
        />
      )}
    </Card>
  );
}
