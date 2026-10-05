'use client';

import { useState } from 'react';
import { ChevronDown, Clock } from 'lucide-react';

import { PlainButton } from '@/components/ui/plain-button';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDuration } from '@/lib/time-tracking/helpers';
import { cn } from '@/lib/utils';
import type { useProjectDetailTime } from './use-project-detail-time';
import { SectionTitle } from '@/components/shared/section-title';

type ProjectTimeSummary = ReturnType<typeof useProjectDetailTime>['projectTimeSummary'];

type ProjectDetailTimeSummaryCardProps = {
  isLoadingTime: boolean;
  timeLoadError: boolean;
  onRetry: () => void;
  retryPending: boolean;
  projectTimeSummary: ProjectTimeSummary;
};

export function ProjectDetailTimeSummaryCard({
  isLoadingTime,
  timeLoadError,
  onRetry,
  retryPending,
  projectTimeSummary,
}: ProjectDetailTimeSummaryCardProps) {
  const [showTimeDetails, setShowTimeDetails] = useState(false);

  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <SectionTitle icon={<Clock className="size-4" />} className="mb-4">
        Gesamte Zeiterfassung
      </SectionTitle>

      {isLoadingTime ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      ) : timeLoadError ? (
        <SectionError onRetry={onRetry} retryPending={retryPending}>
          Die Arbeitszeiten für dieses Projekt konnten nicht geladen werden.
        </SectionError>
      ) : projectTimeSummary.totalMinutes === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Noch keine Arbeitszeiten für dieses Projekt erfasst.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">Gesamtstunden (alle Aufträge)</p>
            <p className="text-lg font-bold tabular-nums">
              {formatDuration(Math.round(projectTimeSummary.totalMinutes))}
            </p>
          </div>

          {projectTimeSummary.perJob.length > 0 && (
            <div>
              <PlainButton
                onClick={() => setShowTimeDetails(!showTimeDetails)}
                aria-expanded={showTimeDetails}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
              >
                <span>Pro Auftrag ({projectTimeSummary.perJob.length})</span>
                <ChevronDown
                  className={cn('size-3.5 transition-transform', showTimeDetails && 'rotate-180')}
                />
              </PlainButton>

              {showTimeDetails && (
                <div className="mt-2 divide-y rounded-md border">
                  {projectTimeSummary.perJob.map((jobTime) => (
                    <ProjectDetailJobTimeRow key={jobTime.jobId} jobTime={jobTime} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectDetailJobTimeRow({ jobTime }: { jobTime: ProjectTimeSummary['perJob'][number] }) {
  const targetMinutes =
    jobTime.plannedWorkingMinutes && jobTime.plannedWorkingMinutes > 0 ? jobTime.plannedWorkingMinutes : null;
  const hasTarget = targetMinutes !== null;
  const progressPercentage = hasTarget ? Math.min(100, (jobTime.minutes / targetMinutes) * 100) : 0;
  const overrunMinutes = hasTarget && jobTime.minutes > targetMinutes ? jobTime.minutes - targetMinutes : 0;
  return (
    <div className="space-y-2 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate font-medium">{jobTime.title}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatDuration(Math.round(jobTime.minutes))}
        </span>
      </div>
      {hasTarget ? (
        <>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {formatDuration(Math.round(jobTime.minutes))} / {formatDuration(targetMinutes)}
            </span>
            <span className="tabular-nums">{Math.round((jobTime.minutes / targetMinutes) * 100)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          {overrunMinutes > 0 && (
            <p className="text-xs text-warning-text">
              {formatDuration(overrunMinutes)} über dem geplanten Arbeitsaufwand
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Kein geplanter Arbeitsaufwand hinterlegt.</p>
      )}
    </div>
  );
}
