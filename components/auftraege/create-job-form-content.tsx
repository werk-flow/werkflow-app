'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Separator } from '@/components/ui/separator';
import { useBanner } from '@/components/ui/banner';
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
import { SiteContactFields } from './site-contact-fields';
import { formatSiteAddress } from '@/lib/clients/types';
import { createJob, getNextJobNumber, type CreateJobInput } from '@/lib/jobs/actions';
import { getProjectDetails } from '@/lib/projects/actions';
import { QualificationWarningDialog } from './qualification-warning-dialog';
import type {
  AssignmentApproval,
  AssignmentEvaluation,
} from '@/lib/qualifications/types';
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
import type { CalendarEntryDraft } from '@/components/kalender/calendar-entry-draft';

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
  onDraftChange?: (draft: CalendarEntryDraft | null) => void;
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
  onDraftChange,
  isActive = true,
}: CreateJobFormContentProps) {
  const previousInitialJobNumberRef = useRef(initialJobNumber ?? '');
  const [jobNumber, setJobNumber] = useState(initialJobNumber ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [qualificationWarning, setQualificationWarning] =
    useState<AssignmentEvaluation | null>(null);
  const [assignmentTeamSourceId, setAssignmentTeamSourceId] = useState<
    string | null
  >(null);
  const [clientId, setClientId] = useState<string>(defaultClientId ?? '');
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? '');
  const selectedProjectRef = useRef(defaultProjectId ?? '');
  const [isLoadingProjectDefaults, setIsLoadingProjectDefaults] = useState(false);
  const [projectDefaultsLoadFailed, setProjectDefaultsLoadFailed] = useState(false);
  // Prefill from the project's default site/contact when creating inside one.
  const defaultProject = projects.find(
    (project) => project.id === defaultProjectId
  );
  const [siteId, setSiteId] = useState<string>(defaultProject?.siteId ?? '');
  const [contactId, setContactId] = useState<string>(
    defaultProject?.contactId ?? ''
  );
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
  const { showBanner } = useBanner();

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

  useEffect(() => {
    if (!isActive || !onDraftChange) return;

    const durationMinutes = parseHoursInputToMinutes(estimatedHours);
    if (
      !plannedDate ||
      !plannedTime ||
      !durationMinutes ||
      selectedEmployees.length === 0
    ) {
      onDraftChange(null);
      return;
    }

    onDraftChange({
      date: plannedDate,
      startTime: plannedTime,
      durationMinutes,
      userIds: selectedEmployees
    });
  }, [
    estimatedHours,
    isActive,
    onDraftChange,
    plannedDate,
    plannedTime,
    selectedEmployees
  ]);

  const submitJob = async (approval?: AssignmentApproval) => {
    if (isLoadingProjectDefaults || projectDefaultsLoadFailed) return;
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
        location: location.trim() || undefined,
        siteId,
        contactId,
        selectedUserIds: selectedEmployees,
        assignmentApproval: approval ?? null,
        assignmentTeamSourceId,
      };

      const result = await createJob(input);

      if (!result.success) {
        if (
          (result.error === 'qualification_warning' ||
            result.error === 'stale_evaluation') &&
          'evaluation' in result
        ) {
          setQualificationWarning(result.evaluation);
          return;
        }
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

      setQualificationWarning(null);
      showBanner({ variant: 'success', message: 'Auftrag erfolgreich erstellt!' });
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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitJob();
  };

  const showContentError = hasAttemptedSubmit && contentError;
  const showJobNumberError = hasAttemptedSubmit && jobNumberError;
  const formDisabled = isLoading;
  const projectSelectionDisabled = formDisabled || isLoadingProjectDefaults;
  const siteContactDisabled = projectSelectionDisabled || projectDefaultsLoadFailed;
  const submitDisabled = formDisabled || isLoadingProjectDefaults || projectDefaultsLoadFailed;

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
    setProjectDefaultsLoadFailed(false);
    setClientId(newClientId);
    // Sites and contacts belong to one customer; a change invalidates them.
    setSiteId('');
    setContactId('');
    if (projectId) {
      const selectedProject = activeProjects.find((p) => p.id === projectId);
      if (selectedProject && newClientId && selectedProject.clientId !== newClientId && selectedProject.clientId !== null) {
        selectedProjectRef.current = '';
        setProjectId('');
      }
    }
  };

  const handleProjectChange = (newProjectId: string) => {
    setError(null);
    setProjectDefaultsLoadFailed(false);
    selectedProjectRef.current = newProjectId;
    setProjectId(newProjectId);
    if (newProjectId) {
      setIsLoadingProjectDefaults(true);
      const selected = activeProjects.find((p) => p.id === newProjectId);
      if (selected) {
        if (!readOnlyClient) {
          setClientId(selected.clientId ?? '');
        }
        // The project's default site/contact prefill the job; both stay
        // overridable per job.
        setSiteId(selected.siteId ?? '');
        setContactId(selected.contactId ?? '');
      }
      void getProjectDetails(newProjectId)
        .then((result) => {
          if (selectedProjectRef.current !== newProjectId) return;
          if (!result.success) {
            setSiteId('');
            setContactId('');
            setProjectDefaultsLoadFailed(true);
            setError('Die Projektvorgaben konnten nicht geladen werden.');
            return;
          }
          const project = result.details.project;
          if (!readOnlyClient) setClientId(project.clientId ?? '');
          setSiteId(project.siteId ?? '');
          setContactId(project.contactId ?? '');
          setProjectDefaultsLoadFailed(false);
        })
        .catch(() => {
          if (selectedProjectRef.current !== newProjectId) return;
          setSiteId('');
          setContactId('');
          setProjectDefaultsLoadFailed(true);
          setError('Die Projektvorgaben konnten nicht geladen werden.');
        })
        .finally(() => {
          if (selectedProjectRef.current === newProjectId) {
            setIsLoadingProjectDefaults(false);
          }
        });
    } else {
      setIsLoadingProjectDefaults(false);
      setSiteId('');
      setContactId('');
    }
  };

  const noProjectsForClient = clientId && filteredProjects.length === 0;

  return (
    <>
    <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="grid gap-4 py-2">
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
          <ErrorText>{showJobNumberError ? jobNumberError : null}</ErrorText>
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
          <ErrorText>{showContentError ? contentError : null}</ErrorText>
        </div>

        <Separator />
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Zuordnung
        </p>

        <div className="grid gap-2">
          <Label htmlFor="job-client">Kunde</Label>
          <ClientSelectWithCreate
            clients={clients}
            value={clientId}
            onValueChange={handleClientChange}
            disabled={projectSelectionDisabled}
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

        <Separator />
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Planung
        </p>

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

        <SiteContactFields
          clientId={clientId}
          siteId={siteId}
          contactId={contactId}
          onSiteChange={(nextSiteId, site) => {
            setSiteId(nextSiteId);
            // The site's current address becomes the job's recorded Ort;
            // it stays a text snapshot afterwards.
            if (site) {
              const address = formatSiteAddress(site);
              if (address) setLocation(address);
            }
          }}
          onContactChange={setContactId}
          disabled={siteContactDisabled}
          idPrefix="job"
        />

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
            assessedForDate={
              plannedDate ? toLocalDateString(plannedDate) : null
            }
            onTeamApplied={setAssignmentTeamSourceId}
            disabled={projectSelectionDisabled}
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

        <ErrorText>{error}</ErrorText>
      </DialogBody>
      <DialogFooter className="pt-4">
        <Button type="submit" disabled={submitDisabled}>
          {isLoading && <Loader2 className="size-4 animate-spin" />}
          {isLoading ? 'Wird erstellt...' : 'Auftrag erstellen'}
        </Button>
      </DialogFooter>
    </form>
    <QualificationWarningDialog
      evaluation={qualificationWarning}
      isSubmitting={isLoading}
      onCancel={() => setQualificationWarning(null)}
      onConfirm={submitJob}
    />
    </>
  );
}
