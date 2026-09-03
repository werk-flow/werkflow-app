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
import { DatePicker } from '@/components/ui/date-picker';
import { JobMultiSelect } from './job-multi-select';
import { ClientSelectWithCreate } from './client-select-with-create';
import { SiteContactFields } from './site-contact-fields';
import { updateProject, getProjectDetails, type UpdateProjectInput } from '@/lib/projects/actions';
import { updateJob } from '@/lib/jobs/actions';
import {
  type Client,
  type Job,
  type Project,
  type ProjectWithDetails,
} from '@/lib/jobs/types';
import { toLocalDateString } from '@/lib/utils';

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  no_active_org: 'Keine Organisation ausgewählt.',
  not_authorized: 'Du bist nicht berechtigt, Projekte zu verwalten.',
  name_or_description_required:
    'Bitte gib mindestens einen Titel oder eine Beschreibung ein.',
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
  onSuccess?: (payload: {
    project: Project;
    selectedJobIds: string[];
  }) => void | Promise<void>;
}

export function EditProjectDialog({
  project,
  open,
  onOpenChange,
  clients,
  jobs,
  onSuccess,
}: EditProjectDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState<string>('');
  const [siteId, setSiteId] = useState<string>('');
  const [contactId, setContactId] = useState<string>('');
  const [projectNumber, setProjectNumber] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState<Date | undefined>();
  const [plannedEndDate, setPlannedEndDate] = useState<Date | undefined>();
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [originalJobIds, setOriginalJobIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const initializedProjectIdRef = useRef<string | null>(null);
  const projectDetailsGenerationRef = useRef(0);
  const router = useRouter();
  const { showBanner } = useBanner();

  const availableJobs = useMemo(() => {
    const base = jobs.filter(
      (j) => !j.projectId || j.projectId === project.id
    );
    if (!clientId) return base;
    return base.filter(
      (j) => j.projectId === project.id || j.clientId === clientId || !j.clientId
    );
  }, [jobs, project.id, clientId]);

  const handleClientChange = (newClientId: string) => {
    setClientId(newClientId);
    // Sites and contacts belong to one customer; a change invalidates them.
    if (newClientId !== clientId) {
      setSiteId('');
      setContactId('');
    }
    if (selectedJobIds.length > 0) {
      const validJobIds = new Set(
        jobs
          .filter((j) =>
            (!j.projectId || j.projectId === project.id) &&
            (j.projectId === project.id || !newClientId || j.clientId === newClientId || !j.clientId)
          )
          .map((j) => j.id)
      );
      setSelectedJobIds((prev) => prev.filter((id) => validJobIds.has(id)));
    }
  };

  useEffect(() => {
    if (!open) {
      initializedProjectIdRef.current = null;
      projectDetailsGenerationRef.current += 1;
      setIsLoadingJobs(false);
      return;
    }
    if (initializedProjectIdRef.current === project.id) return;
    initializedProjectIdRef.current = project.id;

    setName(project.name);
    setDescription(project.description ?? '');
    setClientId(project.clientId ?? '');
    setSiteId(project.siteId ?? '');
    setContactId(project.contactId ?? '');
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
    setContentError(null);
    setHasAttemptedSubmit(false);

    const generation = ++projectDetailsGenerationRef.current;
    setIsLoadingJobs(true);
    void getProjectDetails(project.id)
      .then((result) => {
        if (projectDetailsGenerationRef.current !== generation) return;
        if (!result.success) {
          setSelectedJobIds([]);
          setOriginalJobIds([]);
          setError(
            ERROR_MESSAGES[result.error] ||
              'Die Projektaufträge konnten nicht geladen werden.'
          );
          return;
        }
        const ids = result.details.jobs.map((job) => job.id);
        setSelectedJobIds(ids);
        setOriginalJobIds(ids);
      })
      .catch(() => {
        if (projectDetailsGenerationRef.current !== generation) return;
        setSelectedJobIds([]);
        setOriginalJobIds([]);
        setError('Die Projektaufträge konnten nicht geladen werden.');
      })
      .finally(() => {
        if (projectDetailsGenerationRef.current === generation) {
          setIsLoadingJobs(false);
        }
      });
  }, [open, project]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    setContentError(null);

    if (!name.trim() && !description.trim()) {
      setContentError(
        'Bitte gib mindestens einen Titel oder eine Beschreibung ein.'
      );
      return;
    }

    setIsLoading(true);

    try {
      const input: UpdateProjectInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        clientId: clientId && clientId !== 'none' ? clientId : undefined,
        siteId,
        contactId,
        projectNumber: projectNumber.trim() || undefined,
        plannedStartDate: plannedStartDate
          ? toLocalDateString(plannedStartDate)
          : undefined,
        plannedEndDate: plannedEndDate
          ? toLocalDateString(plannedEndDate)
          : undefined,
      };

      const result = await updateProject(project.id, input);

      if (!result.success && result.error !== 'no_changes') {
        if (result.error === 'name_or_description_required') {
          setContentError(ERROR_MESSAGES[result.error]);
        } else {
          setError(
            ERROR_MESSAGES[result.error] || result.error || 'Unbekannter Fehler'
          );
        }
        return;
      }

      const toLink = selectedJobIds.filter(
        (id) => !originalJobIds.includes(id)
      );
      const toUnlink = originalJobIds.filter(
        (id) => !selectedJobIds.includes(id)
      );

      let failedAssignmentCount = 0;
      if (toLink.length > 0 || toUnlink.length > 0) {
        const settled = await Promise.allSettled([
          ...toLink.map((jobId) =>
            updateJob(jobId, { projectId: project.id })
          ),
          ...toUnlink.map((jobId) =>
            updateJob(jobId, { projectId: '' })
          ),
        ]);
        failedAssignmentCount = settled.filter(
          (entry) => entry.status === 'rejected' || !entry.value.success
        ).length;
      }

      onOpenChange(false);
      // A partially failed assignment sync must stay visible (no-silent-failure
      // rule); the project itself is already saved at this point.
      showBanner(
        failedAssignmentCount > 0
          ? {
              variant: 'error',
              message:
                failedAssignmentCount === 1
                  ? 'Projekt gespeichert, aber eine Auftragszuordnung konnte nicht aktualisiert werden. Bitte prüfe die Auftragsliste.'
                  : `Projekt gespeichert, aber ${failedAssignmentCount} Auftragszuordnungen konnten nicht aktualisiert werden. Bitte prüfe die Auftragsliste.`,
            }
          : { variant: 'success', message: 'Projekt gespeichert.' }
      );
      if (onSuccess) {
        await onSuccess({
          project: result.success ? result.project : project,
          selectedJobIds,
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

  const showContentError = hasAttemptedSubmit && contentError;
  const formDisabled = isLoading || isLoadingJobs;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[500px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Projekt bearbeiten</DialogTitle>
          <DialogDescription>Ändere die Daten des Projekts.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-2">
            <Field label="Titel" htmlFor="edit-project-name">
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

            <Field label="Projektnummer" htmlFor="edit-project-number">
              <Input
                placeholder="z.B. P-2026-001"
                value={projectNumber}
                onChange={(e) => setProjectNumber(e.target.value)}
                disabled={formDisabled}
              />
            </Field>

            <Field
              label="Beschreibung"
              htmlFor="edit-project-description"
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

            <Field label="Kunde" htmlFor="edit-project-client">
              <ClientSelectWithCreate
                clients={clients}
                value={clientId}
                onValueChange={handleClientChange}
                disabled={formDisabled}
              />
            </Field>

            <SiteContactFields
              clientId={clientId}
              siteId={siteId}
              contactId={contactId}
              onSiteChange={(nextSiteId) => setSiteId(nextSiteId)}
              onContactChange={setContactId}
              disabled={formDisabled}
              idPrefix="edit-project"
            />

            <Separator />
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Planung
            </p>

            <Field label="Geplanter Beginn" htmlFor="edit-project-start-date">
              <DatePicker
                value={plannedStartDate}
                onChange={setPlannedStartDate}
                placeholder="Startdatum wählen"
                disabled={formDisabled}
              />
            </Field>

            <Field label="Geplantes Ende" htmlFor="edit-project-end-date">
              <DatePicker
                value={plannedEndDate}
                onChange={setPlannedEndDate}
                placeholder="Enddatum wählen"
                disabled={formDisabled}
              />
            </Field>

            <Field
              label="Zugewiesene Aufträge"
              htmlFor="edit-project-jobs"
              description={isLoadingJobs ? 'Aufträge werden geladen...' : undefined}
            >
              <JobMultiSelect
                jobs={availableJobs}
                selectedIds={selectedJobIds}
                onSelectionChange={setSelectedJobIds}
                disabled={formDisabled || isLoadingJobs}
              />
            </Field>

            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter className="pt-4">
            <Button
              type="submit"
              disabled={formDisabled}
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
