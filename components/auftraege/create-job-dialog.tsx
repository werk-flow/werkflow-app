'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
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
import { EmployeeMultiSelect, type OrgMemberOption } from './employee-multi-select';
import { ClientSelectWithCreate } from './client-select-with-create';
import { createJob, getNextJobNumber, type CreateJobInput } from '@/lib/jobs/actions';
import { assignEmployee } from '@/lib/jobs/actions';
import { JOB_PRIORITY_LABELS, type Client, type JobPriority, type ProjectWithDetails } from '@/lib/jobs/types';

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
  job_number_required: 'Bitte gib eine Auftragsnummer ein.',
  job_number_taken: 'Diese Auftragsnummer ist bereits vergeben.',
  client_not_found: 'Kunde nicht gefunden.',
  project_not_found: 'Projekt nicht gefunden.',
  create_failed: 'Fehler beim Erstellen des Auftrags.',
  assign_failed: 'Fehler beim Zuweisen des Mitarbeiters.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.'
};

interface CreateJobDialogProps {
  clients: Client[];
  members: OrgMemberOption[];
  projects?: ProjectWithDetails[];
  defaultProjectId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateJobDialog({ clients, members, projects = [], defaultProjectId, open: controlledOpen, onOpenChange: controlledOnOpenChange }: CreateJobDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (v: boolean) => controlledOnOpenChange?.(v) : setInternalOpen;
  const [jobNumber, setJobNumber] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? '');
  const [priority, setPriority] = useState<JobPriority>('mittel');
  const [plannedDate, setPlannedDate] = useState<Date | undefined>();
  const [plannedTime, setPlannedTime] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [location, setLocation] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [jobNumberError, setJobNumberError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    getNextJobNumber().then((result) => {
      if (result.success) setJobNumber(result.jobNumber);
    });
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    setTitleError(null);
    setJobNumberError(null);

    let hasValidationError = false;
    if (!jobNumber.trim()) {
      setJobNumberError('Bitte gib eine Auftragsnummer ein.');
      hasValidationError = true;
    }
    if (!title.trim()) {
      setTitleError('Bitte gib einen Titel ein.');
      hasValidationError = true;
    }
    if (hasValidationError) return;

    setIsLoading(true);
    setSuccess(false);

    try {
      const hoursNum = parseFloat(estimatedHours);
      const durationMinutes =
        !isNaN(hoursNum) && hoursNum > 0 ? Math.round(hoursNum * 60) : undefined;

      const input: CreateJobInput = {
        title: title.trim(),
        description: description.trim() || undefined,
        clientId: clientId || undefined,
        projectId: projectId || undefined,
        jobNumber: jobNumber.trim() || undefined,
        priority,
        plannedDate: plannedDate
          ? plannedDate.toISOString().split('T')[0]
          : undefined,
        plannedTime: plannedTime || undefined,
        estimatedDurationMinutes: durationMinutes,
        location: location.trim() || undefined
      };

      const result = await createJob(input);

      if (!result.success) {
        if (result.error === 'job_number_required' || result.error === 'job_number_taken') {
          setJobNumberError(ERROR_MESSAGES[result.error]);
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
      resetForm();
      setTimeout(() => {
        setOpen(false);
        setSuccess(false);
        router.refresh();
      }, 1500);
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setJobNumber('');
    setTitle('');
    setDescription('');
    setClientId('');
    setProjectId('');
    setPriority('mittel');
    setPlannedDate(undefined);
    setPlannedTime('');
    setEstimatedHours('');
    setLocation('');
    setSelectedEmployees([]);
    setHasAttemptedSubmit(false);
    setTitleError(null);
    setJobNumberError(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetForm();
      setError(null);
      setSuccess(false);
    }
  };

  const showTitleError = hasAttemptedSubmit && titleError;
  const showJobNumberError = hasAttemptedSubmit && jobNumberError;
  const formDisabled = isLoading || success;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            <span className="hidden sm:inline">Auftrag erstellen</span>
            <span className="sm:hidden">Erstellen</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Neuen Auftrag erstellen</DialogTitle>
          <DialogDescription>
            Erstelle einen neuen Auftrag für deine Organisation.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            {/* Job Number */}
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

            {/* Title */}
            <div className="grid gap-2">
              <Label htmlFor="job-title">Titel *</Label>
              <Input
                id="job-title"
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

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="job-description">Beschreibung</Label>
              <Textarea
                id="job-description"
                placeholder="Optionale Beschreibung des Auftrags..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={formDisabled}
              />
            </div>

            {/* Client */}
            <div className="grid gap-2">
              <Label htmlFor="job-client">Kunde</Label>
              <ClientSelectWithCreate
                clients={clients}
                value={clientId}
                onValueChange={setClientId}
                disabled={formDisabled}
                id="job-client"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="job-project">Projekt</Label>
              <Select
                value={projectId || 'none'}
                onValueChange={(v) => setProjectId(v === 'none' ? '' : v)}
                disabled={formDisabled}
              >
                <SelectTrigger id="job-project">
                  <SelectValue placeholder="Kein Projekt" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Kein Projekt</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.projectNumber ? `${p.projectNumber} – ` : ''}{p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

            {/* Planned Date */}
            <div className="grid gap-2">
              <Label>Geplantes Datum</Label>
              <DatePicker
                value={plannedDate}
                onChange={setPlannedDate}
                disabled={formDisabled}
              />
            </div>

            {/* Planned Time */}
            <div className="grid gap-2">
              <Label htmlFor="job-time">Geplante Uhrzeit</Label>
              <TimeInput
                id="job-time"
                value={plannedTime}
                onChange={setPlannedTime}
                disabled={formDisabled}
              />
            </div>

            {/* Estimated Duration */}
            <div className="grid gap-2">
              <Label htmlFor="job-duration">Geschätzte Dauer (Stunden)</Label>
              <Input
                id="job-duration"
                type="number"
                min="0"
                step="0.5"
                placeholder="z.B. 2.5"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                disabled={formDisabled}
              />
            </div>

            {/* Location */}
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

            {/* Employee Assignment */}
            <div className="grid gap-2">
              <Label>Mitarbeiter</Label>
              <EmployeeMultiSelect
                members={members}
                selectedIds={selectedEmployees}
                onSelectionChange={setSelectedEmployees}
                disabled={formDisabled}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && (
              <p className="text-sm text-green-600">
                Auftrag erfolgreich erstellt!
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={formDisabled || !title.trim() || !jobNumber.trim()}
            >
              {isLoading && <Loader2 className="size-4 animate-spin" />}
              {isLoading ? 'Wird erstellt...' : 'Auftrag erstellen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
