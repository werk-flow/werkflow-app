'use client';

import { cn } from '@/lib/utils';
import { TimeProgressRing } from './time-progress-ring';
import { formatDuration } from '@/lib/time-tracking/helpers';
import {
  describeClockActivity,
  todayWorkingTime,
  type ClockActivityTone,
} from '@/lib/time-tracking/clock-day-summary';
import { DEFAULT_DAILY_TARGET_MINUTES, type DailyTarget } from '@/lib/personnel/targets';
import type { LiveClockState } from '@/lib/time-tracking/types';
import type { ZeiterfassungLiveTotals } from './zeiterfassung-dashboard-live-totals';

type ZeiterfassungTodayTargetNoteProps = {
  todayTarget: DailyTarget | undefined;
  todayTargetMinutes: number | undefined;
  todayTargetHint: string | null;
  workPercentage: number | null;
};

function ZeiterfassungTodayTargetNote({
  todayTarget,
  todayTargetMinutes,
  todayTargetHint,
  workPercentage,
}: ZeiterfassungTodayTargetNoteProps) {
  return (
    <>
      {todayTarget?.isHoliday ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Feiertag: {todayTarget.holidayName} – heute keine Sollarbeitszeit.
        </p>
      ) : todayTarget?.isClosureDay ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Betriebsruhe
          {todayTarget.closureLabel ? ` (${todayTarget.closureLabel})` : ''} – heute keine Sollarbeitszeit.
        </p>
      ) : todayTarget?.absence?.portion === 'full' ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {todayTarget.absence.type === 'sickness'
            ? 'Krankmeldung – heute keine Sollarbeitszeit.'
            : 'Urlaub genehmigt – heute keine Sollarbeitszeit.'}
        </p>
      ) : todayTarget?.absence?.portion === 'half_day' ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {todayTarget.absence.type === 'sickness'
            ? 'Halber Tag Krankmeldung – Tagesziel: '
            : 'Halber Urlaubstag – Tagesziel: '}
          {formatDuration(todayTargetMinutes ?? 0)} Arbeitszeit
        </p>
      ) : todayTarget && todayTarget.targetMinutes === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Laut Arbeitszeitmodell heute kein Arbeitstag.</p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          Tagesziel: {formatDuration(todayTargetMinutes ?? DEFAULT_DAILY_TARGET_MINUTES)} Arbeitszeit
          {workPercentage !== null ? ` (${workPercentage}% erreicht)` : ''}
        </p>
      )}
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
        targetMinutes={todayTargetMinutes}
        size={260}
        strokeWidth={14}
        isActive={effectiveState.isClockedIn}
        glowVariant={effectiveState.isOnBreak ? 'break' : 'work'}
      >
        <span className="text-4xl font-bold tabular-nums tracking-tight">{liveTime}</span>
        <span className="mt-1 text-sm text-muted-foreground">Gesamtzeit</span>
      </TimeProgressRing>

      <p className={cn('mt-6 text-lg font-medium', ACTIVITY_TONE_TEXT[activity.tone])}>{activity.sentence}</p>

      {effectiveState.breakMode === 'automatic' ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Pausen werden in dieser Organisation automatisch abgezogen.
        </p>
      ) : null}

      <ZeiterfassungTodayTargetNote
        todayTarget={todayTarget}
        todayTargetMinutes={todayTargetMinutes}
        todayTargetHint={todayTargetHint}
        workPercentage={workPercentage}
      />

      <ZeiterfassungTimeBreakdown totals={totals} />
    </div>
  );
}
