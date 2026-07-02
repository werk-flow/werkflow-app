'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  BriefcaseBusiness,
  Check,
  FolderKanban,
  LinkIcon,
  Search,
  UserRound,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  getDocumentLinkCatalog,
  updateDocumentLinks,
} from '@/lib/documents/actions';
import type { DocumentEmployee, OrganizationDocument } from '@/lib/documents/types';
import type { Client, Job, ProjectWithDetails } from '@/lib/jobs/types';
import { cn } from '@/lib/utils';

type LinkTargetType = 'job' | 'project' | 'client' | 'employee';
type LinkTarget = Job | ProjectWithDetails | Client | DocumentEmployee;

type DocumentLinkDialogProps = {
  document: OrganizationDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs?: Job[];
  projects?: ProjectWithDetails[];
  clients?: Client[];
  employees?: DocumentEmployee[];
  onComplete: (variant: 'success' | 'error', message: string) => void;
};

function getJobLabel(job: Job): string {
  return job.jobNumber ? `${job.jobNumber} · ${job.title}` : job.title;
}

function getProjectLabel(project: ProjectWithDetails): string {
  return project.projectNumber
    ? `${project.projectNumber} · ${project.name}`
    : project.name;
}

function getClientLabel(client: Client): string {
  return client.name;
}

function getEmployeeLabel(employee: DocumentEmployee): string {
  const name = [employee.firstName, employee.lastName].filter(Boolean).join(' ');
  return name || employee.email || 'Mitarbeiter';
}

function getTargetId(target: LinkTarget, targetType: LinkTargetType): string {
  return targetType === 'employee'
    ? (target as DocumentEmployee).userId
    : (target as Job | ProjectWithDetails | Client).id;
}

function getLinkedJobIds(document: OrganizationDocument | null): Set<string> {
  return new Set(
    document?.links
      .map((link) => link.jobId)
      .filter((jobId): jobId is string => Boolean(jobId)) ?? []
  );
}

function getLinkedProjectIds(document: OrganizationDocument | null): Set<string> {
  return new Set(
    document?.links
      .map((link) => link.projectId)
      .filter((projectId): projectId is string => Boolean(projectId)) ?? []
  );
}

function getLinkedClientIds(document: OrganizationDocument | null): Set<string> {
  return new Set(
    document?.links
      .map((link) => link.clientId)
      .filter((clientId): clientId is string => Boolean(clientId)) ?? []
  );
}

function getLinkedEmployeeIds(document: OrganizationDocument | null): Set<string> {
  return new Set(
    document?.links
      .map((link) => link.employeeId)
      .filter((employeeId): employeeId is string => Boolean(employeeId)) ?? []
  );
}

function getUpdateMessage(result: {
  success: boolean;
  addedCount?: number;
  removedCount?: number;
  failedCount?: number;
  error?: string;
}): { variant: 'success' | 'error'; message: string } {
  const addedCount = result.addedCount ?? 0;
  const removedCount = result.removedCount ?? 0;
  const failedCount = result.failedCount ?? 0;

  if (result.success) {
    if (addedCount === 0 && removedCount === 0) {
      return { variant: 'success', message: 'Keine Änderungen vorgenommen.' };
    }
    if (addedCount > 0 && removedCount > 0) {
      return {
        variant: 'success',
        message: `${addedCount} Verknüpfung(en) hinzugefügt, ${removedCount} entfernt.`,
      };
    }
    if (addedCount > 0) {
      return {
        variant: 'success',
        message:
          addedCount === 1
            ? 'Verknüpfung wurde hinzugefügt.'
            : `${addedCount} Verknüpfungen wurden hinzugefügt.`,
      };
    }
    return {
      variant: 'success',
      message:
        removedCount === 1
          ? 'Verknüpfung wurde entfernt.'
          : `${removedCount} Verknüpfungen wurden entfernt.`,
    };
  }

  if (failedCount > 0 && (addedCount > 0 || removedCount > 0)) {
    return {
      variant: 'error',
      message: `${addedCount + removedCount} Änderung(en) gespeichert, ${failedCount} fehlgeschlagen.`,
    };
  }

  return { variant: 'error', message: 'Die Verknüpfungen konnten nicht aktualisiert werden.' };
}

export function DocumentLinkDialog({
  document,
  open,
  onOpenChange,
  jobs: jobsProp,
  projects: projectsProp,
  clients: clientsProp,
  employees: employeesProp,
  onComplete,
}: DocumentLinkDialogProps) {
  const [isSaving, startSaveTransition] = useTransition();
  const [isCatalogPending, startCatalogTransition] = useTransition();
  const [targetType, setTargetType] = useState<LinkTargetType>('job');
  const [searchQuery, setSearchQuery] = useState('');
  const [fetchedCatalog, setFetchedCatalog] = useState<{
    jobs: Job[];
    projects: ProjectWithDetails[];
    clients: Client[];
    employees: DocumentEmployee[];
  } | null>(null);
  const jobs = useMemo(
    () => jobsProp ?? fetchedCatalog?.jobs ?? [],
    [fetchedCatalog?.jobs, jobsProp]
  );
  const projects = useMemo(
    () => projectsProp ?? fetchedCatalog?.projects ?? [],
    [fetchedCatalog?.projects, projectsProp]
  );
  const clients = useMemo(
    () => clientsProp ?? fetchedCatalog?.clients ?? [],
    [clientsProp, fetchedCatalog?.clients]
  );
  const employees = useMemo(
    () => employeesProp ?? fetchedCatalog?.employees ?? [],
    [employeesProp, fetchedCatalog?.employees]
  );
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(
    () => getLinkedJobIds(document)
  );
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(
    () => getLinkedProjectIds(document)
  );
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(
    () => getLinkedClientIds(document)
  );
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(
    () => getLinkedEmployeeIds(document)
  );

  const initialLinkedJobIds = useMemo(() => getLinkedJobIds(document), [document]);
  const initialLinkedProjectIds = useMemo(
    () => getLinkedProjectIds(document),
    [document]
  );
  const initialLinkedClientIds = useMemo(
    () => getLinkedClientIds(document),
    [document]
  );
  const initialLinkedEmployeeIds = useMemo(
    () => getLinkedEmployeeIds(document),
    [document]
  );

  const needsCatalogFetch =
    open &&
    !!document &&
    (jobsProp?.length ?? 0) === 0 &&
    (projectsProp?.length ?? 0) === 0 &&
    (clientsProp?.length ?? 0) === 0 &&
    (employeesProp?.length ?? 0) === 0 &&
    fetchedCatalog === null;

  useEffect(() => {
    if (!needsCatalogFetch) return;

    let cancelled = false;

    startCatalogTransition(async () => {
      const result = await getDocumentLinkCatalog();
      if (cancelled) return;

      if (result.success) {
        setFetchedCatalog({
          jobs: result.jobs,
          projects: result.projects,
          clients: result.clients,
          employees: result.employees,
        });
      } else {
        onComplete(
          'error',
          'Aufträge, Projekte, Kunden und Mitarbeiter konnten nicht geladen werden.'
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [needsCatalogFetch, onComplete]);

  const isLoadingCatalog = needsCatalogFetch && isCatalogPending;

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase('de-DE');

  const filteredJobs = useMemo(
    () =>
      jobs.filter((job) =>
        getJobLabel(job).toLocaleLowerCase('de-DE').includes(normalizedSearchQuery)
      ),
    [jobs, normalizedSearchQuery]
  );
  const filteredProjects = useMemo(
    () =>
      projects.filter((project) =>
        getProjectLabel(project).toLocaleLowerCase('de-DE').includes(normalizedSearchQuery)
      ),
    [normalizedSearchQuery, projects]
  );
  const filteredClients = useMemo(
    () =>
      clients.filter((client) =>
        getClientLabel(client).toLocaleLowerCase('de-DE').includes(normalizedSearchQuery)
      ),
    [clients, normalizedSearchQuery]
  );
  const filteredEmployees = useMemo(
    () =>
      employees.filter((employee) =>
        getEmployeeLabel(employee)
          .toLocaleLowerCase('de-DE')
          .includes(normalizedSearchQuery)
      ),
    [employees, normalizedSearchQuery]
  );

  const visibleTargets: LinkTarget[] =
    targetType === 'job'
      ? filteredJobs
      : targetType === 'project'
        ? filteredProjects
        : targetType === 'client'
          ? filteredClients
          : filteredEmployees;

  const addJobIds = [...selectedJobIds].filter((jobId) => !initialLinkedJobIds.has(jobId));
  const addProjectIds = [...selectedProjectIds].filter(
    (projectId) => !initialLinkedProjectIds.has(projectId)
  );
  const addClientIds = [...selectedClientIds].filter(
    (clientId) => !initialLinkedClientIds.has(clientId)
  );
  const addEmployeeIds = [...selectedEmployeeIds].filter(
    (employeeId) => !initialLinkedEmployeeIds.has(employeeId)
  );
  const removeLinkIds =
    document?.links
      .filter((link) => {
        if (link.jobId) return !selectedJobIds.has(link.jobId);
        if (link.projectId) return !selectedProjectIds.has(link.projectId);
        if (link.clientId) return !selectedClientIds.has(link.clientId);
        if (link.employeeId) return !selectedEmployeeIds.has(link.employeeId);
        return false;
      })
      .map((link) => link.id) ?? [];

  const changeCount =
    addJobIds.length +
    addProjectIds.length +
    addClientIds.length +
    addEmployeeIds.length +
    removeLinkIds.length;
  const selectedCount =
    selectedJobIds.size +
    selectedProjectIds.size +
    selectedClientIds.size +
    selectedEmployeeIds.size;

  function handleTargetTypeChange(nextTargetType: LinkTargetType) {
    setTargetType(nextTargetType);
    setSearchQuery('');
  }

  function toggleJob(jobId: string) {
    setSelectedJobIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  function toggleProject(projectId: string) {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function toggleClient(clientId: string) {
    setSelectedClientIds((current) => {
      const next = new Set(current);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  function toggleEmployee(employeeId: string) {
    setSelectedEmployeeIds((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  function handleSave() {
    if (!document || changeCount === 0) return;

    startSaveTransition(async () => {
      const result = await updateDocumentLinks({
        documentId: document.id,
        addJobIds,
        addProjectIds,
        addClientIds,
        addEmployeeIds,
        removeLinkIds,
      });

      const feedback = getUpdateMessage(result);
      onComplete(feedback.variant, feedback.message);

      if (result.success || (result.addedCount ?? 0) + (result.removedCount ?? 0) > 0) {
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Verknüpfungen verwalten</DialogTitle>
          <DialogDescription>
            Wähle Aufträge, Projekte, Kunden und Mitarbeiter für „{document?.displayName}“.
            Abgewählte bestehende Verknüpfungen werden entfernt.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Button
              type="button"
              variant={targetType === 'job' ? 'secondary' : 'outline'}
              onClick={() => handleTargetTypeChange('job')}
            >
              <BriefcaseBusiness className="size-4" />
              Aufträge
              {selectedJobIds.size > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {selectedJobIds.size}
                </span>
              )}
            </Button>
            <Button
              type="button"
              variant={targetType === 'project' ? 'secondary' : 'outline'}
              onClick={() => handleTargetTypeChange('project')}
            >
              <FolderKanban className="size-4" />
              Projekte
              {selectedProjectIds.size > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {selectedProjectIds.size}
                </span>
              )}
            </Button>
            <Button
              type="button"
              variant={targetType === 'client' ? 'secondary' : 'outline'}
              onClick={() => handleTargetTypeChange('client')}
            >
              <Users className="size-4" />
              Kunden
              {selectedClientIds.size > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {selectedClientIds.size}
                </span>
              )}
            </Button>
            <Button
              type="button"
              variant={targetType === 'employee' ? 'secondary' : 'outline'}
              onClick={() => handleTargetTypeChange('employee')}
            >
              <UserRound className="size-4" />
              Mitarbeiter
              {selectedEmployeeIds.size > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {selectedEmployeeIds.size}
                </span>
              )}
            </Button>
          </div>

          <div className="flex items-center gap-2 rounded-md border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={
                targetType === 'job'
                  ? 'Auftrag suchen...'
                  : targetType === 'project'
                    ? 'Projekt suchen...'
                    : targetType === 'client'
                      ? 'Kunde suchen...'
                      : 'Mitarbeiter suchen...'
              }
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </div>

          <div className="max-h-80 overflow-auto rounded-md border">
            {isLoadingCatalog ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Einträge werden geladen...
              </div>
            ) : visibleTargets.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Keine passenden Einträge gefunden.
              </div>
            ) : (
              <div className="divide-y">
                {visibleTargets.map((target) => {
                  const isJob = targetType === 'job';
                  const isProject = targetType === 'project';
                  const isClient = targetType === 'client';
                  const targetId = getTargetId(target, targetType);
                  const isSelected = isJob
                    ? selectedJobIds.has(targetId)
                    : isProject
                      ? selectedProjectIds.has(targetId)
                      : isClient
                        ? selectedClientIds.has(targetId)
                        : selectedEmployeeIds.has(targetId);
                  const wasLinked = isJob
                    ? initialLinkedJobIds.has(targetId)
                    : isProject
                      ? initialLinkedProjectIds.has(targetId)
                      : isClient
                        ? initialLinkedClientIds.has(targetId)
                        : initialLinkedEmployeeIds.has(targetId);
                  const label = isJob
                    ? getJobLabel(target as Job)
                    : isProject
                      ? getProjectLabel(target as ProjectWithDetails)
                      : isClient
                        ? getClientLabel(target as Client)
                        : getEmployeeLabel(target as DocumentEmployee);

                  return (
                    <button
                      key={targetId}
                      type="button"
                      onClick={() => {
                        if (isJob) toggleJob(targetId);
                        else if (isProject) toggleProject(targetId);
                        else if (isClient) toggleClient(targetId);
                        else toggleEmployee(targetId);
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
                        isSelected && 'bg-accent'
                      )}
                    >
                      {isJob ? (
                        <BriefcaseBusiness className="size-4 shrink-0 text-muted-foreground" />
                      ) : isProject ? (
                        <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
                      ) : isClient ? (
                        <Users className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <UserRound className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {isSelected
                            ? wasLinked
                              ? 'Verknüpft'
                              : 'Neu ausgewählt'
                            : wasLinked
                              ? 'Wird entfernt'
                              : targetType === 'job'
                                ? 'Auftrag'
                                : targetType === 'project'
                                  ? 'Projekt'
                                  : targetType === 'client'
                                    ? 'Kunde'
                                    : 'Mitarbeiter'}
                        </span>
                      </span>
                      {isSelected && (
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <p className="mr-auto text-sm text-muted-foreground">
            {selectedCount} verknüpft
            {changeCount > 0 ? ` · ${changeCount} Änderung(en)` : ''}
          </p>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isLoadingCatalog || changeCount === 0}
          >
            <LinkIcon className="size-4" />
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
