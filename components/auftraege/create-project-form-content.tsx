'use client';

import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { useState, useMemo, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Separator } from '@/components/ui/separator';
import { useBanner } from '@/components/ui/banner';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import { JobMultiSelect } from './job-multi-select';
import { ClientSelectWithCreate } from './client-select-with-create';
import { SiteContactFields } from './site-contact-fields';
import {
  createProject,
  getNextProjectNumber,
  type CreateProjectInput,
} from '@/lib/projects/actions';
import { updateJob } from '@/lib/jobs/actions';
import { type Client, type Job, type Project } from '@/lib/jobs/types';
import { toLocalDateString } from '@/lib/utils';
import { WorkTemplatePicker } from '@/components/arbeitsvorlagen/work-template-picker';

export const CREATE_PROJECT_ERROR_MESSAGES = {
  not_authenticated: 'Du bist nicht angemeldet.',
  no_active_org: 'Keine Organisation ausgewählt.',
  not_authorized: 'Du bist nicht berechtigt, Projekte zu verwalten.',
  name_or_description_required:
    'Bitte gib mindestens einen Titel oder eine Beschreibung ein.',
  project_number_required: 'Bitte gib eine Projektnummer ein.',
  project_number_taken: 'Diese Projektnummer ist bereits vergeben.',
  client_not_found: 'Kunde nicht gefunden.',
  create_failed: 'Fehler beim Erstellen des Projekts.',
  work_template_version_unavailable: 'Die gewählte Arbeitsvorlage ist nicht mehr verfügbar.',
  work_template_reference_unavailable: 'Die Arbeitsvorlage verweist auf nicht mehr aktive Stammdaten.',
  template_apply_failed: 'Die Arbeitsvorlage konnte nicht übernommen werden.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
} satisfies Record<string, string>;
const CREATE_PROJECT_ERROR_MESSAGE_BY_CODE: Record<string, string> = CREATE_PROJECT_ERROR_MESSAGES;

/** A validated create request the landing list runs itself (deferred submit). */
export type CreateProjectSubmission = {
  input: CreateProjectInput;
  linkedJobIds: string[];
};

/** Links the selected jobs to the new project; returns how many links failed. */
export async function linkJobsToProject(
  projectId: string,
  jobIds: string[]
): Promise<number> {
  if (jobIds.length === 0) return 0;
  const linkResults = await Promise.allSettled(
    jobIds.map((jobId) => updateJob(jobId, { projectId }))
  );
  return linkResults.filter(
    (entry) =>
      entry.status === 'rejected' ||
      (entry.status === 'fulfilled' && !entry.value.success)
  ).length;
}

// Partially failed job links must stay visible (no-silent-failure rule);
// the project itself exists at this point.
export function projectCreatedBanner(
  failedLinkCount: number
): { variant: 'success' | 'error'; message: string } {
  if (failedLinkCount === 0) {
    return { variant: 'success', message: 'Projekt erfolgreich erstellt!' };
  }
  return {
    variant: 'error',
    message:
      failedLinkCount === 1
        ? 'Projekt erstellt, aber eine Auftragszuordnung konnte nicht gespeichert werden. Bitte prüfe die Auftragsliste.'
        : `Projekt erstellt, aber ${failedLinkCount} Auftragszuordnungen konnten nicht gespeichert werden. Bitte prüfe die Auftragsliste.`,
  };
}

export interface CreateProjectFormContentProps {
  clients: Client[];
  jobs: Job[];
  defaultClientId?: string | undefined;
  readOnlyClient?: boolean | undefined;
  onSuccess?: (payload: {
    project: Project;
    linkedJobIds: string[];
  }) => void | Promise<void>;
  /**
   * Deferred submit (feedback canon, create from a dialog): the form hands the
   * validated input over instead of awaiting the server, so the caller closes
   * the dialog at once, shows a pending row, and owns the result.
   */
  onSubmitDeferred?: ((submission: CreateProjectSubmission) => void) | undefined;
  isActive?: boolean | undefined;
}

export function CreateProjectFormContent({
  clients,
  jobs,
  defaultClientId,
  readOnlyClient,
  onSuccess,
  onSubmitDeferred,
  isActive = true,
}: CreateProjectFormContentProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [templateVersionId, setTemplateVersionId] = useState('');
  const [clientId, setClientId] = useState<string>(defaultClientId ?? '');
  const [siteId, setSiteId] = useState<string>('');
  const [contactId, setContactId] = useState<string>('');
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
  const { showBanner } = useBanner();

  useEffect(() => {
    if (!isActive) return;
    getNextProjectNumber().then((result) => {
      if (result.success) {
        setProjectNumber((current) => current || result.projectNumber);
      }
    });
  }, [isActive]);

  const jobSearch = useJobEntityOptions(
    { kind: 'jobs', purpose: 'project-jobs', clientId: clientId || undefined,  },
    selectedJobIds,
    jobs.filter((job) => selectedJobIds.includes(job.id) || (!job.projectId && job.status !== 'fertig' && (!clientId || !job.clientId || job.clientId === clientId))).map((job) => ({ value: job.id, label: job.title || job.description || 'Auftrag', description: job.jobNumber ?? undefined, clientId: job.clientId, projectId: job.projectId, status: job.status })),
  );

  const unlinkedJobs = useMemo(() => {
    const baseJobs = jobs.filter((j) => !j.projectId && j.status !== 'fertig');
    if (!clientId) return baseJobs;
    return baseJobs.filter((j) => j.clientId === clientId || !j.clientId);
  }, [jobs, clientId]);

  const handleClientChange = (newClientId: string) => {
    setClientId(newClientId);
    // Sites and contacts belong to one customer; a change invalidates them.
    setSiteId('');
    setContactId('');
    if (selectedJobIds.length > 0) {
      // A list page is not the selection universe. Discard only hydrated,
      // incompatible choices; unknown selected identities must not be unlinked.
      const incompatible = new Set(jobSearch.options.filter((job) =>
        job.clientId && newClientId && job.clientId !== newClientId
      ).map((job) => job.value));
      setSelectedJobIds((previous) => previous.filter((id) => !incompatible.has(id)));
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
    setSiteId('');
    setContactId('');
    setProjectNumber('');
    setPlannedStartDate(undefined);
    setPlannedEndDate(undefined);
    setSelectedJobIds([]);
    setTemplateVersionId('');
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
    if (hasValidationError) {
      document
        .getElementById(!projectNumber.trim() ? 'create-project-number' : 'create-project-name')
        ?.focus();
      return;
    }

    const input: CreateProjectInput = {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(clientId ? { clientId } : {}),
      ...(siteId ? { siteId } : {}),
      ...(contactId ? { contactId } : {}),
      ...(projectNumber.trim() ? { projectNumber: projectNumber.trim() } : {}),
      ...(plannedStartDate
        ? { plannedStartDate: toLocalDateString(plannedStartDate) }
        : {}),
      ...(plannedEndDate
        ? { plannedEndDate: toLocalDateString(plannedEndDate) }
        : {}),
      ...(templateVersionId ? { templateVersionId } : {}),
    };

    if (onSubmitDeferred) {
      onSubmitDeferred({ input, linkedJobIds: selectedJobIds });
      return;
    }

    setIsLoading(true);

    try {
      const result = await createProject(input);

      if (!result.success) {
        if (
          result.error === 'project_number_required' ||
          result.error === 'project_number_taken'
        ) {
          setProjectNumberError(CREATE_PROJECT_ERROR_MESSAGES[result.error]);
        } else if (result.error === 'name_or_description_required') {
          setContentError(CREATE_PROJECT_ERROR_MESSAGES[result.error]);
        } else {
          setError(
            CREATE_PROJECT_ERROR_MESSAGE_BY_CODE[result.error] || result.error || 'Unbekannter Fehler'
          );
        }
        return;
      }

      const failedLinkCount = await linkJobsToProject(
        result.project.id,
        selectedJobIds
      );
      showBanner(projectCreatedBanner(failedLinkCount));
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
  const formDisabled = isLoading;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="grid gap-4 py-2">
        <Field
          label="Projektnummer"
          htmlFor="create-project-number"
          required
          error={showProjectNumberError ? projectNumberError : null}
        >
          <Input
            placeholder="z.B. P-2026-001"
            value={projectNumber}
            onChange={(e) => {
              setProjectNumber(e.target.value);
              if (projectNumberError) setProjectNumberError(null);
            }}
            disabled={formDisabled}
          />
        </Field>

        <Field label="Titel" htmlFor="create-project-name">
          <Input
            placeholder="z.B. Sanierung Hauptgebäude"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (contentError && e.target.value.trim()) setContentError(null);
            }}
            disabled={formDisabled}
            aria-invalid={showContentError ? true : undefined}
          />
        </Field>

        <Field
          label="Beschreibung"
          htmlFor="create-project-description"
          error={showContentError ? contentError : null}
        >
          <Textarea
            placeholder="Optionale Beschreibung des Projekts..."
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              if (contentError && e.target.value.trim()) setContentError(null);
            }}
            disabled={formDisabled}
          />
        </Field>

        <WorkTemplatePicker
          targetType="project"
          value={templateVersionId}
          onChange={setTemplateVersionId}
          disabled={formDisabled}
        />

        <Field label="Kunde" htmlFor="create-project-client">
          <ClientSelectWithCreate
            clients={clients}
            value={clientId}
            onValueChange={handleClientChange}
            disabled={formDisabled}
            readOnly={readOnlyClient}
            readOnlyLabel={readOnlyClientLabel}
          />
        </Field>

        <SiteContactFields
          clientId={clientId}
          siteId={siteId}
          contactId={contactId}
          onSiteChange={(nextSiteId) => setSiteId(nextSiteId)}
          onContactChange={setContactId}
          disabled={formDisabled}
          idPrefix="create-project"
        />

        <Separator />
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Planung
        </p>

        <Field label="Geplanter Beginn" htmlFor="create-project-start-date">
          <DatePicker
            value={plannedStartDate}
            onChange={setPlannedStartDate}
            placeholder="Startdatum wählen"
            disabled={formDisabled}
          />
        </Field>

        <Field label="Geplantes Ende" htmlFor="create-project-end-date">
          <DatePicker
            value={plannedEndDate}
            onChange={setPlannedEndDate}
            placeholder="Enddatum wählen"
            disabled={formDisabled}
          />
        </Field>

        <Field
          label="Aufträge zuweisen"
          htmlFor="create-project-jobs"
          description={
            unlinkedJobs.length === 0
              ? 'Alle Aufträge sind bereits einem Projekt zugeordnet.'
              : undefined
          }
        >
          <JobMultiSelect
            jobs={unlinkedJobs}
            search={jobSearch}
            selectedIds={selectedJobIds}
            onSelectionChange={setSelectedJobIds}
            disabled={formDisabled}
          />
        </Field>

        <ErrorText>{error}</ErrorText>
      </DialogBody>

      <DialogFooter className="pt-4">
        <Button type="submit" disabled={formDisabled}>
          {isLoading && <Loader2 className="size-4 animate-spin" />}
          {isLoading ? 'Wird erstellt...' : 'Projekt erstellen'}
        </Button>
      </DialogFooter>
    </form>
  );
}
