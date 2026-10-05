'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { EmptyState } from '@/components/ui/empty-state';
import { useMemo, useState, type MouseEvent, type ReactElement } from 'react';
import { Briefcase, Building2, ChevronRight, UserRound } from 'lucide-react';

import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonRows, type SkeletonColumn } from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { DocumentEmployee, OrganizationDocument } from '@/lib/documents/types';
import type { Job, ProjectWithDetails, Client } from '@/lib/jobs/types';
import { cn } from '@/lib/utils';
import {
  buildWorkContextGroups,
  getLatestUpdatedAt,
  type SimpleDocumentGroup,
} from '@/lib/documents/work-context-groups';
import { WorkContextJobGroupCard, WorkContextJobGroupRows } from './document-work-context-job-group';
import {
  WorkContextProjectGroupCard,
  WorkContextProjectGroupRows,
} from './document-work-context-project-group';
import {
  DocumentInlineRow,
  DocumentSummary,
  MobileDocumentCard,
  OpenContextLink,
  type DocumentActionHandlers,
  type WorkContextGroupProps,
} from './document-work-context-row-parts';

type DocumentWorkContextViewProps = {
  documents: OrganizationDocument[];
  jobs: Job[];
  projects: ProjectWithDetails[];
  clients: Client[];
  employees: DocumentEmployee[];
  isPending: boolean;
  isItemPending: (documentId: string) => boolean;
  onOpenDocument: (document: OrganizationDocument) => void;
  onDetailsDocument: (document: OrganizationDocument) => void;
  onRenameDocument: (document: OrganizationDocument) => void;
  onLinkDocument: (document: OrganizationDocument) => void;
  onMoveDocument: (document: OrganizationDocument) => void;
  onCopyDocument: (document: OrganizationDocument) => void;
  onDeleteDocument: (document: OrganizationDocument) => void;
};

// One column definition for the loaded header and the skeleton (design canon):
// widths, breakpoints and cell count cannot drift apart.
const WORK_CONTEXT_COLUMNS: readonly SkeletonColumn[] = [
  {
    id: 'expand',
    header: null,
    className: 'w-[44px]',
    skeleton: <Skeleton className="size-6 rounded-sm" />,
  },
  {
    id: 'context',
    header: 'Verknüpfung',
    skeleton: (
      <div className="space-y-2">
        <Skeleton className="h-4 w-60 max-w-[75%]" />
        <Skeleton className="h-3 w-36 max-w-[55%]" />
      </div>
    ),
  },
  {
    id: 'type',
    header: 'Typ',
    className: 'hidden lg:table-cell',
    skeleton: <Skeleton className="h-4 w-20" />,
  },
  {
    id: 'documents',
    header: 'Dokumente',
    skeleton: (
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-4 w-44 max-w-[65%]" />
      </div>
    ),
  },
  {
    id: 'actions',
    header: null,
    className: 'w-[52px]',
    skeleton: <Skeleton className="ml-auto size-8 rounded-md" />,
  },
];

function WorkContextTableHeader() {
  return (
    <TableHeader>
      <TableRow>
        {WORK_CONTEXT_COLUMNS.map((column) => (
          <TableHead key={column.id} className={column.className}>
            {column.header}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
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

type WorkContextSimpleGroupProps = WorkContextGroupProps & {
  group: SimpleDocumentGroup;
};

/** Desktop rows of one customer or employee and the documents linked to them. */
function WorkContextSimpleGroupRows({
  group,
  rowId,
  isExpanded,
  onToggle,
  isDocumentPending,
  getHandlers,
}: WorkContextSimpleGroupProps): ReactElement {
  const Icon = group.typeLabel === 'Kunde' ? Building2 : UserRound;

  return (
    <>
      <TableRow interactive onClick={() => onToggle(rowId)}>
        <TableCell className="w-[44px] pr-0">
          <PlainButton
            type="button"
            onClick={(event) => onToggle(rowId, event)}
            className="flex size-6 items-center justify-center rounded-sm hover:bg-accent"
            aria-label={`${group.typeLabel} ${isExpanded ? 'zuklappen' : 'aufklappen'}`}
          >
            <ChevronRight
              className={cn(
                'size-4 text-muted-foreground transition-transform duration-200',
                isExpanded && 'rotate-90',
              )}
            />
          </PlainButton>
        </TableCell>
        <TableCell>
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <span className="truncate font-medium">{group.title}</span>
              <p className="text-xs text-muted-foreground">
                {group.documents.length} {group.documents.length === 1 ? 'Datei' : 'Dateien'}
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
            isPending={isDocumentPending(document.id)}
            handlers={getHandlers(document)}
          />
        ))}
    </>
  );
}

/** Mobile card of one customer or employee and the documents linked to them. */
function WorkContextSimpleGroupCard({
  group,
  rowId,
  isExpanded,
  onToggle,
  isDocumentPending,
  getHandlers,
}: WorkContextSimpleGroupProps): ReactElement {
  const Icon = group.typeLabel === 'Kunde' ? Building2 : UserRound;

  return (
    <div className="space-y-2">
      <ListRow interactive className="items-start gap-2" onClick={() => onToggle(rowId)}>
        <PlainButton
          type="button"
          onClick={(event) => onToggle(rowId, event)}
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
          aria-label={`${group.typeLabel} ${isExpanded ? 'zuklappen' : 'aufklappen'}`}
        >
          <ChevronRight
            className={cn(
              'size-3.5 text-muted-foreground transition-transform duration-200',
              isExpanded && 'rotate-90',
            )}
          />
        </PlainButton>
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="truncate text-sm font-medium">{group.title}</p>
          <DocumentSummary
            count={group.documents.length}
            latestUpdatedAt={getLatestUpdatedAt(group.documents)}
          />
        </div>
        <OpenContextLink href={group.href} label="Öffnen" />
      </ListRow>

      {isExpanded && (
        <div className="ml-6 space-y-2">
          {group.documents.map((document) => (
            <MobileDocumentCard
              key={`mobile-${rowId}:document:${document.id}`}
              document={document}
              isPending={isDocumentPending(document.id)}
              handlers={getHandlers(document)}
            />
          ))}
        </div>
      )}
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
  isItemPending,
  onOpenDocument,
  onDetailsDocument,
  onRenameDocument,
  onLinkDocument,
  onMoveDocument,
  onCopyDocument,
  onDeleteDocument,
}: DocumentWorkContextViewProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const { projectGroups, standaloneJobGroups, clientGroups, employeeGroups } = useMemo(
    () => buildWorkContextGroups({ documents, jobs, projects, clients, employees }),
    [clients, documents, employees, jobs, projects],
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

  function getGroupProps(rowId: string): WorkContextGroupProps {
    return {
      rowId,
      isExpanded: expandedIds.has(rowId),
      onToggle: toggleExpanded,
      isDocumentPending: (documentId) => isPending || isItemPending(documentId),
      getHandlers,
    };
  }

  function getJobProject(job: Job): ProjectWithDetails | null {
    return job.projectId ? (projectById.get(job.projectId) ?? null) : null;
  }

  if (!hasGroups) {
    return (
      <EmptyState
        icon={Briefcase}
        title="Noch keine Verknüpfungen mit Dateien"
        description="Sobald Dateien mit Aufträgen, Projekten, Kunden oder Mitarbeitern verknüpft werden, erscheinen sie in dieser Übersicht."
      />
    );
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <Table>
          <WorkContextTableHeader />
          <TableBody>
            {projectGroups.map((group) => {
              const rowId = `project:${group.project.id}`;
              return <WorkContextProjectGroupRows key={rowId} group={group} {...getGroupProps(rowId)} />;
            })}

            {standaloneJobGroups.map((group) => {
              const rowId = `job:${group.job.id}`;
              return (
                <WorkContextJobGroupRows
                  key={rowId}
                  group={group}
                  project={getJobProject(group.job)}
                  {...getGroupProps(rowId)}
                />
              );
            })}

            {[...clientGroups, ...employeeGroups].map((group) => {
              const rowId = `${group.typeLabel}:${group.id}`;
              return <WorkContextSimpleGroupRows key={rowId} group={group} {...getGroupProps(rowId)} />;
            })}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 md:hidden">
        {projectGroups.map((group) => {
          const rowId = `project:${group.project.id}`;
          return <WorkContextProjectGroupCard key={rowId} group={group} {...getGroupProps(rowId)} />;
        })}

        {standaloneJobGroups.map((group) => {
          const rowId = `job:${group.job.id}`;
          return (
            <WorkContextJobGroupCard
              key={rowId}
              group={group}
              project={getJobProject(group.job)}
              {...getGroupProps(rowId)}
            />
          );
        })}

        {[...clientGroups, ...employeeGroups].map((group) => {
          const rowId = `${group.typeLabel}:${group.id}`;
          return <WorkContextSimpleGroupCard key={rowId} group={group} {...getGroupProps(rowId)} />;
        })}
      </div>
    </>
  );
}

/** Loading frame of the work-context view; every loaded group row expands on click. */
export function WorkContextSkeleton() {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <Table>
          <WorkContextTableHeader />
          <TableBody>
            <SkeletonRows columns={WORK_CONTEXT_COLUMNS} interactive />
          </TableBody>
        </Table>
      </div>

      <SkeletonList count={5} interactive className="space-y-3 md:hidden">
        <Skeleton className="size-5 shrink-0 rounded-sm" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-44 max-w-full" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-32 max-w-full" />
          </div>
        </div>
        <Skeleton className="size-7 shrink-0 rounded-md" />
      </SkeletonList>
    </>
  );
}
