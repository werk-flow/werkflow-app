'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import { createJob, getNextJobNumber, type CreateJobInput } from '@/lib/jobs/actions';
import { assignEmployee } from '@/lib/jobs/actions';
import {
  JOB_PRIORITY_LABELS,
  type Client,
  type Job,
  type JobPriority,
  type ProjectWithDetails,
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
  job_number_required: 'Bitte gib eine Auftragsnummer ein.',
  job_number_taken: 'Diese Auftragsnummer ist bereits vergeben.',
  client_not_found: 'Kunde nicht gefunden.',
  project_not_found: 'Projekt nicht gefunden.',
  create_failed: 'Fehler beim Erstellen des Auftrags.',
  assign_failed: 'Fehler beim Zuweisen des Mitarbeiters.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.'
};

export interface CreateJobFormContentProps {
  clients: Client[];
  members: OrgMemberOption[];
  projects?: ProjectWithDetails[];
  initialJobNumber?: string | null;
  defaultProjectId?: string;
  defaultClientId?: string;
  defaultEmployeeIds?: string[];
  readOnlyClient?: boolean;
  readOnlyProject?: boolean;
  defaultDate?: Date;
  defaultTime?: string;
  defaultDurationHours?: string;
  onSuccess?: (payload: {
    job: Job;
    assignedUserIds: string[];
  }) => void | Promise<void>;
  /** Whether the form is active/visible. Controls data-fetching effects. Defaults to true. */
  isActive?: boolean;
}

export function CreateJobFormContent({
  clients,
  members,
  projects = [],
  initialJobNumber,
  defaultProjectId,
  defaultClientId,
  defaultEmployeeIds,
  readOnlyClient,
  readOnlyProject,
  defaultDate,
  defaultTime,
  defaultDurationHours,
  onSuccess,
  isActive = true,
}: CreateJobFormContentProps) {
  const previousInitialJobNumberRef = useRef(initialJobNumber ?? '');
  const [jobNumber, setJobNumber] = useState(initialJobNumber ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState<string>(defaultClientId ?? '');
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? '');
  const [priority, setPriority] = useState<JobPriority>('mittel');
  const [plannedDate, setPlannedDate] = useState<Date | undefined>(defaultDate);
  const [plannedTime, setPlannedTime] = useState(defaultTime ?? '');
  const [estimatedHours, setEstimatedHours] = useState(defaultDurationHours ?? '');
  const [location, setLocation] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>(defaultEmployeeIds ?? []);
  const [plannedWorkingHours, setPlannedWorkingHours] = useState('');
  const [plannedWorkingTouched, setPlannedWorkingTouched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [jobNumberError, setJobNumberError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const previousInitialJobNumber = previousInitialJobNumberRef.current;
    const nextInitialJobNumber = initialJobNumber ?? '';

    if (nextInitialJobNumber) {
      setJobNumber((currentJobNumber) =>
        !currentJobNumber || currentJobNumber === previousInitialJobNumber
          ? nextInitialJobNumber
          : currentJobNumber
      );
    }

    previousInitialJobNumberRef.current =
      nextInitialJobNumber || previousInitialJobNumber;
  }, [initialJobNumber]);

  useEffect(() => {
    if (!isActive || initialJobNumber || jobNumber) return;
    let isCurrent = true;

    getNextJobNumber().then((result) => {
      if (!isCurrent || !result.success) return;

      setJobNumber((currentJobNumber) =>
        currentJobNumber || result.jobNumber
      );
    });

    return () => {
      isCurrent = false;
    };
  }, [initialJobNumber, isActive, jobNumber]);

  const suggestedPlannedWorkingMinutes = useMemo(
    () =>
      calculatePlannedWorkingMinutes(
        parseHoursInputToMinutes(estimatedHours),
        selectedEmployees.length
      ),
    [estimatedHours, selectedEmployees.length]
  );

  useEffect(() => {
    if (plannedWorkingTouched) return;

    setPlannedWorkingHours(
      formatMinutesAsHoursInput(suggestedPlannedWorkingMinutes)
    );
  }, [plannedWorkingTouched, suggestedPlannedWorkingMinutes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    setContentError(null);
    setJobNumberError(null);

    let hasValidationError = false;
    if (!jobNumber.trim()) {
      setJobNumberError('Bitte gib eine Auftragsnummer ein.');
      hasValidationError = true;
    }
    if (!title.trim() && !description.trim()) {
      setContentError(
        'Bitte gib mindestens einen Titel oder eine Beschreibung ein.'
      );
      hasValidationError = true;
    }
    if (hasValidationError) return;

    setIsLoading(true);
    setSuccess(false);

    try {
      const durationMinutes = parseHoursInputToMinutes(estimatedHours);
      const plannedWorkingMinutes = plannedWorkingTouched
        ? parseHoursInputToMinutes(plannedWorkingHours)
        : suggestedPlannedWorkingMinutes;

      const input: CreateJobInput = {
        title: title.trim(),
        description: description.trim() || undefined,
        clientId: clientId || undefined,
        projectId: projectId || undefined,
        jobNumber: jobNumber.trim() || undefined,
        priority,
        plannedDate: plannedDate
          ? toLocalDateString(plannedDate)
          : undefined,
        plannedTime: plannedTime || undefined,
        estimatedDurationMinutes: durationMinutes ?? undefined,
        plannedWorkingMinutes,
        location: location.trim() || undefined
      };

      const result = await createJob(input);

      if (!result.success) {
        if (
          result.error === 'job_number_required' ||
          result.error === 'job_number_taken'
        ) {
          setJobNumberError(ERROR_MESSAGES[result.error]);
        } else if (result.error === 'title_or_description_required') {
          setContentError(ERROR_MESSAGES[result.error]);
        } else {
          setError(
            ERROR_MESSAGES[result.error] || result.error || 'Unbekannter Fehler'
          );
        }
        return;
      }

      if (selectedEmployees.length > 0) {
        const assignResults = await Promise.allSettled(
          selectedEmployees.map((userId) =>
            assignEmployee(result.job.id, userId)
          )
        );
        const failed = assignResults.filter(
          (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)
        );
        if (failed.length > 0) {
          console.error('Some employee assignments failed:', failed);
        }
      }

      setSuccess(true);
      await onSuccess?.({
        job: result.job,
        assignedUserIds: selectedEmployees,
      });
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  const showContentError = hasAttemptedSubmit && contentError;
  const showJobNumberError = hasAttemptedSubmit && jobNumberError;
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
    if (readOnlyClient) return true;
    if (!projectId) return false;
    const selected = activeProjects.find((p) => p.id === projectId);
    return !!selected;
  }, [readOnlyClient, projectId, activeProjects]);

  const lockedClientLabel = useMemo(() => {
    if (readOnlyClient && !projectId) {
      if (!clientId) return 'Kein Kunde';
      const c = clients.find((cl) => cl.id === clientId);
      return c?.name;
    }
    if (!projectId) return undefined;
    const selected = activeProjects.find((p) => p.id === projectId);
    if (!selected) return undefined;
    if (!selected.clientId) return 'Kein Kunde';
    const c = clients.find((cl) => cl.id === selected.clientId);
    return c?.name ?? 'Kein Kunde';
  }, [readOnlyClient, projectId, clientId, activeProjects, clients]);

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
    if (newProjectId && !readOnlyClient) {
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

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="job-number">Auftragsnummer *</Label>
          <Input
            id="job-number"
            placeholder="z.B. AUF-2026-001"
            value={jobNumber}
            onChange={(e) => {
              setJobNumber(e.target.value);
              if (jobNumberError) setJobNumberError(null);
            }}
            disabled={formDisabled}
            aria-invalid={showJobNumberError ? true : undefined}
          />
          {showJobNumberError && (
            <p className="text-sm text-destructive">{jobNumberError}</p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="job-title">Titel</Label>
          <Input
            id="job-title"
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
          <Label htmlFor="job-description">Beschreibung</Label>
          <Textarea
            id="job-description"
            placeholder="Optionale Beschreibung des Auftrags..."
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
          <Label htmlFor="job-client">Kunde</Label>
          <ClientSelectWithCreate
            clients={clients}
            value={clientId}
            onValueChange={handleClientChange}
            disabled={formDisabled}
            id="job-client"
            readOnly={isClientLocked}
            readOnlyLabel={lockedClientLabel}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="job-project">Projekt</Label>
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
            readOnly={readOnlyProject}
          />
          {noProjectsForClient && (
            <p className="text-xs text-muted-foreground">
              Dem ausgewählten Kunden sind keine aktiven Projekte zugeordnet.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="job-priority">Priorität</Label>
          <Select
            value={priority}
            onValueChange={(v) => setPriority(v as JobPriority)}
            disabled={formDisabled}
          >
            <SelectTrigger id="job-priority">
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
          <Label htmlFor="job-time">Geplante Uhrzeit</Label>
          <TimeInput
            id="job-time"
            value={plannedTime}
            onChange={setPlannedTime}
            disabled={formDisabled}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="job-duration">Geschätzte Dauer (Stunden)</Label>
          <DurationHoursInput
            id="job-duration"
            placeholder="z.B. 2.5"
            value={estimatedHours}
            onChange={setEstimatedHours}
            disabled={formDisabled}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="job-location">Ort</Label>
          <Input
            id="job-location"
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
            onSelectionChange={setSelectedEmployees}
            disabled={formDisabled}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="job-planned-working">
            Geplanter Arbeitsaufwand (Stunden)
          </Label>
          <DurationHoursInput
            id="job-planned-working"
            placeholder="z.B. 5"
            value={plannedWorkingHours}
            onChange={(value) => {
              setPlannedWorkingTouched(true);
              setPlannedWorkingHours(value);
            }}
            disabled={formDisabled}
          />
          <p className="text-xs text-muted-foreground">
            {!plannedWorkingTouched
              ? 'Wird automatisch aus geschätzter Dauer × Mitarbeiter vorbelegt.'
              : 'Manuell angepasst. Weitere Änderungen an Dauer oder Mitarbeitern überschreiben diesen Wert nicht.'}
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && (
          <p className="text-sm text-green-600">
            Auftrag erfolgreich erstellt!
          </p>
        )}
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={formDisabled}>
          {isLoading && <Loader2 className="size-4 animate-spin" />}
          {isLoading ? 'Wird erstellt...' : 'Auftrag erstellen'}
        </Button>
      </div>
    </form>
  );
}
