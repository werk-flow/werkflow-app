'use client';

import { Fragment, useMemo, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import {
  Briefcase,
  Building2,
  ChevronRight,
  ExternalLink,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  UserRound,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentEmployee,
  type OrganizationDocument,
} from '@/lib/documents/types';
import {
  getJobDisplayTitle,
  getProjectDisplayTitle,
  type Job,
  type ProjectWithDetails,
  type Client,
} from '@/lib/jobs/types';
import { cn } from '@/lib/utils';
import {
  DocumentActionsMenu,
  DocumentContextMenuContent,
} from './document-row-actions';

type DocumentActionHandlers = {
  onOpen: () => void;
  onDetails: () => void;
  onRename: () => void;
  onLink: () => void;
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onPermanentDelete: () => void;
};

type DocumentWorkContextViewProps = {
  documents: OrganizationDocument[];
  jobs: Job[];
  projects: ProjectWithDetails[];
  clients: Client[];
  employees: DocumentEmployee[];
  isPending: boolean;
  onOpenDocument: (document: OrganizationDocument) => void;
  onDetailsDocument: (document: OrganizationDocument) => void;
  onRenameDocument: (document: OrganizationDocument) => void;
  onLinkDocument: (document: OrganizationDocument) => void;
  onMoveDocument: (document: OrganizationDocument) => void;
  onCopyDocument: (document: OrganizationDocument) => void;
  onDeleteDocument: (document: OrganizationDocument) => void;
};

type JobDocumentGroup = {
  job: Job;
  documents: OrganizationDocument[];
};

type ProjectDocumentGroup = {
  project: ProjectWithDetails;
  directDocuments: OrganizationDocument[];
  childJobGroups: JobDocumentGroup[];
  totalDocumentCount: number;
};

type SimpleDocumentGroup = {
  id: string;
  title: string;
  typeLabel: 'Kunde' | 'Mitarbeiter';
  href: string | null;
  documents: OrganizationDocument[];
};

type WorkContextGroups = {
  projectGroups: ProjectDocumentGroup[];
  standaloneJobGroups: JobDocumentGroup[];
  clientGroups: SimpleDocumentGroup[];
  employeeGroups: SimpleDocumentGroup[];
};

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date));
}

function getLatestUpdatedAt(documents: OrganizationDocument[]): string | null {
  if (documents.length === 0) return null;

  return documents
    .map((document) => document.updatedAt)
    .sort((firstDate, secondDate) => secondDate.localeCompare(firstDate))[0];
}

function renderFileIcon(document: OrganizationDocument) {
  const mimeType = document.mimeType ?? '';
  const fileName = document.displayName.toLowerCase();
  const className = 'size-4 shrink-0 text-muted-foreground';

  if (mimeType.startsWith('image/')) return <FileImage className={className} />;
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
    return <FileText className={className} />;
  }
  if (mimeType.includes('spreadsheet') || fileName.endsWith('.xlsx') || fileName.endsWith('.csv')) {
    return <FileSpreadsheet className={className} />;
  }
  if (mimeType.includes('zip') || fileName.endsWith('.zip') || fileName.endsWith('.rar')) {
    return <FileArchive className={className} />;
  }
  if (mimeType.includes('word') || fileName.endsWith('.doc') || fileName.endsWith('.docx')) {
    return <FileType className={className} />;
  }
  return <File className={className} />;
}

function addDocument(
  map: Map<string, OrganizationDocument[]>,
  targetId: string,
  document: OrganizationDocument
): void {
  const documents = map.get(targetId) ?? [];
  if (!documents.some((existingDocument) => existingDocument.id === document.id)) {
    documents.push(document);
  }
  map.set(targetId, documents);
}

function buildWorkContextGroups({
  documents,
  jobs,
  projects,
  clients,
  employees,
}: {
  documents: OrganizationDocument[];
  jobs: Job[];
  projects: ProjectWithDetails[];
  clients: Client[];
  employees: DocumentEmployee[];
}): WorkContextGroups {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const employeesById = new Map(employees.map((employee) => [employee.userId, employee]));
  const documentsByJobId = new Map<string, OrganizationDocument[]>();
  const documentsByProjectId = new Map<string, OrganizationDocument[]>();
  const documentsByClientId = new Map<string, OrganizationDocument[]>();
  const documentsByEmployeeId = new Map<string, OrganizationDocument[]>();

  for (const document of documents) {
    for (const link of document.links) {
      if (link.jobId && jobsById.has(link.jobId)) {
        addDocument(documentsByJobId, link.jobId, document);
      }
      if (link.projectId && projectsById.has(link.projectId)) {
        addDocument(documentsByProjectId, link.projectId, document);
      }
      if (link.clientId && clientsById.has(link.clientId)) {
        addDocument(documentsByClientId, link.clientId, document);
      }
      if (link.employeeId && employeesById.has(link.employeeId)) {
        addDocument(documentsByEmployeeId, link.employeeId, document);
      }
    }
  }

  const jobsByProjectId = new Map<string, Job[]>();
  for (const job of jobs) {
    if (!job.projectId || !projectsById.has(job.projectId)) continue;

    const projectJobs = jobsByProjectId.get(job.projectId) ?? [];
    projectJobs.push(job);
    jobsByProjectId.set(job.projectId, projectJobs);
  }

  const projectGroups = projects
    .map((project): ProjectDocumentGroup => {
      const directDocuments = documentsByProjectId.get(project.id) ?? [];
      const childJobGroups = (jobsByProjectId.get(project.id) ?? [])
        .map((job) => ({
          job,
          documents: documentsByJobId.get(job.id) ?? [],
        }))
        .filter((group) => group.documents.length > 0);

      return {
        project,
        directDocuments,
        childJobGroups,
        totalDocumentCount:
          directDocuments.length +
          childJobGroups.reduce((total, group) => total + group.documents.length, 0),
      };
    })
    .filter((group) => group.totalDocumentCount > 0);

  const standaloneJobGroups = jobs
    .filter((job) => !job.projectId || !projectsById.has(job.projectId))
    .map((job) => ({
      job,
      documents: documentsByJobId.get(job.id) ?? [],
    }))
    .filter((group) => group.documents.length > 0);

  const clientGroups = clients
    .map((client): SimpleDocumentGroup => ({
      id: client.id,
      title: client.name,
      typeLabel: 'Kunde',
      href: `/kunden/${encodeURIComponent(client.id)}`,
      documents: documentsByClientId.get(client.id) ?? [],
    }))
    .filter((group) => group.documents.length > 0);

  const employeeGroups = employees
    .map((employee): SimpleDocumentGroup => {
      const title =
        [employee.firstName, employee.lastName].filter(Boolean).join(' ') ||
        employee.email ||
        'Mitarbeiter';

      return {
        id: employee.userId,
        title,
        typeLabel: 'Mitarbeiter',
        href: `/mitarbeiter/${encodeURIComponent(employee.userId)}`,
        documents: documentsByEmployeeId.get(employee.userId) ?? [],
      };
    })
    .filter((group) => group.documents.length > 0);

  return { projectGroups, standaloneJobGroups, clientGroups, employeeGroups };
}

function getProjectHref(project: ProjectWithDetails): string | null {
  if (!project.projectNumber) return null;
  return `/auftraege/projekt/${encodeURIComponent(project.projectNumber)}`;
}

function getJobHref({
  job,
  project,
}: {
  job: Job;
  project?: ProjectWithDetails | null;
}): string | null {
  if (!job.jobNumber) return null;

  if (project?.projectNumber) {
    return `/auftraege/projekt/${encodeURIComponent(project.projectNumber)}/${encodeURIComponent(job.jobNumber)}`;
  }

  return `/auftraege/${encodeURIComponent(job.jobNumber)}`;
}

function getDocumentHandlers({
  document,
  onOpenDocument,
  onDetailsDocument,
  onRenameDocument,
  onLinkDocument,
  onMoveDocument,
  onCopyDocument,
  onDeleteDocument,
}: Pick<
  DocumentWorkContextViewProps,
  | 'onOpenDocument'
  | 'onDetailsDocument'
  | 'onRenameDocument'
  | 'onLinkDocument'
  | 'onMoveDocument'
  | 'onCopyDocument'
  | 'onDeleteDocument'
> & {
  document: OrganizationDocument;
}): DocumentActionHandlers {
  return {
    onOpen: () => onOpenDocument(document),
    onDetails: () => onDetailsDocument(document),
    onRename: () => onRenameDocument(document),
    onLink: () => onLinkDocument(document),
    onMove: () => onMoveDocument(document),
    onCopy: () => onCopyDocument(document),
    onDelete: () => onDeleteDocument(document),
    onRestore: () => undefined,
    onPermanentDelete: () => undefined,
  };
}

function OpenContextLink({
  href,
  label,
}: {
  href: string | null;
  label: string;
}) {
  if (!href) return null;

  return (
    <Button asChild size="sm" variant="ghost" className="h-7 px-2">
      <Link href={href} onClick={(event) => event.stopPropagation()}>
        <ExternalLink className="size-3.5" />
        {label}
      </Link>
    </Button>
  );
}

function DocumentSummary({
  count,
  latestUpdatedAt,
}: {
  count: number;
  latestUpdatedAt: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <Badge variant="secondary">
        {count} {count === 1 ? 'Datei' : 'Dateien'}
      </Badge>
      {latestUpdatedAt && <span>Zuletzt aktualisiert am {formatDate(latestUpdatedAt)}</span>}
    </div>
  );
}

function DocumentInlineRow({
  document,
  indent = 'none',
  isPending,
  handlers,
}: {
  document: OrganizationDocument;
  indent?: 'none' | 'project' | 'job';
  isPending: boolean;
  handlers: DocumentActionHandlers;
}) {
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <TableRow
          className="cursor-pointer bg-background transition-colors hover:bg-accent/50"
          onClick={() => handlers.onOpen()}
        >
          <TableCell className="w-[44px]" />
          <TableCell
            className={cn(
              'font-medium',
              indent === 'project' && 'pl-10',
              indent === 'job' && 'pl-16'
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              {renderFileIcon(document)}
              <div className="min-w-0">
                <p className="truncate text-sm">{document.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {DOCUMENT_CATEGORY_LABELS[document.category]} · {formatFileSize(document.sizeBytes)}
                </p>
              </div>
            </div>
          </TableCell>
          <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
            Datei
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">
            {formatDate(document.updatedAt)}
          </TableCell>
          <TableCell className="w-[52px]" onClick={(event) => event.stopPropagation()}>
            <DocumentActionsMenu
              document={document}
              isTrashView={false}
              disabled={isPending}
              handlers={handlers}
            />
          </TableCell>
        </TableRow>
      </ContextMenuTrigger>
      <DocumentContextMenuContent
        document={document}
        isTrashView={false}
        handlers={handlers}
      />
    </ContextMenu>
  );
}

function MobileDocumentCard({
  document,
  isPending,
  handlers,
}: {
  document: OrganizationDocument;
  isPending: boolean;
  handlers: DocumentActionHandlers;
}) {
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <div
          className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/50"
          onClick={() => handlers.onOpen()}
        >
          <div className="flex min-w-0 items-center gap-2">
            {renderFileIcon(document)}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{document.displayName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {DOCUMENT_CATEGORY_LABELS[document.category]} · {formatFileSize(document.sizeBytes)} ·{' '}
                {formatDate(document.updatedAt)}
              </p>
            </div>
          </div>
          <div onClick={(event) => event.stopPropagation()}>
            <DocumentActionsMenu
              document={document}
              isTrashView={false}
              disabled={isPending}
              handlers={handlers}
            />
          </div>
        </div>
      </ContextMenuTrigger>
      <DocumentContextMenuContent
        document={document}
        isTrashView={false}
        handlers={handlers}
      />
    </ContextMenu>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border bg-card px-6 py-14 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
        <Briefcase className="size-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-base font-semibold">
        Noch keine Verknüpfungen mit Dateien
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
        Sobald Dateien mit Aufträgen, Projekten, Kunden oder Mitarbeitern verknüpft
        werden, erscheinen sie in dieser Übersicht.
      </p>
    </div>
  );
}

export function DocumentWorkContextView({
  documents,
  jobs,
  projects,
  clients,
  employees,
  isPending,
  onOpenDocument,
  onDetailsDocument,
  onRenameDocument,
  onLinkDocument,
  onMoveDocument,
  onCopyDocument,
  onDeleteDocument,
}: DocumentWorkContextViewProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );
  const { projectGroups, standaloneJobGroups, clientGroups, employeeGroups } = useMemo(
    () => buildWorkContextGroups({ documents, jobs, projects, clients, employees }),
    [clients, documents, employees, jobs, projects]
  );

  const hasGroups =
    projectGroups.length > 0 ||
    standaloneJobGroups.length > 0 ||
    clientGroups.length > 0 ||
    employeeGroups.length > 0;

  function toggleExpanded(id: string, event?: MouseEvent<HTMLButtonElement>): void {
    event?.stopPropagation();
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function getHandlers(document: OrganizationDocument): DocumentActionHandlers {
    return getDocumentHandlers({
      document,
      onOpenDocument,
      onDetailsDocument,
      onRenameDocument,
      onLinkDocument,
      onMoveDocument,
      onCopyDocument,
      onDeleteDocument,
    });
  }

  if (!hasGroups) return <EmptyState />;

  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[44px]" />
              <TableHead>Verknüpfung</TableHead>
              <TableHead className="hidden lg:table-cell">Typ</TableHead>
              <TableHead>Dokumente</TableHead>
              <TableHead className="w-[52px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {projectGroups.map((group) => {
              const rowId = `project:${group.project.id}`;
              const isExpanded = expandedIds.has(rowId);
              const latestUpdatedAt = getLatestUpdatedAt([
                ...group.directDocuments,
                ...group.childJobGroups.flatMap((jobGroup) => jobGroup.documents),
              ]);
              const projectHref = getProjectHref(group.project);

              return (
                <Fragment key={rowId}>
                  <TableRow
                    className="cursor-pointer bg-muted/30 transition-colors hover:bg-accent/50"
                    onClick={() => toggleExpanded(rowId)}
                  >
                    <TableCell className="w-[44px] pr-0">
                      <button
                        type="button"
                        onClick={(event) => toggleExpanded(rowId, event)}
                        className="flex size-6 items-center justify-center rounded-sm hover:bg-accent"
                        aria-label={isExpanded ? 'Projekt zuklappen' : 'Projekt aufklappen'}
                      >
                        <ChevronRight
                          className={cn(
                            'size-4 text-muted-foreground transition-transform duration-200',
                            isExpanded && 'rotate-90'
                          )}
                        />
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {group.project.projectNumber && (
                              <span className="font-mono text-xs text-muted-foreground">
                                {group.project.projectNumber}
                              </span>
                            )}
                            <span className="truncate font-medium">
                              {getProjectDisplayTitle(group.project)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {group.childJobGroups.length}{' '}
                            {group.childJobGroups.length === 1 ? 'Auftrag' : 'Aufträge'} mit Dateien
                          </p>
                        </div>
                        <OpenContextLink href={projectHref} label="Zum Projekt" />
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      Projekt
                    </TableCell>
                    <TableCell>
                      <DocumentSummary
                        count={group.totalDocumentCount}
                        latestUpdatedAt={latestUpdatedAt}
                      />
                    </TableCell>
                    <TableCell />
                  </TableRow>

                  {isExpanded &&
                    group.directDocuments.map((document) => (
                      <DocumentInlineRow
                        key={`project:${group.project.id}:document:${document.id}`}
                        document={document}
                        indent="project"
                        isPending={isPending}
                        handlers={getHandlers(document)}
                      />
                    ))}

                  {isExpanded &&
                    group.childJobGroups.map((jobGroup) => {
                      const jobHref = getJobHref({
                        job: jobGroup.job,
                        project: group.project,
                      });

                      return (
                        <Fragment key={`project:${group.project.id}:job:${jobGroup.job.id}`}>
                          <TableRow
                            className="bg-muted/10"
                          >
                            <TableCell className="w-[44px]" />
                            <TableCell className="pl-10">
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    {jobGroup.job.jobNumber && (
                                      <span className="font-mono text-xs text-muted-foreground">
                                        {jobGroup.job.jobNumber}
                                      </span>
                                    )}
                                    <span className="truncate text-sm font-medium">
                                      {getJobDisplayTitle(jobGroup.job)}
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {jobGroup.documents.length}{' '}
                                    {jobGroup.documents.length === 1 ? 'Datei' : 'Dateien'}
                                  </p>
                                </div>
                                <OpenContextLink href={jobHref} label="Zum Auftrag" />
                              </div>
                            </TableCell>
                            <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                              Auftrag
                            </TableCell>
                            <TableCell>
                              <DocumentSummary
                                count={jobGroup.documents.length}
                                latestUpdatedAt={getLatestUpdatedAt(jobGroup.documents)}
                              />
                            </TableCell>
                            <TableCell />
                          </TableRow>
                          {jobGroup.documents.map((document) => (
                            <DocumentInlineRow
                              key={`job:${jobGroup.job.id}:document:${document.id}`}
                              document={document}
                              indent="job"
                              isPending={isPending}
                              handlers={getHandlers(document)}
                            />
                          ))}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}

            {standaloneJobGroups.map((group) => {
              const rowId = `job:${group.job.id}`;
              const isExpanded = expandedIds.has(rowId);
              const project = group.job.projectId ? projectById.get(group.job.projectId) : null;
              const jobHref = getJobHref({ job: group.job, project });

              return (
                <Fragment key={rowId}>
                  <TableRow
                    className="cursor-pointer transition-colors hover:bg-accent/50"
                    onClick={() => toggleExpanded(rowId)}
                  >
                    <TableCell className="w-[44px] pr-0">
                      <button
                        type="button"
                        onClick={(event) => toggleExpanded(rowId, event)}
                        className="flex size-6 items-center justify-center rounded-sm hover:bg-accent"
                        aria-label={isExpanded ? 'Auftrag zuklappen' : 'Auftrag aufklappen'}
                      >
                        <ChevronRight
                          className={cn(
                            'size-4 text-muted-foreground transition-transform duration-200',
                            isExpanded && 'rotate-90'
                          )}
                        />
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {group.job.jobNumber && (
                              <span className="font-mono text-xs text-muted-foreground">
                                {group.job.jobNumber}
                              </span>
                            )}
                            <span className="truncate font-medium">
                              {getJobDisplayTitle(group.job)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">Einzelauftrag</p>
                        </div>
                        <OpenContextLink href={jobHref} label="Zum Auftrag" />
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      Auftrag
                    </TableCell>
                    <TableCell>
                      <DocumentSummary
                        count={group.documents.length}
                        latestUpdatedAt={getLatestUpdatedAt(group.documents)}
                      />
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  {isExpanded &&
                    group.documents.map((document) => (
                      <DocumentInlineRow
                        key={`standalone-job:${group.job.id}:document:${document.id}`}
                        document={document}
                        indent="project"
                        isPending={isPending}
                        handlers={getHandlers(document)}
                      />
                    ))}
                </Fragment>
              );
            })}

            {[...clientGroups, ...employeeGroups].map((group) => {
              const rowId = `${group.typeLabel}:${group.id}`;
              const isExpanded = expandedIds.has(rowId);
              const Icon = group.typeLabel === 'Kunde' ? Building2 : UserRound;

              return (
                <Fragment key={rowId}>
                  <TableRow
                    className="cursor-pointer transition-colors hover:bg-accent/50"
                    onClick={() => toggleExpanded(rowId)}
                  >
                    <TableCell className="w-[44px] pr-0">
                      <button
                        type="button"
                        onClick={(event) => toggleExpanded(rowId, event)}
                        className="flex size-6 items-center justify-center rounded-sm hover:bg-accent"
                        aria-label={`${group.typeLabel} ${isExpanded ? 'zuklappen' : 'aufklappen'}`}
                      >
                        <ChevronRight
                          className={cn(
                            'size-4 text-muted-foreground transition-transform duration-200',
                            isExpanded && 'rotate-90'
                          )}
                        />
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <span className="truncate font-medium">{group.title}</span>
                          <p className="text-xs text-muted-foreground">
                            {group.documents.length}{' '}
                            {group.documents.length === 1 ? 'Datei' : 'Dateien'}
                          </p>
                        </div>
                        <OpenContextLink href={group.href} label="Öffnen" />
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {group.typeLabel}
                    </TableCell>
                    <TableCell>
                      <DocumentSummary
                        count={group.documents.length}
                        latestUpdatedAt={getLatestUpdatedAt(group.documents)}
                      />
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  {isExpanded &&
                    group.documents.map((document) => (
                      <DocumentInlineRow
                        key={`${rowId}:document:${document.id}`}
                        document={document}
                        indent="project"
                        isPending={isPending}
                        handlers={getHandlers(document)}
                      />
                    ))}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 md:hidden">
        {projectGroups.map((group) => {
          const rowId = `project:${group.project.id}`;
          const isExpanded = expandedIds.has(rowId);
          const projectHref = getProjectHref(group.project);

          return (
            <div key={rowId} className="space-y-2">
              <div
                className="flex cursor-pointer items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 transition-colors hover:bg-accent/50"
                onClick={() => toggleExpanded(rowId)}
              >
                <button
                  type="button"
                  onClick={(event) => toggleExpanded(rowId, event)}
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
                  aria-label={isExpanded ? 'Projekt zuklappen' : 'Projekt aufklappen'}
                >
                  <ChevronRight
                    className={cn(
                      'size-3.5 text-muted-foreground transition-transform duration-200',
                      isExpanded && 'rotate-90'
                    )}
                  />
                </button>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    {group.project.projectNumber && (
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {group.project.projectNumber}
                      </span>
                    )}
                    <p className="truncate text-sm font-medium">
                      {getProjectDisplayTitle(group.project)}
                    </p>
                  </div>
                  <DocumentSummary
                    count={group.totalDocumentCount}
                    latestUpdatedAt={getLatestUpdatedAt([
                      ...group.directDocuments,
                      ...group.childJobGroups.flatMap((jobGroup) => jobGroup.documents),
                    ])}
                  />
                </div>
                <OpenContextLink href={projectHref} label="Öffnen" />
              </div>

              {isExpanded && (
                <div className="ml-6 space-y-2">
                  {group.directDocuments.map((document) => (
                    <MobileDocumentCard
                      key={`mobile-project:${group.project.id}:document:${document.id}`}
                      document={document}
                      isPending={isPending}
                      handlers={getHandlers(document)}
                    />
                  ))}
                  {group.childJobGroups.map((jobGroup) => {
                    const jobHref = getJobHref({
                      job: jobGroup.job,
                      project: group.project,
                    });

                    return (
                      <div key={`mobile-job:${jobGroup.job.id}`} className="space-y-2">
                        <div className="rounded-lg border bg-muted/10 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                {jobGroup.job.jobNumber && (
                                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                    {jobGroup.job.jobNumber}
                                  </span>
                                )}
                                <p className="truncate text-sm font-medium">
                                  {getJobDisplayTitle(jobGroup.job)}
                                </p>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {jobGroup.documents.length}{' '}
                                {jobGroup.documents.length === 1 ? 'Datei' : 'Dateien'}
                              </p>
                            </div>
                            <OpenContextLink href={jobHref} label="Öffnen" />
                          </div>
                        </div>
                        {jobGroup.documents.map((document) => (
                          <MobileDocumentCard
                            key={`mobile-job:${jobGroup.job.id}:document:${document.id}`}
                            document={document}
                            isPending={isPending}
                            handlers={getHandlers(document)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {standaloneJobGroups.map((group) => {
          const rowId = `job:${group.job.id}`;
          const isExpanded = expandedIds.has(rowId);
          const project = group.job.projectId ? projectById.get(group.job.projectId) : null;
          const jobHref = getJobHref({ job: group.job, project });

          return (
            <div key={rowId} className="space-y-2">
              <div
                className="flex cursor-pointer items-start gap-2 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/50"
                onClick={() => toggleExpanded(rowId)}
              >
                <button
                  type="button"
                  onClick={(event) => toggleExpanded(rowId, event)}
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
                  aria-label={isExpanded ? 'Auftrag zuklappen' : 'Auftrag aufklappen'}
                >
                  <ChevronRight
                    className={cn(
                      'size-3.5 text-muted-foreground transition-transform duration-200',
                      isExpanded && 'rotate-90'
                    )}
                  />
                </button>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    {group.job.jobNumber && (
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {group.job.jobNumber}
                      </span>
                    )}
                    <p className="truncate text-sm font-medium">
                      {getJobDisplayTitle(group.job)}
                    </p>
                  </div>
                  <DocumentSummary
                    count={group.documents.length}
                    latestUpdatedAt={getLatestUpdatedAt(group.documents)}
                  />
                </div>
                <OpenContextLink href={jobHref} label="Öffnen" />
              </div>

              {isExpanded && (
                <div className="ml-6 space-y-2">
                  {group.documents.map((document) => (
                    <MobileDocumentCard
                      key={`mobile-standalone-job:${group.job.id}:document:${document.id}`}
                      document={document}
                      isPending={isPending}
                      handlers={getHandlers(document)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {[...clientGroups, ...employeeGroups].map((group) => {
          const rowId = `${group.typeLabel}:${group.id}`;
          const isExpanded = expandedIds.has(rowId);
          const Icon = group.typeLabel === 'Kunde' ? Building2 : UserRound;

          return (
            <div key={rowId} className="space-y-2">
              <div
                className="flex cursor-pointer items-start gap-2 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/50"
                onClick={() => toggleExpanded(rowId)}
              >
                <button
                  type="button"
                  onClick={(event) => toggleExpanded(rowId, event)}
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
                  aria-label={`${group.typeLabel} ${isExpanded ? 'zuklappen' : 'aufklappen'}`}
                >
                  <ChevronRight
                    className={cn(
                      'size-3.5 text-muted-foreground transition-transform duration-200',
                      isExpanded && 'rotate-90'
                    )}
                  />
                </button>
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate text-sm font-medium">{group.title}</p>
                  <DocumentSummary
                    count={group.documents.length}
                    latestUpdatedAt={getLatestUpdatedAt(group.documents)}
                  />
                </div>
                <OpenContextLink href={group.href} label="Öffnen" />
              </div>

              {isExpanded && (
                <div className="ml-6 space-y-2">
                  {group.documents.map((document) => (
                    <MobileDocumentCard
                      key={`mobile-${rowId}:document:${document.id}`}
                      document={document}
                      isPending={isPending}
                      handlers={getHandlers(document)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
