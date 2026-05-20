'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { TimeInput } from '@/components/ui/time-input';
import { DurationHoursInput } from '@/components/ui/duration-hours-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { EmployeeMultiSelect, type OrgMemberOption } from './employee-multi-select';

import { ClientSelectWithCreate } from './client-select-with-create';
import { ParkConfirmationDialog } from './park-confirmation-dialog';
import {
  updateJob,
  assignEmployee,
  unassignEmployee,
  getJobDetails,
  type UpdateJobInput
} from '@/lib/jobs/actions';
import {
  getJobDisplayTitle,
  JOB_PRIORITY_LABELS,
  type Client,
  type Job,
  type JobPriority,
  type ProjectWithDetails
} from '@/lib/jobs/types';
import {
  calculatePlannedWorkingMinutes,
  formatMinutesAsHoursInput,
  parseHoursInputToMinutes,
} from '@/lib/jobs/planned-working';
import { toLocalDateString } from '@/lib/utils';

const PRIORITY_OPTIONS: { value: JobPriority; label: string }[] = [
  { value: 'niedrig', label: JOB_PRIORITY_LABELS.niedrig },
  { value: 'mittel', label: JOB_PRIORITY_LABELS.mittel },
  { value: 'hoch', label: JOB_PRIORITY_LABELS.hoch }
];

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  no_active_org: 'Keine Organisation ausgewählt.',
  not_authorized: 'Du bist nicht berechtigt, Aufträge zu verwalten.',
  title_or_description_required:
    'Bitte gib mindestens einen Titel oder eine Beschreibung ein.',
  job_not_found: 'Auftrag nicht gefunden.',
  client_not_found: 'Kunde nicht gefunden.',
  no_changes: 'Keine Änderungen vorgenommen.',
  update_failed: 'Fehler beim Aktualisieren des Auftrags.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.'
};

interface EditJobDialogProps {
  job: Job;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  members: OrgMemberOption[];
  projects?: ProjectWithDetails[];
  onSuccess?: (payload: {
    job: Job;
    selectedEmployeeIds?: string[];
  }) => void | Promise<void>;
}

export function EditJobDialog({
  job,
  open,
  onOpenChange,
  clients,
  members,
  projects = [],
  onSuccess,
}: EditJobDialogProps) {
  const [jobNumber, setJobNumber] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [priority, setPriority] = useState<JobPriority>('mittel');
  const [plannedDate, setPlannedDate] = useState<Date | undefined>();
  const [plannedTime, setPlannedTime] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [plannedWorkingHours, setPlannedWorkingHours] = useState('');
  const [plannedWorkingTouched, setPlannedWorkingTouched] = useState(false);
  const [autoSyncPlannedWorking, setAutoSyncPlannedWorking] = useState(false);
  const [location, setLocation] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [originalAssignees, setOriginalAssignees] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showAutoParkDialog, setShowAutoParkDialog] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;

    setJobNumber(job.jobNumber ?? '');
    setTitle(job.title);
    setDescription(job.description ?? '');
    setProjectId(job.projectId ?? '');
    setPriority(job.priority);
    setPlannedDate(job.plannedDate ? new Date(job.plannedDate + 'T00:00:00') : undefined);
    setPlannedTime(job.plannedTime ?? '');
    setEstimatedHours(formatMinutesAsHoursInput(job.estimatedDurationMinutes));
    setPlannedWorkingHours(formatMinutesAsHoursInput(job.plannedWorkingMinutes));
    setPlannedWorkingTouched(false);
    setAutoSyncPlannedWorking(false);
    setLocation(job.location ?? '');
    setError(null);
    setContentError(null);
    setSuccess(false);
    setHasAttemptedSubmit(false);

    if (job.projectId) {
      const linkedProject = projects.find((p) => p.id === job.projectId);
      if (linkedProject?.clientId) {
        setClientId(linkedProject.clientId);
      } else {
        setClientId(job.clientId ?? '');
      }
    } else {
      setClientId(job.clientId ?? '');
    }

    setIsLoadingAssignments(true);
    getJobDetails(job.id).then((result) => {
      if (result.success) {
        const ids = result.job.assignments.map((a) => a.userId);
        setSelectedEmployees(ids);
        setOriginalAssignees(ids);
      }
      setIsLoadingAssignments(false);
    });
  }, [open, job, projects]);

  const submitChanges = async (confirmedDateRemoval = false) => {
    setHasAttemptedSubmit(true);
    setError(null);
    setContentError(null);

    if (!title.trim() && !description.trim()) {
      setContentError(
        'Bitte gib mindestens einen Titel oder eine Beschreibung ein.'
      );
      return;
    }

    const isRemovingPlannedDate = !!job.plannedDate && !plannedDate;
    if (isRemovingPlannedDate && !confirmedDateRemoval) {
      setShowAutoParkDialog(true);
      return;
    }

    setIsLoading(true);
    setSuccess(false);

    try {
      const parsedEstimatedDuration = parseHoursInputToMinutes(estimatedHours);
      const estimatedDurationMinutes = estimatedHours.trim()
        ? parsedEstimatedDuration
        : job.estimatedDurationMinutes !== null
          ? null
          : undefined;

      let plannedWorkingMinutes: number | null | undefined;
      if (plannedWorkingTouched) {
        plannedWorkingMinutes = plannedWorkingHours.trim()
          ? parseHoursInputToMinutes(plannedWorkingHours)
          : job.plannedWorkingMinutes !== null
            ? null
            : undefined;
      } else if (autoSyncPlannedWorking) {
        plannedWorkingMinutes = plannedWorkingHours.trim()
          ? parseHoursInputToMinutes(plannedWorkingHours)
          : job.plannedWorkingMinutes !== null
            ? null
            : undefined;
      }

      const input: UpdateJobInput = {
        title: title.trim(),
        description: description.trim() || (job.description !== null ? '' : undefined),
        clientId: clientId && clientId !== 'none' ? clientId : '',
        projectId: projectId && projectId !== 'none' ? projectId : '',
        jobNumber: jobNumber.trim() || undefined,
        priority,
        plannedDate: plannedDate
          ? toLocalDateString(plannedDate)
          : job.plannedDate !== null
            ? null
            : undefined,
        plannedTime: plannedTime || (job.plannedTime !== null ? null : undefined),
        estimatedDurationMinutes,
        plannedWorkingMinutes,
        location: location.trim() || (job.location !== null ? '' : undefined)
      };

      const result = await updateJob(job.id, input);

      if (!result.success && result.error !== 'no_changes') {
        if (result.error === 'title_or_description_required') {
          setContentError(ERROR_MESSAGES[result.error]);
        } else {
          setError(
            ERROR_MESSAGES[result.error] || result.error || 'Unbekannter Fehler'
          );
        }
        return;
      }

      const toAssign = selectedEmployees.filter(
        (id) => !originalAssignees.includes(id)
      );
      const toUnassign = originalAssignees.filter(
        (id) => !selectedEmployees.includes(id)
      );

      if (toAssign.length > 0 || toUnassign.length > 0) {
        await Promise.allSettled([
          ...toAssign.map((userId) => assignEmployee(job.id, userId)),
          ...toUnassign.map((userId) => unassignEmployee(job.id, userId))
        ]);
      }

      setSuccess(true);
      onOpenChange(false);
      if (onSuccess) {
        await onSuccess({
          job: result.success ? result.job : job,
          selectedEmployeeIds: selectedEmployees,
        });
      } else {
        router.refresh();
      }
      setSuccess(false);
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitChanges();
  };

  const showContentError = hasAttemptedSubmit && contentError;
  const formDisabled = isLoading || success;

  const activeProjects = useMemo(
    () =>
      projects.filter((p) => {
        const status = p.statusOverride ?? (p.completedJobCount === p.jobCount && p.jobCount > 0 ? 'abgeschlossen' : 'nicht_begonnen');
        return status !== 'abgeschlossen';
      }),
    [projects]
  );

  const filteredProjects = useMemo(
    () => {
      if (!clientId) return activeProjects;
      return activeProjects.filter((p) => p.clientId === clientId || !p.clientId);
    },
    [activeProjects, clientId]
  );

  const projectOptions = useMemo(
    () =>
      filteredProjects.map((p) => ({
        value: p.id,
        label: p.projectNumber ? `${p.projectNumber} – ${p.name}` : p.name
      })),
    [filteredProjects]
  );

  const isClientLocked = useMemo(() => {
    if (!projectId) return false;
    const selected = activeProjects.find((p) => p.id === projectId);
    return !!selected;
  }, [projectId, activeProjects]);

  const lockedClientLabel = useMemo(() => {
    if (!projectId) return undefined;
    const selected = activeProjects.find((p) => p.id === projectId);
    if (!selected) return undefined;
    if (!selected.clientId) return 'Kein Kunde';
    const c = clients.find((cl) => cl.id === selected.clientId);
    return c?.name ?? 'Kein Kunde';
  }, [projectId, activeProjects, clients]);

  const handleClientChange = (newClientId: string) => {
    setClientId(newClientId);
    if (projectId) {
      const selectedProject = activeProjects.find((p) => p.id === projectId);
      if (selectedProject && newClientId && selectedProject.clientId !== newClientId && selectedProject.clientId !== null) {
        setProjectId('');
      }
    }
  };

  const handleProjectChange = (newProjectId: string) => {
    setProjectId(newProjectId);
    if (newProjectId) {
      const selected = activeProjects.find((p) => p.id === newProjectId);
      if (selected) {
        if (selected.clientId) {
          setClientId(selected.clientId);
        } else {
          setClientId('');
        }
      }
    }
  };

  const noProjectsForClient = clientId && filteredProjects.length === 0;

  const handleEstimatedHoursChange = (nextValue: string) => {
    setEstimatedHours(nextValue);
    setAutoSyncPlannedWorking(true);

    if (!plannedWorkingTouched) {
      const nextSuggestedMinutes = calculatePlannedWorkingMinutes(
        parseHoursInputToMinutes(nextValue),
        selectedEmployees.length
      );
      setPlannedWorkingHours(formatMinutesAsHoursInput(nextSuggestedMinutes));
    }
  };

  const handleSelectedEmployeesChange = (nextSelectedEmployees: string[]) => {
    setSelectedEmployees(nextSelectedEmployees);
    setAutoSyncPlannedWorking(true);

    if (!plannedWorkingTouched) {
      const nextSuggestedMinutes = calculatePlannedWorkingMinutes(
        parseHoursInputToMinutes(estimatedHours),
        nextSelectedEmployees.length
      );
      setPlannedWorkingHours(formatMinutesAsHoursInput(nextSuggestedMinutes));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Auftrag bearbeiten</DialogTitle>
          <DialogDescription>Ändere die Daten des Auftrags.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-job-number">Auftragsnummer</Label>
              <Input
                id="edit-job-number"
                placeholder="z.B. AUF-2026-001"
                value={jobNumber}
                onChange={(e) => setJobNumber(e.target.value)}
                disabled={formDisabled}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-job-title">Titel</Label>
              <Input
                id="edit-job-title"
                placeholder="z.B. Heizung reparieren"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (contentError && e.target.value.trim()) setContentError(null);
                }}
                disabled={formDisabled}
                aria-invalid={showContentError ? true : undefined}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-job-description">Beschreibung</Label>
              <Textarea
                id="edit-job-description"
                placeholder="Optionale Beschreibung..."
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (contentError && e.target.value.trim()) setContentError(null);
                }}
                disabled={formDisabled}
                aria-invalid={showContentError ? true : undefined}
              />
              {showContentError && (
                <p className="text-sm text-destructive">{contentError}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-job-client">Kunde</Label>
              <ClientSelectWithCreate
                clients={clients}
                value={clientId}
                onValueChange={handleClientChange}
                disabled={formDisabled}
                id="edit-job-client"
                readOnly={isClientLocked}
                readOnlyLabel={lockedClientLabel}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-job-project">Projekt</Label>
              <SearchableSelect
                options={projectOptions}
                value={projectId}
                onChange={handleProjectChange}
                placeholder="Kein Projekt"
                searchPlaceholder="Projekt suchen..."
                emptyMessage={noProjectsForClient ? 'Kein Projekt für diesen Kunden vorhanden' : 'Kein Projekt gefunden'}
                disabled={formDisabled}
                allowNone
                noneLabel="Kein Projekt"
              />
              {noProjectsForClient && (
                <p className="text-xs text-muted-foreground">
                  Dem ausgewählten Kunden sind keine aktiven Projekte zugeordnet.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-job-priority">Priorität</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as JobPriority)}
                disabled={formDisabled}
              >
                <SelectTrigger id="edit-job-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Geplantes Datum</Label>
              <DatePicker
                value={plannedDate}
                onChange={setPlannedDate}
                disabled={formDisabled}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-job-time">Geplante Uhrzeit</Label>
              <TimeInput
                id="edit-job-time"
                value={plannedTime}
                onChange={setPlannedTime}
                disabled={formDisabled}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-job-duration">
                Geschätzte Dauer (Stunden)
              </Label>
              <DurationHoursInput
                id="edit-job-duration"
                placeholder="z.B. 2.5"
                value={estimatedHours}
                onChange={handleEstimatedHoursChange}
                disabled={formDisabled}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-job-location">Ort</Label>
              <Input
                id="edit-job-location"
                placeholder="Adresse oder Ort"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                disabled={formDisabled}
              />
            </div>

            <div className="grid gap-2">
              <Label>Mitarbeiter</Label>
              <EmployeeMultiSelect
                members={members}
                selectedIds={selectedEmployees}
                onSelectionChange={handleSelectedEmployeesChange}
                disabled={formDisabled || isLoadingAssignments}
              />
              {isLoadingAssignments && (
                <p className="text-xs text-muted-foreground">
                  Zuweisungen werden geladen...
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-job-planned-working">
                Geplanter Arbeitsaufwand (Stunden)
              </Label>
              <DurationHoursInput
                id="edit-job-planned-working"
                placeholder="z.B. 5"
                value={plannedWorkingHours}
                onChange={(value) => {
                  setPlannedWorkingTouched(true);
                  setPlannedWorkingHours(value);
                }}
                disabled={formDisabled || isLoadingAssignments}
              />
              <p className="text-xs text-muted-foreground">
                {plannedWorkingTouched
                  ? 'Manuell angepasst. Bis zum Schließen dieses Dialogs überschreiben weitere Änderungen an Dauer oder Mitarbeitern diesen Wert nicht.'
                  : !autoSyncPlannedWorking
                    ? 'Bleibt zunächst beim aktuellen Wert. Änderungen an Dauer oder Mitarbeitern berechnen ihn neu.'
                    : 'Wird automatisch aus geschätzter Dauer × Mitarbeiter berechnet.'}
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && (
              <p className="text-sm text-green-600">
                Auftrag erfolgreich aktualisiert!
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={formDisabled}
            >
              {isLoading && <Loader2 className="size-4 animate-spin" />}
              {isLoading ? 'Wird gespeichert...' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>

        <ParkConfirmationDialog
          open={showAutoParkDialog}
          onOpenChange={setShowAutoParkDialog}
          variant="job"
        title={
          title.trim() || description.trim()
            ? getJobDisplayTitle({ title, description })
            : getJobDisplayTitle(job)
        }
          identifier={jobNumber.trim() || job.jobNumber || undefined}
          mode="auto-park-date-removal"
          onConfirm={() => submitChanges(true)}
        />
      </DialogContent>
    </Dialog>
  );
}
