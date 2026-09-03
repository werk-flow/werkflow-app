'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Separator } from '@/components/ui/separator';
import { useBanner } from '@/components/ui/banner';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
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
import { ParkConfirmationDialog } from './park-confirmation-dialog';
import {
  updateJob,
  getJobDetails,
  type UpdateJobInput
} from '@/lib/jobs/actions';
import { QualificationWarningDialog } from './qualification-warning-dialog';
import type {
  AssignmentApproval,
  AssignmentEvaluation,
} from '@/lib/qualifications/types';
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
  partial_update:
    'Die Auftragsdaten wurden gespeichert, aber die Zuweisungen konnten nicht vollständig aktualisiert werden. Bitte lade die Ansicht neu und prüfe den Auftrag.',
  rollback_failed:
    'Der Auftrag konnte nicht vollständig angelegt werden. Bitte lade die Ansicht neu und prüfe die Auftragsliste.',
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
  const [siteId, setSiteId] = useState<string>('');
  const [contactId, setContactId] = useState<string>('');
  const [priority, setPriority] = useState<JobPriority>('mittel');
  const [plannedDate, setPlannedDate] = useState<Date | undefined>();
  const [plannedTime, setPlannedTime] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [plannedWorkingHours, setPlannedWorkingHours] = useState('');
  const [plannedWorkingTouched, setPlannedWorkingTouched] = useState(false);
  const [autoSyncPlannedWorking, setAutoSyncPlannedWorking] = useState(false);
  const [location, setLocation] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [qualificationWarning, setQualificationWarning] =
    useState<AssignmentEvaluation | null>(null);
  const [confirmedDateRemovalForWarning, setConfirmedDateRemovalForWarning] =
    useState(false);
  const [assignmentTeamSourceId, setAssignmentTeamSourceId] = useState<
    string | null
  >(null);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  const [assignmentsLoadFailed, setAssignmentsLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [showAutoParkDialog, setShowAutoParkDialog] = useState(false);
  const initializedJobIdRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);
  const router = useRouter();
  const { showBanner } = useBanner();

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current && initializedJobIdRef.current === job.id) return;
    wasOpenRef.current = true;
    initializedJobIdRef.current = job.id;

    setJobNumber(job.jobNumber ?? '');
    setTitle(job.title);
    setDescription(job.description ?? '');
    setProjectId(job.projectId ?? '');
    setClientId(job.clientId ?? '');
    setPriority(job.priority);
    setPlannedDate(job.plannedDate ? new Date(job.plannedDate + 'T00:00:00') : undefined);
    setPlannedTime(job.plannedTime ?? '');
    setEstimatedHours(formatMinutesAsHoursInput(job.estimatedDurationMinutes));
    setPlannedWorkingHours(formatMinutesAsHoursInput(job.plannedWorkingMinutes));
    setPlannedWorkingTouched(false);
    setAutoSyncPlannedWorking(false);
    setLocation(job.location ?? '');
    setSiteId(job.siteId ?? '');
    setContactId(job.contactId ?? '');
    setError(null);
    setContentError(null);
    setHasAttemptedSubmit(false);
    setAssignmentTeamSourceId(null);
    setConfirmedDateRemovalForWarning(false);
    setQualificationWarning(null);

    setIsLoadingAssignments(true);
    setAssignmentsLoadFailed(false);
    getJobDetails(job.id)
      .then((result) => {
        if (result.success) {
          const ids = result.job.assignments.map((a) => a.userId);
          setSelectedEmployees(ids);
        } else {
          setAssignmentsLoadFailed(true);
        }
        setIsLoadingAssignments(false);
      })
      .catch(() => {
        setAssignmentsLoadFailed(true);
        setIsLoadingAssignments(false);
      });
  }, [open, job]);

  const submitChanges = async (
    confirmedDateRemoval = false,
    approval?: AssignmentApproval
  ) => {
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
        location: location.trim() || (job.location !== null ? '' : undefined),
        siteId,
        contactId,
        selectedUserIds: selectedEmployees,
        assignmentApproval: approval ?? null,
        assignmentTeamSourceId,
      };

      const result = await updateJob(job.id, input);

      if (!result.success && result.error !== 'no_changes') {
        if (
          (result.error === 'qualification_warning' ||
            result.error === 'stale_evaluation') &&
          'evaluation' in result
        ) {
          setConfirmedDateRemovalForWarning(confirmedDateRemoval);
          setQualificationWarning(result.evaluation);
          return;
        }
        setQualificationWarning(null);
        setConfirmedDateRemovalForWarning(false);
        if (result.error === 'title_or_description_required') {
          setContentError(ERROR_MESSAGES[result.error]);
        } else {
          setError(
            ERROR_MESSAGES[result.error] || 'Der Auftrag konnte nicht gespeichert werden.'
          );
        }
        return;
      }

      setQualificationWarning(null);
      setConfirmedDateRemovalForWarning(false);
      onOpenChange(false);
      showBanner({ variant: 'success', message: 'Auftrag gespeichert.' });
      if (onSuccess) {
        await onSuccess({
          job: result.success ? result.job : job,
          selectedEmployeeIds: selectedEmployees,
        });
      } else {
        router.refresh();
      }
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
  const formDisabled = isLoading;
  // Submitting before the current assignments finished loading (or after the
  // load failed) would save an empty assignment list and wipe the job's crew.
  const submitDisabled =
    formDisabled || isLoadingAssignments || assignmentsLoadFailed;

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
    // Sites and contacts belong to one customer; a change invalidates them.
    if (newClientId !== clientId) {
      setSiteId('');
      setContactId('');
    }
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
        if (selected.clientId !== clientId) {
          setSiteId('');
          setContactId('');
        }
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
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[500px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Auftrag bearbeiten</DialogTitle>
          <DialogDescription>Ändere die Daten des Auftrags.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-2">
            <Field label="Auftragsnummer" htmlFor="edit-job-number">
              <Input
                placeholder="z.B. AUF-2026-001"
                value={jobNumber}
                onChange={(e) => setJobNumber(e.target.value)}
                disabled={formDisabled}
              />
            </Field>

            <Field label="Titel" htmlFor="edit-job-title">
              <Input
                placeholder="z.B. Heizung reparieren"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (contentError && e.target.value.trim()) setContentError(null);
                }}
                disabled={formDisabled}
                aria-invalid={showContentError ? true : undefined}
              />
            </Field>

            <Field
              label="Beschreibung"
              htmlFor="edit-job-description"
              error={showContentError ? contentError : null}
            >
              <Textarea
                placeholder="Optionale Beschreibung..."
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (contentError && e.target.value.trim()) setContentError(null);
                }}
                disabled={formDisabled}
              />
            </Field>

            <Separator />
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Zuordnung
            </p>

            <Field label="Kunde" htmlFor="edit-job-client">
              <ClientSelectWithCreate
                clients={clients}
                value={clientId}
                onValueChange={handleClientChange}
                disabled={formDisabled}
                readOnly={isClientLocked}
                readOnlyLabel={lockedClientLabel}
              />
            </Field>

            <Field
              label="Projekt"
              htmlFor="edit-job-project"
              description={
                noProjectsForClient
                  ? 'Dem ausgewählten Kunden sind keine aktiven Projekte zugeordnet.'
                  : undefined
              }
            >
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
            </Field>

            <Field label="Priorität" htmlFor="edit-job-priority">
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as JobPriority)}
                disabled={formDisabled}
              >
                <SelectTrigger>
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
            </Field>

            <Separator />
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Planung
            </p>

            <Field label="Geplantes Datum" htmlFor="edit-job-date">
              <DatePicker
                value={plannedDate}
                onChange={setPlannedDate}
                disabled={formDisabled}
              />
            </Field>

            <Field label="Geplante Uhrzeit" htmlFor="edit-job-time">
              <TimeInput
                value={plannedTime}
                onChange={setPlannedTime}
                disabled={formDisabled}
              />
            </Field>

            <Field label="Geschätzte Dauer (Stunden)" htmlFor="edit-job-duration">
              <DurationHoursInput
                id="edit-job-duration"
                placeholder="z.B. 2.5"
                value={estimatedHours}
                onChange={handleEstimatedHoursChange}
                disabled={formDisabled}
              />
            </Field>

            <SiteContactFields
              clientId={clientId}
              siteId={siteId}
              contactId={contactId}
              onSiteChange={(nextSiteId, site) => {
                setSiteId(nextSiteId);
                // The site's current address becomes the recorded Ort; it
                // stays a text snapshot afterwards.
                if (site) {
                  const address = formatSiteAddress(site);
                  if (address) setLocation(address);
                }
              }}
              onContactChange={setContactId}
              disabled={formDisabled}
              idPrefix="edit-job"
            />

            <Field label="Ort" htmlFor="edit-job-location">
              <Input
                placeholder="Adresse oder Ort"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                disabled={formDisabled}
              />
            </Field>

            <Field
              label="Mitarbeiter"
              htmlFor="edit-job-employees"
              description={isLoadingAssignments ? 'Zuweisungen werden geladen...' : undefined}
              error={
                assignmentsLoadFailed
                  ? 'Die aktuellen Zuweisungen konnten nicht geladen werden. Bitte schließe den Dialog und öffne ihn erneut.'
                  : null
              }
            >
              <EmployeeMultiSelect
                members={members}
                selectedIds={selectedEmployees}
                onSelectionChange={handleSelectedEmployeesChange}
                assessedForDate={
                  plannedDate ? toLocalDateString(plannedDate) : null
                }
                onTeamApplied={setAssignmentTeamSourceId}
                disabled={formDisabled || isLoadingAssignments}
              />
            </Field>

            <Field
              label="Geplanter Arbeitsaufwand (Stunden)"
              htmlFor="edit-job-planned-working"
              description={
                plannedWorkingTouched
                  ? 'Manuell angepasst. Bis zum Schließen dieses Dialogs überschreiben weitere Änderungen an Dauer oder Mitarbeitern diesen Wert nicht.'
                  : !autoSyncPlannedWorking
                    ? 'Bleibt zunächst beim aktuellen Wert. Änderungen an Dauer oder Mitarbeitern berechnen ihn neu.'
                    : 'Wird automatisch aus geschätzter Dauer × Mitarbeiter berechnet.'
              }
            >
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
            </Field>

            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter className="pt-4">
            <Button
              type="submit"
              disabled={submitDisabled}
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
    <QualificationWarningDialog
      evaluation={qualificationWarning}
      isSubmitting={isLoading}
      onCancel={() => {
        setQualificationWarning(null);
        setConfirmedDateRemovalForWarning(false);
      }}
      onConfirm={(approval) =>
        submitChanges(confirmedDateRemovalForWarning, approval)
      }
    />
    </>
  );
}
