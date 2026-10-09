'use client';

import { useState } from 'react';
import { ChevronDown, Clock } from 'lucide-react';

import { PlainButton } from '@/components/ui/plain-button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatBerlinTime } from '@/lib/utils';
import { formatDurationOrDash } from './job-detail-format';
import { PersonAvatar, getSessionPersonName } from './job-detail-person';
import type { JobDetailTimeSummary } from './use-job-detail-time-summary';
import { SectionTitle } from '@/components/shared/section-title';
import { StaleRegion } from '@/components/shared/stale-region';

function JobDetailActiveWorkers({ activeWorkers }: Pick<JobDetailTimeSummary, 'activeWorkers'>) {
  return (
    <div className="rounded-md border border-success/40 bg-success-soft/80 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
        </span>
        <p className="text-xs font-semibold uppercase tracking-wide text-success-soft-foreground">
          Aktiv in Arbeit
        </p>
      </div>
      <div className="space-y-2">
        {activeWorkers.map((worker) => (
          <div key={worker.userId} className="flex items-center gap-3 rounded-md bg-background/80 px-3 py-2">
            <PersonAvatar
              person={worker.person}
              className="size-8"
              fallbackClassName="bg-success-soft text-[10px] font-medium text-success-soft-foreground"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{worker.name}</p>
              <p className="text-xs text-muted-foreground">
                Eingestempelt seit {formatBerlinTime(worker.clockIn.timestamp)}
                {' · '}
                {formatDurationOrDash(Math.round(worker.liveMinutes))}
                {worker.isPending ? ' · ausstehend' : ''}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type JobDetailTimeProgressProps = {
  totalMinutes: number;
  progressTargetMinutes: number;
};

function JobDetailTimeProgress({ totalMinutes, progressTargetMinutes }: JobDetailTimeProgressProps) {
  const progressPercentage = Math.min(100, (totalMinutes / progressTargetMinutes) * 100);
  const overrunMinutes = totalMinutes > progressTargetMinutes ? totalMinutes - progressTargetMinutes : 0;

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Fortschritt nach Arbeitsaufwand</p>
          <p className="text-sm font-semibold tabular-nums">
            {formatDurationOrDash(Math.round(totalMinutes))} / {formatDurationOrDash(progressTargetMinutes)}
          </p>
        </div>
        <p className="text-xs font-medium text-muted-foreground tabular-nums">
          {Math.round((totalMinutes / progressTargetMinutes) * 100)}%
        </p>
      </div>
      <Progress value={progressPercentage} />
      {overrunMinutes > 0 && (
        <p className="mt-2 text-xs text-warning-text">
          {formatDurationOrDash(overrunMinutes)} über dem geplanten Arbeitsaufwand
        </p>
      )}
    </div>
  );
}

function JobDetailEmployeeMinutes({ perEmployeeMinutes }: Pick<JobDetailTimeSummary, 'perEmployeeMinutes'>) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Pro Mitarbeiter</p>
      <div className="divide-y rounded-md border">
        {perEmployeeMinutes.map((emp) => (
          <div key={emp.userId} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <PersonAvatar
                person={emp.person}
                className="size-7"
                fallbackClassName="bg-primary/10 text-[10px] font-medium text-primary-text"
              />
              <span className="truncate font-medium">{emp.name}</span>
              {emp.isLive && (
                <span className="relative inline-flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
              )}
            </div>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatDurationOrDash(Math.round(emp.minutes))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type JobDetailSessionTimelineProps = Pick<
  JobDetailTimeSummary,
  'allSessions' | 'sessionPeople' | 'getSessionDurationMinutes'
> & {
  showAllSessions: boolean;
  setShowAllSessions: (show: boolean) => void;
};

function JobDetailSessionTimeline({
  allSessions,
  sessionPeople,
  getSessionDurationMinutes,
  showAllSessions,
  setShowAllSessions,
}: JobDetailSessionTimelineProps) {
  return (
    <div>
      <PlainButton
        onClick={() => setShowAllSessions(!showAllSessions)}
        aria-expanded={showAllSessions}
        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
      >
        <span>Einzelne Einträge ({allSessions.length})</span>
        <ChevronDown className={cn('size-3.5 transition-transform', showAllSessions && 'rotate-180')} />
      </PlainButton>

      {showAllSessions && (
        <div className="mt-2 max-h-64 divide-y overflow-auto rounded-md border">
          {allSessions.map((session) => {
            if (!session.clockIn) return null;

            const member = sessionPeople.get(session.clockIn.userId);
            return (
              <div key={session.clockIn.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <PersonAvatar
                  person={member}
                  className="size-7"
                  fallbackClassName="bg-primary/10 text-[10px] font-medium text-primary-text"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{getSessionPersonName(member)}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(session.clockIn.timestamp).toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                    {' · '}
                    {formatBerlinTime(session.clockIn.timestamp)}
                    {' – '}
                    {session.clockOut ? formatBerlinTime(session.clockOut.timestamp) : 'offen'}
                  </p>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {formatDurationOrDash(Math.round(getSessionDurationMinutes(session)))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type JobDetailTimeCardProps = {
  isLoadingTime: boolean;
  /** A refresh failed: the recorded times are last-known. */
  isTimeStale: boolean;
  refreshTime: () => Promise<void>;
  progressTargetMinutes: number | null;
  timeSummary: JobDetailTimeSummary;
};

export function JobDetailTimeCard({
  isLoadingTime,
  isTimeStale,
  refreshTime,
  progressTargetMinutes,
  timeSummary,
}: JobDetailTimeCardProps) {
  // Lives here, not in the timeline: the timeline unmounts while entries reload.
  const [showAllSessions, setShowAllSessions] = useState(false);
  const { activeWorkers, allSessions, perEmployeeMinutes, totalMinutes } = timeSummary;
  const hasProgressTarget = progressTargetMinutes !== null && progressTargetMinutes > 0;
  const hasAnySessions = allSessions.length > 0;
  const hasAnyTimeData = hasAnySessions || hasProgressTarget;

  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <SectionTitle icon={<Clock className="size-4" />} className="mb-4">
        Zeiterfassung &amp; Aktivität
      </SectionTitle>

      {isLoadingTime ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-8 w-1/2" />
        </div>
      ) : !hasAnyTimeData ? (
        <div className="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center">
          <p className="text-sm font-medium">Noch keine Arbeitszeiten für diesen Auftrag erfasst.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sobald ein Mitarbeiter auf diesen Auftrag arbeitet, erscheinen die Summen und Einträge hier
            automatisch.
          </p>
        </div>
      ) : (
        <StaleRegion stale={isTimeStale} onRetry={refreshTime} className="space-y-4">
          {activeWorkers.length > 0 && <JobDetailActiveWorkers activeWorkers={activeWorkers} />}

          {hasProgressTarget ? (
            <JobDetailTimeProgress
              totalMinutes={totalMinutes}
              progressTargetMinutes={progressTargetMinutes}
            />
          ) : (
            <div className="rounded-md border border-dashed bg-muted/20 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Kein geplanter Arbeitsaufwand hinterlegt.
              </p>
            </div>
          )}

          {/* Per-employee breakdown */}
          {perEmployeeMinutes.length > 0 && (
            <JobDetailEmployeeMinutes perEmployeeMinutes={perEmployeeMinutes} />
          )}

          {/* Session timeline */}
          {hasAnySessions && (
            <JobDetailSessionTimeline
              allSessions={allSessions}
              sessionPeople={timeSummary.sessionPeople}
              getSessionDurationMinutes={timeSummary.getSessionDurationMinutes}
              showAllSessions={showAllSessions}
              setShowAllSessions={setShowAllSessions}
            />
          )}
        </StaleRegion>
      )}
    </div>
  );
}
