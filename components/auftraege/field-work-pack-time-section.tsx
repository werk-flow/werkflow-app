'use client';

import { Clock3, Loader2, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition, type ReactElement } from 'react';

import { useClockState } from '@/components/clock-state-provider';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  }).format(new Date(value));
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return 'läuft';
  const rounded = Math.max(0, Math.round(minutes));
  return `${Math.floor(rounded / 60)} Std. ${rounded % 60} Min.`;
}

export function FieldWorkPackTimeSection({
  jobId,
  currentUserId,
  entries,
  loadError,
  readOnly,
}: {
  jobId: string;
  currentUserId: string;
  entries: TimeEntry[];
  loadError: boolean;
  readOnly: boolean;
}): ReactElement {
  const router = useRouter();
  const { showBanner } = useBanner();
  const { state, isLoading, isPending, statusError, clockIn, clockOut, switchJob } = useClockState();
  const [isRefreshing, startRefresh] = useTransition();
  const sessions = calculateWorkSessions(
    entries.filter((entry) => entry.userId === currentUserId)
  ).filter((session) => session.jobId === jobId);
  const isClockedIntoThisJob = state?.isClockedIn && state.activeJobId === jobId;
  const isClockedIntoAnotherJob = state?.isClockedIn && state.activeJobId !== jobId;

  async function changeClock(): Promise<void> {
    const result = isClockedIntoThisJob
      ? await clockOut()
      : isClockedIntoAnotherJob
        ? await switchJob(jobId)
        : await clockIn(jobId);
    if (!result.success) {
      showBanner({
        variant: 'error',
        message: 'Die Zeiterfassung konnte nicht geändert werden. Bitte prüfe den aktuellen Stand und versuche es erneut.',
      });
      return;
    }
    showBanner({
      variant: 'success',
      message: isClockedIntoThisJob
        ? 'Die Arbeitszeit wurde beendet.'
        : isClockedIntoAnotherJob
          ? 'Die Zeiterfassung läuft jetzt für diesen Auftrag.'
          : 'Die Arbeitszeit wurde für diesen Auftrag gestartet.',
    });
    router.refresh();
  }

  return (
    <section id="zeit" className="rounded-lg border bg-card p-4 shadow-xs sm:p-5" aria-labelledby="field-time-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="field-time-heading" className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Clock3 className="size-4" />
            Meine Zeit
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Zeiten bleiben von Planung und Material getrennt. Der erste Start kann den Arbeitsstand beginnen.
          </p>
        </div>
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={isLoading || isPending || Boolean(statusError)}
            onClick={() => void changeClock()}
          >
            {isLoading || isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isClockedIntoThisJob ? (
              <LogOut className="size-4" />
            ) : (
              <LogIn className="size-4" />
            )}
            {isClockedIntoThisJob
              ? 'Arbeitszeit beenden'
              : isClockedIntoAnotherJob
                ? 'Zu diesem Auftrag wechseln'
                : 'Arbeitszeit starten'}
          </Button>
        )}
      </div>

      {statusError && (
        <ErrorText className="mt-3">
          Der aktuelle Zeitstatus konnte nicht sicher geladen werden. Nutze die Zeiterfassung erst nach einer Aktualisierung.
        </ErrorText>
      )}
      {loadError ? (
        <div className="mt-4 space-y-3" role="alert">
          <ErrorText>Deine bisherigen Zeiten zu diesem Auftrag konnten nicht geladen werden.</ErrorText>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={isRefreshing}
            onClick={() => startRefresh(() => router.refresh())}
          >
            {isRefreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Erneut laden
          </Button>
        </div>
      ) : sessions.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
          Für dich ist noch keine Arbeitszeit mit diesem Auftrag verknüpft.
        </p>
      ) : (
        <div className="mt-4 divide-y rounded-md border">
          {sessions.map((session, index) => (
            <div key={session.clockIn?.id ?? session.clockOut?.id ?? index} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{session.clockIn ? formatDateTime(session.clockIn.timestamp) : 'Unvollständiger Eintrag'}</p>
                {session.pendingState && session.pendingState !== 'none' && (
                  <p className="text-xs text-muted-foreground">Änderung wartet auf Prüfung</p>
                )}
              </div>
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatDuration(session.durationMinutes)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
