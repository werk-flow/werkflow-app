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
import { DatePicker } from '@/components/ui/date-picker';
import { JobMultiSelect } from './job-multi-select';
import { ClientSelectWithCreate } from './client-select-with-create';
import { updateProject, getProjectDetails, type UpdateProjectInput } from '@/lib/projects/actions';
import { updateJob } from '@/lib/jobs/actions';
import { type Client, type Job, type ProjectWithDetails } from '@/lib/jobs/types';

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  no_active_org: 'Keine Organisation ausgewählt.',
  not_authorized: 'Du bist nicht berechtigt, Projekte zu verwalten.',
  name_required: 'Bitte gib einen Namen ein.',
  project_not_found: 'Projekt nicht gefunden.',
  client_not_found: 'Kunde nicht gefunden.',
  no_changes: 'Keine Änderungen vorgenommen.',
  update_failed: 'Fehler beim Aktualisieren des Projekts.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
};

interface EditProjectDialogProps {
  project: ProjectWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  jobs: Job[];
}

export function EditProjectDialog({
  project,
  open,
  onOpenChange,
  clients,
  jobs,
}: EditProjectDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState<string>('');
  const [projectNumber, setProjectNumber] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState<Date | undefined>();
  const [plannedEndDate, setPlannedEndDate] = useState<Date | undefined>();
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [originalJobIds, setOriginalJobIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const availableJobs = useMemo(() => {
    return jobs.filter(
      (j) => !j.projectId || j.projectId === project.id
    );
  }, [jobs, project.id]);

  useEffect(() => {
    if (!open) return;

    setName(project.name);
    setDescription(project.description ?? '');
    setClientId(project.clientId ?? '');
    setProjectNumber(project.projectNumber ?? '');
    setPlannedStartDate(
      project.plannedStartDate
        ? new Date(project.plannedStartDate + 'T00:00:00')
        : undefined
    );
    setPlannedEndDate(
      project.plannedEndDate
        ? new Date(project.plannedEndDate + 'T00:00:00')
        : undefined
    );
    setError(null);
    setNameError(null);
    setSuccess(false);
    setHasAttemptedSubmit(false);

    setIsLoadingJobs(true);
    getProjectDetails(project.id).then((result) => {
      if (result.success) {
        const ids = result.details.jobs.map((j) => j.id);
        setSelectedJobIds(ids);
        setOriginalJobIds(ids);
      }
      setIsLoadingJobs(false);
    });
  }, [open, project]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    setNameError(null);

    if (!name.trim()) {
      setNameError('Bitte gib einen Namen ein.');
      return;
    }

    setIsLoading(true);
    setSuccess(false);

    try {
      const input: UpdateProjectInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        clientId: clientId && clientId !== 'none' ? clientId : undefined,
        projectNumber: projectNumber.trim() || undefined,
        plannedStartDate: plannedStartDate
          ? plannedStartDate.toISOString().split('T')[0]
          : undefined,
        plannedEndDate: plannedEndDate
          ? plannedEndDate.toISOString().split('T')[0]
          : undefined,
      };

      const result = await updateProject(project.id, input);

      if (!result.success && result.error !== 'no_changes') {
        setError(
          ERROR_MESSAGES[result.error] || result.error || 'Unbekannter Fehler'
        );
        return;
      }

      const toLink = selectedJobIds.filter(
        (id) => !originalJobIds.includes(id)
      );
      const toUnlink = originalJobIds.filter(
        (id) => !selectedJobIds.includes(id)
      );

      if (toLink.length > 0 || toUnlink.length > 0) {
        await Promise.allSettled([
          ...toLink.map((jobId) =>
            updateJob(jobId, { projectId: project.id })
          ),
          ...toUnlink.map((jobId) =>
            updateJob(jobId, { projectId: '' })
          ),
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

  const showNameError = hasAttemptedSubmit && nameError;
  const formDisabled = isLoading || success;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Projekt bearbeiten</DialogTitle>
          <DialogDescription>Ändere die Daten des Projekts.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-project-name">Name *</Label>
              <Input
                id="edit-project-name"
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
              <Label htmlFor="edit-project-number">Projektnummer</Label>
              <Input
                id="edit-project-number"
                placeholder="z.B. P-2026-001"
                value={projectNumber}
                onChange={(e) => setProjectNumber(e.target.value)}
                disabled={formDisabled}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-project-description">Beschreibung</Label>
              <Textarea
                id="edit-project-description"
                placeholder="Optionale Beschreibung..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={formDisabled}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-project-client">Kunde</Label>
              <ClientSelectWithCreate
                clients={clients}
                value={clientId}
                onValueChange={setClientId}
                disabled={formDisabled}
                id="edit-project-client"
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
              <Label>Zugewiesene Aufträge</Label>
              <JobMultiSelect
                jobs={availableJobs}
                selectedIds={selectedJobIds}
                onSelectionChange={setSelectedJobIds}
                disabled={formDisabled || isLoadingJobs}
              />
              {isLoadingJobs && (
                <p className="text-xs text-muted-foreground">
                  Aufträge werden geladen...
                </p>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && (
              <p className="text-sm text-green-600">
                Projekt erfolgreich aktualisiert!
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={formDisabled || !name.trim()}
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
