'use client';

import { Fragment } from 'react';
import { Check } from 'lucide-react';

import { PlainButton } from '@/components/ui/plain-button';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export type PickerJob = {
  id: string;
  title: string;
  jobNumber: string | null;
  status: string;
  projectName: string | null;
  clientName: string | null;
  plannedToday: boolean;
};

export function JobPickerLoadingRows() {
  return (
    <div className="space-y-0.5" role="status" aria-busy="true">
      <span className="sr-only">Aufträge werden geladen.</span>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
          <Skeleton className="size-5 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-48 max-w-full" />
        </div>
      ))}
    </div>
  );
}

type JobPickerOptionListProps = {
  /** Already filtered and sorted: today's planned jobs first. */
  filteredJobs: PickerJob[];
  plannedTodayCount: number;
  selectedJobId: string | null;
  setSelectedJobId: (jobId: string | null) => void;
  isLoading: boolean;
  loadFailed: boolean;
  onRetry: () => void;
  searchQuery: string;
};

/** The always-visible radio list of the clock flows: "Ohne Auftrag" first, then the jobs. */
export function JobPickerOptionList({
  filteredJobs,
  plannedTodayCount,
  selectedJobId,
  setSelectedJobId,
  isLoading,
  loadFailed,
  onRetry,
  searchQuery,
}: JobPickerOptionListProps) {
  return (
    <div className="space-y-0.5" role="radiogroup" aria-label="Auftrag">
      <PlainButton
        type="button"
        role="radio"
        aria-checked={selectedJobId === null}
        onClick={() => setSelectedJobId(null)}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
          selectedJobId === null ? 'bg-primary/10 ring-1 ring-primary/20' : 'hover:bg-accent',
        )}
      >
        <div
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
            selectedJobId === null
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-muted-foreground/30',
          )}
        >
          {selectedJobId === null && <Check className="h-3 w-3" />}
        </div>
        <span className="text-muted-foreground">Ohne Auftrag</span>
      </PlainButton>

      {filteredJobs.map((job, index) => (
        <Fragment key={job.id}>
          {plannedTodayCount > 0 &&
            plannedTodayCount < filteredJobs.length &&
            (index === 0 || index === plannedTodayCount) && (
              <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">
                {index === 0 ? 'Heute geplant' : 'Weitere Aufträge'}
              </p>
            )}
          <PlainButton
            type="button"
            role="radio"
            aria-checked={selectedJobId === job.id}
            onClick={() => setSelectedJobId(job.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
              selectedJobId === job.id ? 'bg-primary/10 ring-1 ring-primary/20' : 'hover:bg-accent',
            )}
          >
            <div
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                selectedJobId === job.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-muted-foreground/30',
              )}
            >
              {selectedJobId === job.id && <Check className="h-3 w-3" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 break-words font-medium" title={job.title}>
                {job.title}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {[job.jobNumber, job.clientName, job.projectName].filter(Boolean).join(' · ')}
              </p>
            </div>
          </PlainButton>
        </Fragment>
      ))}

      {loadFailed && !isLoading ? (
        <SectionError className="mt-2" onRetry={onRetry}>
          Aufträge konnten nicht geladen werden.
        </SectionError>
      ) : filteredJobs.length === 0 && !isLoading ? (
        <div className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {searchQuery ? 'Keine Aufträge gefunden' : 'Keine Aufträge verfügbar'}
          </p>
        </div>
      ) : null}
    </div>
  );
}
