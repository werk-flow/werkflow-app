'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Briefcase,
  Coffee,
  Car,
  Clock,
  Palmtree,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { TimeProgressRing } from './time-progress-ring';
import { useCurrentUserStatus } from '@/hooks/use-current-user-status';
import {
  getActiveJobId,
  switchJob,
  getJobsForPicker,
} from '@/lib/time-tracking/actions';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { JobPickerModal } from '@/components/job-picker-modal';
import {
  computeTimeBreakdown,
  formatDuration,
  WORK_GOAL_MINUTES,
} from '@/lib/time-tracking/helpers';
import { useWeeklyTimeData } from '@/hooks/use-weekly-time-data';
import { WeeklyHoursChart } from './weekly-hours-chart';

interface ZeiterfassungDashboardProps {
  organizationId: string;
  userId: string;
}

function formatLiveTime(
  baseMinutes: number,
  clockInTime: string | null,
  isClockedIn: boolean
): string {
  let totalMs = baseMinutes * 60 * 1000;

  if (isClockedIn && clockInTime) {
    const startTime = new Date(clockInTime);
    const now = new Date();
    const elapsedMs = now.getTime() - startTime.getTime();
    totalMs += elapsedMs;
  }

  const hours = Math.floor(totalMs / (1000 * 60 * 60));
  const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((totalMs % (1000 * 60)) / 1000);

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function calculateLiveTotalMinutes(
  baseMinutes: number,
  clockInTime: string | null,
  isClockedIn: boolean
): number {
  let totalMinutes = baseMinutes;

  if (isClockedIn && clockInTime) {
    const startTime = new Date(clockInTime);
    const now = new Date();
    const elapsedMs = now.getTime() - startTime.getTime();
    totalMinutes += elapsedMs / (1000 * 60);
  }

  return totalMinutes;
}

export function ZeiterfassungDashboard({
  organizationId,
  userId
}: ZeiterfassungDashboardProps) {
  const { status, isLoading, error } = useCurrentUserStatus({
    organizationId,
    userId
  });

  const { weekData, todayIndex, weekLabel } = useWeeklyTimeData({
    organizationId,
    userId,
  });

  const [liveTime, setLiveTime] = useState('00:00:00');
  const [liveTotalMinutes, setLiveTotalMinutes] = useState(0);

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobTitle, setActiveJobTitle] = useState<string | null>(null);
  const [showJobPicker, setShowJobPicker] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const fetchActiveJob = useCallback(async () => {
    try {
      const [activeResult, jobsResult] = await Promise.all([
        getActiveJobId(organizationId),
        getJobsForPicker(organizationId),
      ]);
      if (activeResult.success) {
        setActiveJobId(activeResult.jobId);
        if (activeResult.jobId && jobsResult.success) {
          const job = jobsResult.jobs.find((j) => j.id === activeResult.jobId);
          setActiveJobTitle(job?.title ?? null);
        } else {
          setActiveJobTitle(null);
        }
      }
    } catch (err) {
      console.error('Error fetching active job:', err);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchActiveJob();
  }, [fetchActiveJob]);

  useRealtimeEvent('jobs', fetchActiveJob);
  useRealtimeEvent('job_assignments', fetchActiveJob);
  useRealtimeEvent('time_entries', fetchActiveJob);

  const handlePickerConfirm = async (jobId: string | null) => {
    if (!status.isClockedIn) {
      setShowJobPicker(false);
      return;
    }
    setIsSwitching(true);
    try {
      const result = await switchJob(organizationId, jobId);
      if (result.success) {
        setActiveJobId(jobId);
      }
    } catch (err) {
      console.error('Error switching job:', err);
    } finally {
      setIsSwitching(false);
      setShowJobPicker(false);
    }
  };

  useEffect(() => {
    const updateLiveValues = () => {
      setLiveTime(
        formatLiveTime(
          status.todayMinutes,
          status.clockInTime,
          status.isClockedIn
        )
      );
      setLiveTotalMinutes(
        calculateLiveTotalMinutes(
          status.todayMinutes,
          status.clockInTime,
          status.isClockedIn
        )
      );
    };

    updateLiveValues();

    const interval = setInterval(updateLiveValues, 1000);
    return () => clearInterval(interval);
  }, [status.todayMinutes, status.clockInTime, status.isClockedIn]);

  const breakdown = computeTimeBreakdown(liveTotalMinutes);
  const workPercentage = Math.min(
    Math.round((breakdown.workMinutes / WORK_GOAL_MINUTES) * 100),
    999
  );

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <Clock className="h-6 w-6 text-destructive" />
        </div>
        <p className="text-sm text-muted-foreground">
          Fehler beim Laden der Daten
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-32">
      {/* Hero Section */}
      <div className="flex flex-col items-center py-8">
        <TimeProgressRing
          totalMinutes={liveTotalMinutes}
          size={260}
          strokeWidth={14}
          isActive={status.isClockedIn}
        >
          <span className="text-4xl font-bold tabular-nums tracking-tight">
            {liveTime}
          </span>
          <span className="mt-1 text-sm text-muted-foreground">Gesamtzeit</span>
        </TimeProgressRing>

        <p
          className={cn(
            'mt-6 text-lg font-medium',
            status.isClockedIn
              ? 'text-green-600 dark:text-green-400'
              : 'text-muted-foreground'
          )}
        >
          {status.isClockedIn
            ? 'Du arbeitest gerade.'
            : 'Du bist nicht eingestempelt.'}
        </p>

        <p className="mt-1 text-sm text-muted-foreground">
          Tagesziel: 8 Stunden Arbeitszeit ({workPercentage}% erreicht)
        </p>

        {/* Time breakdown indicators */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            <span className="text-muted-foreground">Arbeitszeit</span>
            <span className="font-medium tabular-nums">
              {formatDuration(breakdown.workMinutes)}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
            <span className="text-muted-foreground">Pause</span>
            <span className="font-medium tabular-nums">
              {breakdown.breakMinutes > 0 ? '30 Min.' : '0 Min.'}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">Überstunden heute</span>
            <span className="font-medium tabular-nums">
              {breakdown.overtimeMinutes > 0
                ? formatDuration(breakdown.overtimeMinutes)
                : '0 Min.'}
            </span>
          </span>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground px-1">
          Schnellzugriff
        </h3>

        <MenuCard
          icon={Briefcase}
          title="Auftrag auswählen"
          subtitle={
            activeJobTitle
              ? activeJobTitle
              : status.isClockedIn
                ? 'Kein Auftrag gewählt'
                : 'Auftrag für nächste Schicht'
          }
          onClick={() => setShowJobPicker(true)}
          active={!!activeJobTitle && status.isClockedIn}
          disabled={!status.isClockedIn}
          disabledHint="Stemple zuerst ein"
        />

        <MenuCard
          icon={Coffee}
          title="Pause"
          subtitle="Pausenzeiten erfassen"
          disabled
        />

        <MenuCard
          icon={Car}
          title="Fahrzeit"
          subtitle="Fahrzeiten dokumentieren"
          disabled
        />
      </div>

      {/* Vacation Widget */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground px-1">
          Urlaub & Abwesenheit
        </h3>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-purple/10">
                <Palmtree className="h-6 w-6 text-brand-purple" />
              </div>
              <div className="flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">Urlaubstage</span>
                  <span className="text-xs text-muted-foreground">
                    9 von 30 genutzt
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-brand-purple transition-all"
                    style={{ width: '30%' }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    <span className="inline-block h-2 w-2 rounded-full bg-brand-purple mr-1" />
                    9 Verbrauchte Tage
                  </span>
                  <span className="font-semibold text-foreground">
                    21 <span className="font-normal">Tage übrig</span>
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Working Time Status + Weekly Chart */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground px-1">
          Status
        </h3>

        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full',
                    status.isClockedIn ? 'bg-green-500/10' : 'bg-muted'
                  )}
                >
                  <Clock
                    className={cn(
                      'h-5 w-5',
                      status.isClockedIn
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-muted-foreground'
                    )}
                  />
                </div>
                <div>
                  <p className="font-medium">Arbeitszeit</p>
                  <p className="text-xs text-muted-foreground">
                    {status.isClockedIn
                      ? `Seit ${new Date(
                          status.clockInTime!
                        ).toLocaleTimeString('de-DE', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })} Uhr`
                      : 'Nicht aktiv'}
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium',
                  status.isClockedIn
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {status.isClockedIn ? 'aktiv' : 'inaktiv'}
              </span>
            </div>

            {weekData.length > 0 && (
              <>
                <div className="border-t border-border" />
                <WeeklyHoursChart
                  weekData={weekData}
                  todayIndex={todayIndex}
                  liveTodayMinutes={liveTotalMinutes}
                  narrowBars
                  weekLabel={weekLabel}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <JobPickerModal
        open={showJobPicker}
        onClose={() => setShowJobPicker(false)}
        onConfirm={handlePickerConfirm}
        organizationId={organizationId}
        mode="switch"
        currentJobId={activeJobId}
        isPending={isSwitching}
      />
    </div>
  );
}

interface MenuCardProps {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  disabled?: boolean;
  disabledHint?: string;
  active?: boolean;
  onClick?: () => void;
}

function MenuCard({
  icon: Icon,
  title,
  subtitle,
  disabled,
  disabledHint,
  active,
  onClick
}: MenuCardProps) {
  return (
    <Card
      className={cn(
        'transition-colors',
        disabled
          ? 'opacity-60 cursor-not-allowed'
          : 'cursor-pointer hover:bg-accent/50',
        active && 'ring-1 ring-primary/30'
      )}
      onClick={disabled ? undefined : onClick}
    >
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full',
              active ? 'bg-primary/10' : 'bg-brand-purple/10'
            )}
          >
            <Icon
              className={cn(
                'h-5 w-5',
                active ? 'text-primary' : 'text-brand-purple'
              )}
            />
          </div>
          <div>
            <p className="font-medium">{title}</p>
            <p className="text-xs text-muted-foreground truncate max-w-[200px]">
              {disabled && disabledHint ? disabledHint : subtitle}
            </p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center py-8">
        <Skeleton className="h-[260px] w-[260px] rounded-full" />
        <Skeleton className="mt-6 h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-32" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
        ))}
      </div>

      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-[100px] w-full rounded-lg" />
      </div>
    </div>
  );
}
