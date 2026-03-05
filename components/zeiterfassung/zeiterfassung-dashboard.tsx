'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Briefcase,
  Coffee,
  Car,
  Clock,
  Palmtree,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { TimeProgressRing } from './time-progress-ring';
import { useCurrentUserStatus } from '@/hooks/use-current-user-status';

interface ZeiterfassungDashboardProps {
  organizationId: string;
  userId: string;
}

// Daily goal in minutes (8 hours)
const DAILY_GOAL_MINUTES = 8 * 60; // 480 minutes

/**
 * Format total minutes to HH:MM:SS with live elapsed time
 */
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

/**
 * Calculate live percentage towards daily goal
 */
function calculateLivePercentage(
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

  const percentage = (totalMinutes / DAILY_GOAL_MINUTES) * 100;
  return Math.min(percentage, 100);
}

export function ZeiterfassungDashboard({
  organizationId,
  userId
}: ZeiterfassungDashboardProps) {
  const { status, isLoading, error } = useCurrentUserStatus({
    organizationId,
    userId
  });

  // Live timer state
  const [liveTime, setLiveTime] = useState('00:00:00');
  const [livePercentage, setLivePercentage] = useState(0);

  // Update live timer every second
  useEffect(() => {
    const updateLiveValues = () => {
      setLiveTime(
        formatLiveTime(
          status.todayMinutes,
          status.clockInTime,
          status.isClockedIn
        )
      );
      setLivePercentage(
        calculateLivePercentage(
          status.todayMinutes,
          status.clockInTime,
          status.isClockedIn
        )
      );
    };

    // Update immediately
    updateLiveValues();

    // Then update every second
    const interval = setInterval(updateLiveValues, 1000);
    return () => clearInterval(interval);
  }, [status.todayMinutes, status.clockInTime, status.isClockedIn]);

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
    <div className="space-y-6">
      {/* Hero Section - Time Progress Ring */}
      <div className="flex flex-col items-center py-8">
        <TimeProgressRing
          percentage={livePercentage}
          size={260}
          strokeWidth={14}
          isActive={status.isClockedIn}
        >
          <span className="text-4xl font-bold tabular-nums tracking-tight">
            {liveTime}
          </span>
          <span className="mt-1 text-sm text-muted-foreground">Gesamtzeit</span>
        </TimeProgressRing>

        {/* Status text */}
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

        {/* Goal indicator */}
        <p className="mt-1 text-sm text-muted-foreground">
          Tagesziel: 8 Stunden ({Math.round(livePercentage)}% erreicht)
        </p>
      </div>

      {/* Quick Actions / Menu */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground px-1">
          Schnellzugriff
        </h3>

        {/* Project Selection - Cosmetic */}
        <MenuCard
          icon={Briefcase}
          title="Projekt auswählen"
          subtitle="Noch kein Projekt gewählt"
          disabled
        />

        {/* Break/Pause - Cosmetic */}
        <MenuCard
          icon={Coffee}
          title="Pause"
          subtitle="Pausenzeiten erfassen"
          disabled
        />

        {/* Travel Time - Cosmetic */}
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
                {/* Progress bar */}
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

      {/* Working Time Status - Shows current status */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground px-1">
          Status
        </h3>

        <Card>
          <CardContent className="p-4">
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Menu Card Component
interface MenuCardProps {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  disabled?: boolean;
  onClick?: () => void;
}

function MenuCard({
  icon: Icon,
  title,
  subtitle,
  disabled,
  onClick
}: MenuCardProps) {
  return (
    <Card
      className={cn(
        'transition-colors',
        disabled
          ? 'opacity-60 cursor-not-allowed'
          : 'cursor-pointer hover:bg-accent/50'
      )}
      onClick={disabled ? undefined : onClick}
    >
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-purple/10">
            <Icon className="h-5 w-5 text-brand-purple" />
          </div>
          <div>
            <p className="font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

// Dashboard Skeleton
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Hero skeleton */}
      <div className="flex flex-col items-center py-8">
        <Skeleton className="h-[260px] w-[260px] rounded-full" />
        <Skeleton className="mt-6 h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-32" />
      </div>

      {/* Quick actions skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
        ))}
      </div>

      {/* Vacation skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-[100px] w-full rounded-lg" />
      </div>
    </div>
  );
}

