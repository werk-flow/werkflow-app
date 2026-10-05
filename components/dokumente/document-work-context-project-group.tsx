'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { Fragment, type ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';

import { ListRow } from '@/components/ui/list-row';
import { TableCell, TableRow } from '@/components/ui/table';
import { getJobDisplayTitle, getProjectDisplayTitle } from '@/lib/jobs/types';
import { cn } from '@/lib/utils';
import {
  getJobHref,
  getLatestUpdatedAt,
  getProjectHref,
  type ProjectDocumentGroup,
} from '@/lib/documents/work-context-groups';
import {
  DocumentInlineRow,
  DocumentSummary,
  MobileDocumentCard,
  OpenContextLink,
  type WorkContextGroupProps,
} from './document-work-context-row-parts';

type WorkContextProjectGroupProps = WorkContextGroupProps & {
  group: ProjectDocumentGroup;
};

/** Desktop rows of one project: the project row, its own documents and its jobs with their documents. */
export function WorkContextProjectGroupRows({
  group,
  rowId,
  isExpanded,
  onToggle,
  isDocumentPending,
  getHandlers,
}: WorkContextProjectGroupProps): ReactElement {
  const latestUpdatedAt = getLatestUpdatedAt([
    ...group.directDocuments,
    ...group.childJobGroups.flatMap((jobGroup) => jobGroup.documents),
  ]);
  const projectHref = getProjectHref(group.project);

  return (
    <>
      <TableRow interactive className="bg-muted/30" onClick={() => onToggle(rowId)}>
        <TableCell className="w-[44px] pr-0">
          <PlainButton
            type="button"
            onClick={(event) => onToggle(rowId, event)}
            className="flex size-6 items-center justify-center rounded-sm hover:bg-accent"
            aria-label={isExpanded ? 'Projekt zuklappen' : 'Projekt aufklappen'}
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
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {group.project.projectNumber && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {group.project.projectNumber}
                  </span>
                )}
                <span className="truncate font-medium">{getProjectDisplayTitle(group.project)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {group.childJobGroups.length} {group.childJobGroups.length === 1 ? 'Auftrag' : 'Aufträge'} mit
                Dateien
              </p>
            </div>
            <OpenContextLink href={projectHref} label="Zum Projekt" />
          </div>
        </TableCell>
        <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">Projekt</TableCell>
        <TableCell>
          <DocumentSummary count={group.totalDocumentCount} latestUpdatedAt={latestUpdatedAt} />
        </TableCell>
        <TableCell />
      </TableRow>

      {isExpanded &&
        group.directDocuments.map((document) => (
          <DocumentInlineRow
            key={`project:${group.project.id}:document:${document.id}`}
            document={document}
            indent="project"
            isPending={isDocumentPending(document.id)}
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
              <TableRow className="bg-muted/10">
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
                        {jobGroup.documents.length} {jobGroup.documents.length === 1 ? 'Datei' : 'Dateien'}
                      </p>
                    </div>
                    <OpenContextLink href={jobHref} label="Zum Auftrag" />
                  </div>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">Auftrag</TableCell>
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
                  isPending={isDocumentPending(document.id)}
                  handlers={getHandlers(document)}
                />
              ))}
            </Fragment>
          );
        })}
    </>
  );
}

/** Mobile card of one project with its own documents and its jobs with their documents. */
export function WorkContextProjectGroupCard({
  group,
  rowId,
  isExpanded,
  onToggle,
  isDocumentPending,
  getHandlers,
}: WorkContextProjectGroupProps): ReactElement {
  const projectHref = getProjectHref(group.project);

  return (
    <div className="space-y-2">
      <ListRow interactive className="items-start gap-2 bg-muted/30" onClick={() => onToggle(rowId)}>
        <PlainButton
          type="button"
          onClick={(event) => onToggle(rowId, event)}
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
          aria-label={isExpanded ? 'Projekt zuklappen' : 'Projekt aufklappen'}
        >
          <ChevronRight
            className={cn(
              'size-3.5 text-muted-foreground transition-transform duration-200',
              isExpanded && 'rotate-90',
            )}
          />
        </PlainButton>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            {group.project.projectNumber && (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {group.project.projectNumber}
              </span>
            )}
            <p className="truncate text-sm font-medium">{getProjectDisplayTitle(group.project)}</p>
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
      </ListRow>

      {isExpanded && (
        <div className="ml-6 space-y-2">
          {group.directDocuments.map((document) => (
            <MobileDocumentCard
              key={`mobile-project:${group.project.id}:document:${document.id}`}
              document={document}
              isPending={isDocumentPending(document.id)}
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
                        <p className="truncate text-sm font-medium">{getJobDisplayTitle(jobGroup.job)}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {jobGroup.documents.length} {jobGroup.documents.length === 1 ? 'Datei' : 'Dateien'}
                      </p>
                    </div>
                    <OpenContextLink href={jobHref} label="Öffnen" />
                  </div>
                </div>
                {jobGroup.documents.map((document) => (
                  <MobileDocumentCard
                    key={`mobile-job:${jobGroup.job.id}:document:${document.id}`}
                    document={document}
                    isPending={isDocumentPending(document.id)}
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
}
