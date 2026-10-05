'use client';

import { PlainButton } from '@/components/ui/plain-button';
import type { ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';

import { ListRow } from '@/components/ui/list-row';
import { TableCell, TableRow } from '@/components/ui/table';
import { getJobDisplayTitle, type ProjectWithDetails } from '@/lib/jobs/types';
import { cn } from '@/lib/utils';
import { getJobHref, getLatestUpdatedAt, type JobDocumentGroup } from '@/lib/documents/work-context-groups';
import {
  DocumentInlineRow,
  DocumentSummary,
  MobileDocumentCard,
  OpenContextLink,
  type WorkContextGroupProps,
} from './document-work-context-row-parts';

type WorkContextJobGroupProps = WorkContextGroupProps & {
  group: JobDocumentGroup;
  /** The job's project when it is known; it only shapes the link to the job. */
  project: ProjectWithDetails | null;
};

/** Desktop rows of one job outside a listed project and its documents. */
export function WorkContextJobGroupRows({
  group,
  project,
  rowId,
  isExpanded,
  onToggle,
  isDocumentPending,
  getHandlers,
}: WorkContextJobGroupProps): ReactElement {
  const jobHref = getJobHref({ job: group.job, project });

  return (
    <>
      <TableRow interactive onClick={() => onToggle(rowId)}>
        <TableCell className="w-[44px] pr-0">
          <PlainButton
            type="button"
            onClick={(event) => onToggle(rowId, event)}
            className="flex size-6 items-center justify-center rounded-sm hover:bg-accent"
            aria-label={isExpanded ? 'Auftrag zuklappen' : 'Auftrag aufklappen'}
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
                {group.job.jobNumber && (
                  <span className="font-mono text-xs text-muted-foreground">{group.job.jobNumber}</span>
                )}
                <span className="truncate font-medium">{getJobDisplayTitle(group.job)}</span>
              </div>
              <p className="text-xs text-muted-foreground">Einzelauftrag</p>
            </div>
            <OpenContextLink href={jobHref} label="Zum Auftrag" />
          </div>
        </TableCell>
        <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">Auftrag</TableCell>
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
            isPending={isDocumentPending(document.id)}
            handlers={getHandlers(document)}
          />
        ))}
    </>
  );
}

/** Mobile card of one job outside a listed project and its documents. */
export function WorkContextJobGroupCard({
  group,
  project,
  rowId,
  isExpanded,
  onToggle,
  isDocumentPending,
  getHandlers,
}: WorkContextJobGroupProps): ReactElement {
  const jobHref = getJobHref({ job: group.job, project });

  return (
    <div className="space-y-2">
      <ListRow interactive className="items-start gap-2" onClick={() => onToggle(rowId)}>
        <PlainButton
          type="button"
          onClick={(event) => onToggle(rowId, event)}
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
          aria-label={isExpanded ? 'Auftrag zuklappen' : 'Auftrag aufklappen'}
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
            {group.job.jobNumber && (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {group.job.jobNumber}
              </span>
            )}
            <p className="truncate text-sm font-medium">{getJobDisplayTitle(group.job)}</p>
          </div>
          <DocumentSummary
            count={group.documents.length}
            latestUpdatedAt={getLatestUpdatedAt(group.documents)}
          />
        </div>
        <OpenContextLink href={jobHref} label="Öffnen" />
      </ListRow>

      {isExpanded && (
        <div className="ml-6 space-y-2">
          {group.documents.map((document) => (
            <MobileDocumentCard
              key={`mobile-standalone-job:${group.job.id}:document:${document.id}`}
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
