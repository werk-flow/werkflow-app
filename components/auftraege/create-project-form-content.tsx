'use client';

import { useState, useMemo, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import { JobMultiSelect } from './job-multi-select';
import { ClientSelectWithCreate } from './client-select-with-create';
import {
  createProject,
  getNextProjectNumber,
  type CreateProjectInput,
} from '@/lib/projects/actions';
import { updateJob } from '@/lib/jobs/actions';
import { type Client, type Job, type Project } from '@/lib/jobs/types';
import { toLocalDateString } from '@/lib/utils';

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  no_active_org: 'Keine Organisation ausgewählt.',
  not_authorized: 'Du bist nicht berechtigt, Projekte zu verwalten.',
  name_or_description_required:
    'Bitte gib mindestens einen Titel oder eine Beschreibung ein.',
  project_number_required: 'Bitte gib eine Projektnummer ein.',
  project_number_taken: 'Diese Projektnummer ist bereits vergeben.',
  client_not_found: 'Kunde nicht gefunden.',
  create_failed: 'Fehler beim Erstellen des Projekts.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
};

export interface CreateProjectFormContentProps {
  clients: Client[];
  jobs: Job[];
  defaultClientId?: string;
  readOnlyClient?: boolean;
  onSuccess?: (payload: {
    project: Project;
    linkedJobIds: string[];
  }) => void | Promise<void>;
  isActive?: boolean;
}

export function CreateProjectFormContent({
  clients,
  jobs,
  defaultClientId,
  readOnlyClient,
  onSuccess,
  isActive = true,
}: CreateProjectFormContentProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState<string>(defaultClientId ?? '');
  const [projectNumber, setProjectNumber] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState<Date | undefined>();
  const [plannedEndDate, setPlannedEndDate] = useState<Date | undefined>();
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [projectNumberError, setProjectNumberError] = useState<string | null>(
    null
  );
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!isActive) return;
    getNextProjectNumber().then((result) => {
      if (result.success) setProjectNumber(result.projectNumber);
    });
  }, [isActive]);

  const unlinkedJobs = useMemo(() => {
    const baseJobs = jobs.filter((j) => !j.projectId && j.status !== 'fertig');
    if (!clientId) return baseJobs;
    return baseJobs.filter((j) => j.clientId === clientId || !j.clientId);
  }, [jobs, clientId]);

  const handleClientChange = (newClientId: string) => {
    setClientId(newClientId);
    if (selectedJobIds.length > 0) {
      const validJobIds = new Set(
        jobs
          .filter(
            (j) =>
              !j.projectId &&
              j.status !== 'fertig' &&
              (!newClientId || j.clientId === newClientId || !j.clientId)
          )
          .map((j) => j.id)
      );
      setSelectedJobIds((prev) => prev.filter((id) => validJobIds.has(id)));
    }
  };

  const readOnlyClientLabel = useMemo(() => {
    if (!readOnlyClient) return undefined;
    if (!clientId) return 'Kein Kunde';
    const client = clients.find((entry) => entry.id === clientId);
    return client?.name;
  }, [readOnlyClient, clientId, clients]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setClientId(defaultClientId ?? '');
    setProjectNumber('');
    setPlannedStartDate(undefined);
    setPlannedEndDate(undefined);
    setSelectedJobIds([]);
    setHasAttemptedSubmit(false);
    setContentError(null);
    setProjectNumberError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    setContentError(null);
    setProjectNumberError(null);

    let hasValidationError = false;
    if (!projectNumber.trim()) {
      setProjectNumberError('Bitte gib eine Projektnummer ein.');
      hasValidationError = true;
    }
    if (!name.trim() && !description.trim()) {
      setContentError(
        'Bitte gib mindestens einen Titel oder eine Beschreibung ein.'
      );
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
          ? toLocalDateString(plannedStartDate)
          : undefined,
        plannedEndDate: plannedEndDate
          ? toLocalDateString(plannedEndDate)
          : undefined,
      };

      const result = await createProject(input);

      if (!result.success) {
        if (
          result.error === 'project_number_required' ||
          result.error === 'project_number_taken'
        ) {
          setProjectNumberError(ERROR_MESSAGES[result.error]);
        } else if (result.error === 'name_or_description_required') {
          setContentError(ERROR_MESSAGES[result.error]);
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
          (entry) =>
            entry.status === 'rejected' ||
            (entry.status === 'fulfilled' && !entry.value.success)
        );
        if (failed.length > 0) {
          console.error('Some job links failed:', failed);
        }
      }

      setSuccess(true);
      resetForm();
      await onSuccess?.({
        project: result.project,
        linkedJobIds: selectedJobIds,
      });
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  const showContentError = hasAttemptedSubmit && contentError;
  const showProjectNumberError = hasAttemptedSubmit && projectNumberError;
  const formDisabled = isLoading || success;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="grid gap-4 py-4">
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
          <Label htmlFor="create-project-name">Titel</Label>
          <Input
            id="create-project-name"
            placeholder="z.B. Sanierung Hauptgebäude"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (contentError && e.target.value.trim()) setContentError(null);
            }}
            disabled={formDisabled}
            aria-invalid={showContentError ? true : undefined}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="create-project-description">Beschreibung</Label>
          <Textarea
            id="create-project-description"
            placeholder="Optionale Beschreibung des Projekts..."
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
          <Label htmlFor="create-project-client">Kunde</Label>
          <ClientSelectWithCreate
            clients={clients}
            value={clientId}
            onValueChange={handleClientChange}
            disabled={formDisabled}
            id="create-project-client"
            readOnly={readOnlyClient}
            readOnlyLabel={readOnlyClientLabel}
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
          <p className="text-sm text-green-600">Projekt erfolgreich erstellt!</p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={formDisabled}>
          {isLoading && <Loader2 className="size-4 animate-spin" />}
          {isLoading ? 'Wird erstellt...' : 'Projekt erstellen'}
        </Button>
      </div>
    </form>
  );
}
