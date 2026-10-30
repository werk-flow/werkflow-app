'use client';

import { Clock, BarChart3 } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { SectionError } from '@/components/ui/section-error';
import { StatusBadge } from './status-badge';
import { WeeklyHoursChart } from '@/components/zeiterfassung/weekly-hours-chart';
import { formatDuration } from '@/lib/time-tracking/helpers';
import { getNoTargetReason } from '@/lib/personnel/targets';
import type { OrgBreakMode } from '@/lib/time-tracking/settings';
import { cn, formatBerlinTime } from '@/lib/utils';
import type { MitarbeiterDetailLiveTime } from './use-mitarbeiter-detail-live-time';
import { SectionTitle } from '@/components/shared/section-title';
import { StaleRegion } from '@/components/shared/stale-region';

function NoWeekData() {
  return (
    <EmptyState size="compact" className="py-4 text-center text-xs" title="Keine Daten für diese Woche" />
  );
}

type MitarbeiterDetailTimeCardsProps = {
  liveTime: MitarbeiterDetailLiveTime;
  breakMode: OrgBreakMode;
  autoBreakThresholdMinutes: number;
  autoBreakDurationMinutes: number;
};

/** The live status card and the weekly hours card of the left column. */
export function MitarbeiterDetailTimeCards({
  liveTime,
  breakMode,
  autoBreakThresholdMinutes,
  autoBreakDurationMinutes,
}: MitarbeiterDetailTimeCardsProps) {
  const { status, statusError, statusStale, refetchStatus, weekLoading, weekError, refetchWeek } = liveTime;
  const { todayTarget, todayTargetMinutes, todayTargetHint, memberBreakdown, dailyPercentage } = liveTime;
  // An unknown target is never measured against 8h: while the week loads the
  // card shows the worked time only, and a failed target read offers a retry.
  // A failed week read is the week card's one failure.
  const noTargetReason = todayTarget ? getNoTargetReason(todayTarget) : null;
  const targetReadFailed = !todayTarget && !weekLoading && !weekError;

  return (
    <>
      {/* Live Status Card (compact) */}
      <div className="rounded-lg border bg-card p-3 sm:p-4">
        <SectionTitle icon={<Clock className="size-4" />} className="mb-3">
          Aktueller Status
        </SectionTitle>
        {statusError && !statusStale ? (
          <SectionError onRetry={() => void refetchStatus()}>
            Der aktuelle Status konnte nicht geladen werden.
          </SectionError>
        ) : (
          <StaleRegion stale={statusStale} onRetry={refetchStatus} className="space-y-2.5">
            <StatusBadge
              status={status?.status}
              isClockedIn={status?.isClockedIn ?? false}
              isPending={status?.isPending ?? false}
              canViewStatus
            />

            {status?.isClockedIn && status.clockInTime && (
              <p className="text-xs text-muted-foreground">
                Eingestempelt seit{' '}
                <span className="font-medium text-foreground">
                  {formatBerlinTime(status.clockInTime)} Uhr
                </span>
              </p>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Tagesfortschritt</span>
                <span
                  className={cn(
                    'font-medium tabular-nums',
                    todayTargetMinutes > 0 && dailyPercentage >= 100
                      ? 'text-success-text'
                      : 'text-foreground',
                  )}
                >
                  {todayTargetMinutes > 0
                    ? `${formatDuration(memberBreakdown.workMinutes)} / ${formatDuration(todayTargetMinutes)} (${dailyPercentage}%)`
                    : formatDuration(memberBreakdown.workMinutes)}
                </span>
              </div>
              <Progress
                value={dailyPercentage}
                label="Tagesfortschritt"
                className="h-2"
                indicatorClassName={cn('bg-success', status?.status === 'working' && 'opacity-80')}
              />
              {noTargetReason && (
                <p className="text-xs text-muted-foreground">
                  {noTargetReason} – heute keine Sollarbeitszeit.
                </p>
              )}
              {targetReadFailed && (
                <SectionError onRetry={() => void refetchWeek()}>
                  Das Tagesziel konnte nicht geladen werden.
                </SectionError>
              )}
              {todayTargetHint && <p className="text-xs text-muted-foreground">{todayTargetHint}</p>}
            </div>

            {/* Time breakdown indicators */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1.5 text-xs">
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
                <span className="text-muted-foreground">Arbeit</span>
                <span className="font-medium tabular-nums">
                  {formatDuration(memberBreakdown.workMinutes)}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />
                <span className="text-muted-foreground">Pause</span>
                <span className="font-medium tabular-nums">
                  {memberBreakdown.breakMinutes > 0 ? formatDuration(memberBreakdown.breakMinutes) : '0 Min.'}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-info" />
                <span className="text-muted-foreground">Überstunden heute</span>
                <span className="font-medium tabular-nums">
                  {!todayTarget
                    ? '–'
                    : memberBreakdown.overtimeMinutes > 0
                      ? formatDuration(memberBreakdown.overtimeMinutes)
                      : '0 Min.'}
                </span>
              </span>
            </div>
          </StaleRegion>
        )}
      </div>

      <MitarbeiterDetailWeekCard
        liveTime={liveTime}
        breakMode={breakMode}
        autoBreakThresholdMinutes={autoBreakThresholdMinutes}
        autoBreakDurationMinutes={autoBreakDurationMinutes}
      />
    </>
  );
}

/** The week's attendance and hours, or the failure of its read with a retry. */
function MitarbeiterDetailWeekCard({
  liveTime,
  breakMode,
  autoBreakThresholdMinutes,
  autoBreakDurationMinutes,
}: MitarbeiterDetailTimeCardsProps) {
  const { status, weekData, weekStale, weekError, refetchWeek, weekTargets, todayIndex, weekLabel } =
    liveTime;
  const { liveTotalMinutes, memberBreakdown } = liveTime;
  const liveBreakMinutes = memberBreakdown.breakMinutes;

  return (
    <div className="rounded-lg border bg-card p-3 sm:p-4">
      <SectionTitle className="mb-3">
        <BarChart3 className="size-4" />
        Anwesenheit & Stunden
      </SectionTitle>
      {weekError && !weekStale ? (
        <SectionError onRetry={() => void refetchWeek()}>
          Die Stunden dieser Woche konnten nicht geladen werden.
        </SectionError>
      ) : weekData.length > 0 ? (
        <StaleRegion stale={weekStale} onRetry={refetchWeek}>
          <WeeklyHoursChart
            weekData={weekData}
            todayIndex={todayIndex}
            liveTodayMinutes={liveTotalMinutes}
            liveTodayBreakMinutes={liveBreakMinutes}
            liveTodayBreakMode={status?.breakMode ?? breakMode}
            liveAutoBreakThresholdMinutes={status?.autoBreakThresholdMinutes ?? autoBreakThresholdMinutes}
            liveAutoBreakDurationMinutes={status?.autoBreakDurationMinutes ?? autoBreakDurationMinutes}
            weekLabel={weekLabel}
            weekTargets={weekTargets}
          />
        </StaleRegion>
      ) : (
        <NoWeekData />
      )}
    </div>
  );
}
