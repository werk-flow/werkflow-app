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
import { SearchableSelect } from '@/components/ui/searchable-select';
import { EmployeeMultiSelect, type OrgMemberOption } from './employee-multi-select';

const ASSIGNABLE_ROLES_EXCLUDED = ['admin', 'buero'];
import { ClientSelectWithCreate } from './client-select-with-create';
import {
  updateJob,
  assignEmployee,
  unassignEmployee,
  getJobDetails,
  type UpdateJobInput
} from '@/lib/jobs/actions';
import { JOB_PRIORITY_LABELS, type Client, type Job, type JobPriority, type ProjectWithDetails } from '@/lib/jobs/types';
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
  title_required: 'Bitte gib einen Titel ein.',
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
}

export function EditJobDialog({
  job,
  open,
  onOpenChange,
  clients,
  members,
  projects = []
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
  const [location, setLocation] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [originalAssignees, setOriginalAssignees] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [success, setSuccess] = useState(false);
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
    setEstimatedHours(
      job.estimatedDurationMinutes
        ? String(job.estimatedDurationMinutes / 60)
        : ''
    );
    setLocation(job.location ?? '');
    setError(null);
    setTitleError(null);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    setTitleError(null);

    if (!title.trim()) {
      setTitleError('Bitte gib einen Titel ein.');
      return;
    }

    setIsLoading(true);
    setSuccess(false);

    try {
      const hoursNum = parseFloat(estimatedHours);
      const durationMinutes =
        !isNaN(hoursNum) && hoursNum > 0 ? Math.round(hoursNum * 60) : undefined;

      const input: UpdateJobInput = {
        title: title.trim(),
        description: description.trim() || undefined,
        clientId: clientId && clientId !== 'none' ? clientId : '',
        projectId: projectId && projectId !== 'none' ? projectId : '',
        jobNumber: jobNumber.trim() || undefined,
        priority,
        plannedDate: plannedDate
          ? toLocalDateString(plannedDate)
          : undefined,
        plannedTime: plannedTime || undefined,
        estimatedDurationMinutes: durationMinutes,
        location: location.trim() || undefined
      };

      const result = await updateJob(job.id, input);

      if (!result.success && result.error !== 'no_changes') {
        setError(
          ERROR_MESSAGES[result.error] || result.error || 'Unbekannter Fehler'
        );
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
      setTimeout(() => {
        onOpenChange(false);
        setSuccess(false);
        router.refresh();
      }, 1500);
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  const showTitleError = hasAttemptedSubmit && titleError;
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
              <Label htmlFor="edit-job-title">Titel *</Label>
              <Input
                id="edit-job-title"
                placeholder="z.B. Heizung reparieren"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (titleError) setTitleError(null);
                }}
                disabled={formDisabled}
                aria-invalid={showTitleError ? true : undefined}
              />
              {showTitleError && (
                <p className="text-sm text-destructive">{titleError}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-job-description">Beschreibung</Label>
              <Textarea
                id="edit-job-description"
                placeholder="Optionale Beschreibung..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={formDisabled}
              />
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
              <Input
                id="edit-job-duration"
                type="number"
                min="0"
                step="0.5"
                placeholder="z.B. 2.5"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
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
                members={members.filter((m) => !m.role || !ASSIGNABLE_ROLES_EXCLUDED.includes(m.role))}
                selectedIds={selectedEmployees}
                onSelectionChange={setSelectedEmployees}
                disabled={formDisabled || isLoadingAssignments}
              />
              {isLoadingAssignments && (
                <p className="text-xs text-muted-foreground">
                  Zuweisungen werden geladen...
                </p>
              )}
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
              disabled={formDisabled || !title.trim()}
            >
              {isLoading && <Loader2 className="size-4 animate-spin" />}
              {isLoading ? 'Wird gespeichert...' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
