'use client';

import { useState, useMemo, useEffect } from 'react';
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
import { JobMultiSelect } from './job-multi-select';
import { ClientSelectWithCreate } from './client-select-with-create';
import { createProject, getNextProjectNumber, type CreateProjectInput } from '@/lib/projects/actions';
import { updateJob } from '@/lib/jobs/actions';
import { type Client, type Job } from '@/lib/jobs/types';

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  no_active_org: 'Keine Organisation ausgewählt.',
  not_authorized: 'Du bist nicht berechtigt, Projekte zu verwalten.',
  name_required: 'Bitte gib einen Namen ein.',
  project_number_required: 'Bitte gib eine Projektnummer ein.',
  project_number_taken: 'Diese Projektnummer ist bereits vergeben.',
  client_not_found: 'Kunde nicht gefunden.',
  create_failed: 'Fehler beim Erstellen des Projekts.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
};

interface CreateProjectDialogProps {
  clients: Client[];
  jobs: Job[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateProjectDialog({ clients, jobs, open: controlledOpen, onOpenChange: controlledOnOpenChange }: CreateProjectDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (v: boolean) => controlledOnOpenChange?.(v) : setInternalOpen;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState<string>('');
  const [projectNumber, setProjectNumber] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState<Date | undefined>();
  const [plannedEndDate, setPlannedEndDate] = useState<Date | undefined>();
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [projectNumberError, setProjectNumberError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    getNextProjectNumber().then((result) => {
      if (result.success) setProjectNumber(result.projectNumber);
    });
  }, [open]);

  const unlinkedJobs = useMemo(
    () => jobs.filter((j) => !j.projectId),
    [jobs]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    setNameError(null);
    setProjectNumberError(null);

    let hasValidationError = false;
    if (!projectNumber.trim()) {
      setProjectNumberError('Bitte gib eine Projektnummer ein.');
      hasValidationError = true;
    }
    if (!name.trim()) {
      setNameError('Bitte gib einen Namen ein.');
      hasValidationError = true;
    }
    if (hasValidationError) return;

    setIsLoading(true);
    setSuccess(false);

    try {
      const input: CreateProjectInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        clientId: clientId || undefined,
        projectNumber: projectNumber.trim() || undefined,
        plannedStartDate: plannedStartDate
          ? plannedStartDate.toISOString().split('T')[0]
          : undefined,
        plannedEndDate: plannedEndDate
          ? plannedEndDate.toISOString().split('T')[0]
          : undefined,
      };

      const result = await createProject(input);

      if (!result.success) {
        if (result.error === 'project_number_required' || result.error === 'project_number_taken') {
          setProjectNumberError(ERROR_MESSAGES[result.error]);
        } else {
          setError(
            ERROR_MESSAGES[result.error] || result.error || 'Unbekannter Fehler'
          );
        }
        return;
      }

      if (selectedJobIds.length > 0) {
        const linkResults = await Promise.allSettled(
          selectedJobIds.map((jobId) =>
            updateJob(jobId, { projectId: result.project.id })
          )
        );
        const failed = linkResults.filter(
          (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)
        );
        if (failed.length > 0) {
          console.error('Some job links failed:', failed);
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
    setName('');
    setDescription('');
    setClientId('');
    setProjectNumber('');
    setPlannedStartDate(undefined);
    setPlannedEndDate(undefined);
    setSelectedJobIds([]);
    setHasAttemptedSubmit(false);
    setNameError(null);
    setProjectNumberError(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetForm();
      setError(null);
      setSuccess(false);
    }
  };

  const showNameError = hasAttemptedSubmit && nameError;
  const showProjectNumberError = hasAttemptedSubmit && projectNumberError;
  const formDisabled = isLoading || success;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            <span className="hidden sm:inline">Projekt erstellen</span>
            <span className="sm:hidden">Erstellen</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Neues Projekt erstellen</DialogTitle>
          <DialogDescription>
            Erstelle ein neues Projekt für deine Organisation.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="create-project-name">Name *</Label>
              <Input
                id="create-project-name"
                placeholder="z.B. Sanierung Hauptgebäude"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                disabled={formDisabled}
                aria-invalid={showNameError ? true : undefined}
              />
              {showNameError && (
                <p className="text-sm text-destructive">{nameError}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="create-project-number">Projektnummer *</Label>
              <Input
                id="create-project-number"
                placeholder="z.B. P-2026-001"
                value={projectNumber}
                onChange={(e) => {
                  setProjectNumber(e.target.value);
                  if (projectNumberError) setProjectNumberError(null);
                }}
                disabled={formDisabled}
                aria-invalid={showProjectNumberError ? true : undefined}
              />
              {showProjectNumberError && (
                <p className="text-sm text-destructive">{projectNumberError}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="create-project-description">Beschreibung</Label>
              <Textarea
                id="create-project-description"
                placeholder="Optionale Beschreibung..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={formDisabled}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="create-project-client">Kunde</Label>
              <ClientSelectWithCreate
                clients={clients}
                value={clientId}
                onValueChange={setClientId}
                disabled={formDisabled}
                id="create-project-client"
              />
            </div>

            <div className="grid gap-2">
              <Label>Geplanter Beginn</Label>
              <DatePicker
                value={plannedStartDate}
                onChange={setPlannedStartDate}
                placeholder="Startdatum wählen"
                disabled={formDisabled}
              />
            </div>

            <div className="grid gap-2">
              <Label>Geplantes Ende</Label>
              <DatePicker
                value={plannedEndDate}
                onChange={setPlannedEndDate}
                placeholder="Enddatum wählen"
                disabled={formDisabled}
              />
            </div>

            <div className="grid gap-2">
              <Label>Aufträge zuweisen</Label>
              <JobMultiSelect
                jobs={unlinkedJobs}
                selectedIds={selectedJobIds}
                onSelectionChange={setSelectedJobIds}
                disabled={formDisabled}
              />
              {unlinkedJobs.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Alle Aufträge sind bereits einem Projekt zugeordnet.
                </p>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && (
              <p className="text-sm text-green-600">
                Projekt erfolgreich erstellt!
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={formDisabled || !name.trim() || !projectNumber.trim()}
            >
              {isLoading && <Loader2 className="size-4 animate-spin" />}
              {isLoading ? 'Wird erstellt...' : 'Projekt erstellen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
