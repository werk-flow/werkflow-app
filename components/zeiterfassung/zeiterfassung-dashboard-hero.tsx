'use client';

import { cn } from '@/lib/utils';
import { TimeProgressRing } from './time-progress-ring';
import { formatDuration } from '@/lib/time-tracking/helpers';
import {
  describeClockActivity,
  todayWorkingTime,
  type ClockActivityTone,
} from '@/lib/time-tracking/clock-day-summary';
import { describeNoTargetToday, type DailyTarget } from '@/lib/personnel/targets';
import type { LiveClockState } from '@/lib/time-tracking/types';
import type { ZeiterfassungLiveTotals } from '@/lib/time-tracking/live-totals';

type ZeiterfassungTodayTargetNoteProps = {
  todayTarget: DailyTarget | undefined;
  todayTargetHint: string | null;
  workPercentage: number | null;
};

/** Today's target, or why today has none. While the target is unknown it says nothing, never 8 h. */
function ZeiterfassungTodayTargetNote({
  todayTarget,
  todayTargetHint,
  workPercentage,
}: ZeiterfassungTodayTargetNoteProps) {
  const noTarget = todayTarget ? describeNoTargetToday(todayTarget) : null;
  return (
    <>
      {noTarget ? (
        <p className="mt-1 text-center text-sm text-muted-foreground">{noTarget}</p>
      ) : todayTarget?.absence?.portion === 'half_day' ? (
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {todayTarget.absence.type === 'sickness'
            ? 'Halber Tag Krankmeldung – Tagesziel: '
            : 'Halber Urlaubstag – Tagesziel: '}
          {formatDuration(todayTarget.targetMinutes)} Arbeitszeit
        </p>
      ) : todayTarget ? (
        <p className="mt-1 text-center text-sm text-muted-foreground">
          Tagesziel: {formatDuration(todayTarget.targetMinutes)} Arbeitszeit
          {workPercentage !== null ? ` (${workPercentage}% erreicht)` : ''}
        </p>
      ) : null}
      {todayTargetHint && (
        <p className="mt-1 max-w-sm text-center text-xs text-muted-foreground">{todayTargetHint}</p>
      )}
    </>
  );
}

/* Time breakdown indicators: working time, break and overtime; below them the
   parts the working time is made of, once it holds more than work. */
function ZeiterfassungTimeBreakdown({ totals }: { totals: ZeiterfassungLiveTotals }) {
  const { breakdown } = totals;
  const { workingMinutes, parts } = todayWorkingTime(breakdown, {
    travel: totals.liveTravelMinutes,
    standby: totals.liveStandbyMinutes,
    callout: totals.liveCalloutMinutes,
    internal_activity: totals.liveInternalMinutes,
  });

  return (
    <div className="mt-4 flex flex-col items-center gap-2 text-xs">
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-success" />
          <span className="text-muted-foreground">Arbeitszeit</span>
          <span className="font-medium tabular-nums">{formatDuration(breakdown.workMinutes)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-warning" />
          <span className="text-muted-foreground">Pause</span>
          <span className="font-medium tabular-nums">
            {breakdown.breakMinutes > 0 ? formatDuration(breakdown.breakMinutes) : '0 Min.'}
          </span>
        </span>
        <span className="flex items-center gap-1.5" data-testid="today-overtime">
          <span className="inline-block h-2 w-2 rounded-full bg-info" />
          <span className="text-muted-foreground">Überstunden heute</span>
          <span className="font-medium tabular-nums">
            {breakdown.overtimeMinutes > 0 ? formatDuration(breakdown.overtimeMinutes) : '0 Min.'}
          </span>
        </span>
      </div>
      {parts.length > 0 ? (
        <p className="text-center text-muted-foreground" data-testid="today-work-parts">
          {breakdown.overtimeMinutes > 0 ? `Gesamt ${formatDuration(workingMinutes)}, davon ` : 'Davon '}
          {parts.map((part, index) => (
            <span key={part.kind}>
              {index > 0 ? ' · ' : null}
              {part.label}{' '}
              <span className="font-medium tabular-nums text-foreground">{formatDuration(part.minutes)}</span>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

const ACTIVITY_TONE_TEXT = {
  active: 'text-success-text',
  break: 'text-warning-text',
  idle: 'text-muted-foreground',
} as const satisfies Record<ClockActivityTone, string>;

type ZeiterfassungDashboardHeroProps = {
  effectiveState: LiveClockState;
  liveTime: string;
  liveTotalMinutes: number;
  todayTarget: DailyTarget | undefined;
  todayTargetMinutes: number | undefined;
  todayTargetHint: string | null;
  totals: ZeiterfassungLiveTotals;
};

export function ZeiterfassungDashboardHero({
  effectiveState,
  liveTime,
  liveTotalMinutes,
  todayTarget,
  todayTargetMinutes,
  todayTargetHint,
  totals,
}: ZeiterfassungDashboardHeroProps) {
  const { liveBreakMinutes, ringTimelineSegments, workPercentage } = totals;
  const activity = describeClockActivity(effectiveState);

  return (
    <div className="flex flex-col items-center py-8">
      <TimeProgressRing
        totalMinutes={liveTotalMinutes}
        breakMinutes={liveBreakMinutes}
        timelineSegments={ringTimelineSegments}
        // An unknown target draws no overtime ring, never one past 8 h.
        targetMinutes={todayTargetMinutes ?? Number.POSITIVE_INFINITY}
        size={260}
        strokeWidth={14}
      >
        <span className="text-4xl font-bold tabular-nums tracking-tight">{liveTime}</span>
        <span className="mt-1 text-sm text-muted-foreground">Gesamtzeit</span>
      </TimeProgressRing>

      <p className={cn('mt-6 text-lg font-medium', ACTIVITY_TONE_TEXT[activity.tone])}>{activity.sentence}</p>

      {effectiveState.breakPolicy.breakMode === 'automatic' ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Pausen werden in dieser Organisation automatisch abgezogen.
        </p>
      ) : null}

      <ZeiterfassungTodayTargetNote
        todayTarget={todayTarget}
        todayTargetHint={todayTargetHint}
        workPercentage={workPercentage}
      />

      <ZeiterfassungTimeBreakdown totals={totals} />
    </div>
  );
}
