'use client';

import { Car } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TimeProgressRing } from './time-progress-ring';
import { formatDuration } from '@/lib/time-tracking/helpers';
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
        <p className="mt-1 max-w-sm text-center text-xs text-muted-foreground/80">{todayTargetHint}</p>
      )}
    </>
  );
}

/* Time breakdown indicators */
function ZeiterfassungTimeBreakdown({ totals }: { totals: ZeiterfassungLiveTotals }) {
  const { breakdown, liveTravelMinutes, liveStandbyMinutes, liveCalloutMinutes, liveInternalMinutes } =
    totals;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-success" />
        <span className="text-muted-foreground">Arbeitszeit</span>
        <span className="font-medium tabular-nums">{formatDuration(breakdown.workMinutes)}</span>
      </span>
      {liveTravelMinutes > 0 && (
        <span className="flex items-center gap-1.5">
          <Car className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Fahrt</span>
          <span className="font-medium tabular-nums">{formatDuration(liveTravelMinutes)}</span>
        </span>
      )}
      {liveStandbyMinutes > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Bereitschaft</span>
          <span className="font-medium tabular-nums">{formatDuration(liveStandbyMinutes)}</span>
        </span>
      )}
      {liveCalloutMinutes > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Notdienst</span>
          <span className="font-medium tabular-nums">{formatDuration(liveCalloutMinutes)}</span>
        </span>
      )}
      {liveInternalMinutes > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Intern</span>
          <span className="font-medium tabular-nums">{formatDuration(liveInternalMinutes)}</span>
        </span>
      )}
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
  );
}

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

      <p
        className={cn(
          'mt-6 text-lg font-medium',
          effectiveState.status === 'working'
            ? 'text-success-text'
            : effectiveState.status === 'on_break'
              ? 'text-warning-text'
              : 'text-muted-foreground',
        )}
      >
        {effectiveState.status === 'working'
          ? 'Du arbeitest gerade.'
          : effectiveState.status === 'on_break'
            ? 'Du machst gerade Pause.'
            : 'Du bist nicht eingestempelt.'}
      </p>

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
