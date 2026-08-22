'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Coffee,
  Play,
  Square,
  Loader2,
  X,
  Briefcase,
  ArrowLeftRight,
  ExternalLink,
} from 'lucide-react';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/components/organization/organization-context';
import { JobPickerModal } from '@/components/job-picker-modal';
import { useClockState } from '@/components/clock-state-provider';

export function ClockFAB() {
  const router = useRouter();
  const { activeOrgId, activeOrg } = useOrganization();
  const {
    state,
    isLoading,
    isPending,
    statusError,
    clockIn,
    clockOut,
    startBreak,
    endBreak,
    switchJob,
  } = useClockState();
  const { showBanner } = useBanner();

  const [showJobPicker, setShowJobPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'clock_in' | 'switch' | 'resume'>(
    'clock_in'
  );
  const [showJobPopover, setShowJobPopover] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const activeClockState =
    state && state.organizationId === activeOrgId ? state : null;
  const isClockedIn = activeClockState?.isClockedIn ?? false;
  const isOnBreak = activeClockState?.isOnBreak ?? false;
  const breakMode = activeClockState?.breakMode ?? 'manual';
  const activeJobId = activeClockState?.activeJobId ?? null;
  const activeJobInfo = activeClockState?.activeJobInfo ?? null;

  useEffect(() => {
    if (!showJobPopover) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        pillRef.current &&
        !pillRef.current.contains(e.target as Node)
      ) {
        setShowJobPopover(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowJobPopover(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showJobPopover]);

  const openJobPicker = useCallback(
    (mode: 'clock_in' | 'switch' | 'resume') => {
      setPickerMode(mode);
      setShowJobPicker(true);
    },
    []
  );

  const handlePickerConfirm = useCallback(
    async (jobId: string | null) => {
      if (!activeOrgId) return;

      if (pickerMode === 'clock_in') {
        try {
          const result = await clockIn(jobId);
          if (result.success) {
            setShowJobPicker(false);
            // P1-08: never block a recovered person, but surface the
            // contradiction visibly so the report gets its end date.
            if (result.notice === 'sickness_reported_today') {
              showBanner({
                variant: 'info',
                message:
                  'Für heute liegt eine Krankmeldung vor: Du bist eingestempelt. Bitte prüfe deine Krankmeldung und trage das Enddatum nach, wenn du wieder arbeitest.',
                autoDismissMs: 8000,
              });
            }
          } else if (
            result.error === 'working_in_other_org' &&
            'otherOrgName' in result &&
            typeof result.otherOrgName === 'string'
          ) {
            showBanner({
              variant: 'error',
              message: `Bereits in anderer Organisation eingestempelt: Du bist aktuell in „${result.otherOrgName}“ eingestempelt. Bitte stemple dort zuerst aus, bevor du hier startest.`,
            });
            setShowJobPicker(false);
          } else if (result.error === 'on_approved_vacation') {
            showBanner({
              variant: 'error',
              message:
                'Heute ist Urlaub genehmigt: Einstempeln ist deshalb nicht möglich. Falls du doch arbeitest, kann eine verantwortliche Person den Urlaub stornieren.',
            });
            setShowJobPicker(false);
          } else {
            showBanner({
              variant: 'error',
              message:
                'Das Einstempeln hat nicht funktioniert. Bitte versuche es erneut.',
            });
          }
        } catch (err) {
          console.error('Error clocking in:', err);
          showBanner({
            variant: 'error',
            message:
              'Das Einstempeln hat nicht funktioniert. Bitte versuche es erneut.',
          });
        }
      } else if (pickerMode === 'switch') {
        try {
          const result = await switchJob(jobId);
          if (result.success) {
            setShowJobPicker(false);
          } else {
            showBanner({
              variant: 'error',
              message:
                'Der Auftragswechsel hat nicht funktioniert. Bitte versuche es erneut.',
            });
          }
        } catch (err) {
          console.error('Error switching job:', err);
          showBanner({
            variant: 'error',
            message:
              'Der Auftragswechsel hat nicht funktioniert. Bitte versuche es erneut.',
          });
        }
      } else {
        try {
          const result = await endBreak(jobId);
          if (result.success) {
            setShowJobPicker(false);
          } else {
            showBanner({
              variant: 'error',
              message:
                'Die Pause konnte nicht beendet werden. Bitte versuche es erneut.',
            });
          }
        } catch (err) {
          console.error('Error ending break:', err);
          showBanner({
            variant: 'error',
            message:
              'Die Pause konnte nicht beendet werden. Bitte versuche es erneut.',
          });
        }
      }
    },
    [activeOrgId, pickerMode, showBanner, clockIn, endBreak, switchJob]
  );

  const handleClockOut = useCallback(() => {
    if (!activeOrgId) return;

    // The result must never be discarded: a failed clock-out means the person
    // silently keeps accruing time.
    void (async () => {
      try {
        const result = await clockOut();
        if (!result.success) {
          showBanner({
            variant: 'error',
            message:
              'Das Ausstempeln hat nicht funktioniert. Bitte versuche es erneut.',
          });
        }
      } catch (err) {
        console.error('Error clocking out:', err);
        showBanner({
          variant: 'error',
          message:
            'Das Ausstempeln hat nicht funktioniert. Bitte versuche es erneut.',
        });
      }
    })();
  }, [activeOrgId, clockOut, showBanner]);

  const handleFABClick = useCallback(() => {
    if (isClockedIn) {
      handleClockOut();
    } else {
      openJobPicker('clock_in');
    }
  }, [isClockedIn, handleClockOut, openJobPicker]);

  const handleBreakClick = useCallback(() => {
    if (!isClockedIn) return;

    if (isOnBreak) {
      openJobPicker('resume');
      return;
    }

    void (async () => {
      try {
        const result = await startBreak();
        if (!result.success) {
          showBanner({
            variant: 'error',
            message:
              'Die Pause konnte nicht gestartet werden. Bitte versuche es erneut.',
          });
        }
      } catch (err) {
        console.error('Error starting break:', err);
        showBanner({
          variant: 'error',
          message:
            'Die Pause konnte nicht gestartet werden. Bitte versuche es erneut.',
        });
      }
    })();
  }, [isClockedIn, isOnBreak, openJobPicker, startBreak, showBanner]);

  if (!activeOrgId || !activeOrg) {
    return null;
  }

  if (isLoading && !activeClockState) {
    return (
      <div className="fixed bottom-6 right-6 z-50 will-change-transform" style={{ contain: 'layout style' }}>
        <Button
          size="icon"
          className="h-14 w-14 rounded-full shadow-lg"
          disabled
        >
          <Loader2 className="h-6 w-6 animate-spin" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <JobPickerModal
        open={showJobPicker}
        onClose={() => setShowJobPicker(false)}
        onConfirm={handlePickerConfirm}
        organizationId={activeOrgId}
        mode={pickerMode}
        currentJobId={activeJobId}
        isPending={isPending}
      />

      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2 will-change-transform" style={{ contain: 'layout style' }}>
        {isClockedIn && (
          <div className="relative flex items-center gap-1.5">
            {!isOnBreak && activeJobInfo && (
              <>
                <button
                  ref={pillRef}
                  type="button"
                  onClick={() => setShowJobPopover((v) => !v)}
                  className="max-w-[180px] rounded-full bg-background/95 px-3 py-1 text-xs font-medium shadow-md ring-1 ring-border truncate cursor-pointer hover:bg-accent/80 transition-colors"
                  title={activeJobInfo.title}
                >
                  <Briefcase className="mr-1 inline-block h-3 w-3 text-muted-foreground" />
                  {activeJobInfo.title}
                </button>

                {showJobPopover && (
                  <div
                    ref={popoverRef}
                    className="absolute bottom-full right-0 mb-2 w-64 rounded-lg border bg-background p-4 shadow-xl animate-in fade-in-0 zoom-in-95 z-50"
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold line-clamp-2 break-words" title={activeJobInfo.title}>
                          {activeJobInfo.title}
                        </p>
                        {activeJobInfo.jobNumber && (
                          <p className="text-xs text-muted-foreground">{activeJobInfo.jobNumber}</p>
                        )}
                      </div>
                      <button
                        onClick={() => setShowJobPopover(false)}
                        className="shrink-0 rounded-md p-0.5 hover:bg-accent transition-colors"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1.5 text-sm">
                      {activeJobInfo.clientName && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Briefcase className="size-3.5 shrink-0" />
                          <span className="truncate">{activeJobInfo.clientName}</span>
                        </div>
                      )}
                      {activeJobInfo.projectName && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Briefcase className="size-3.5 shrink-0" />
                          <span className="truncate">Projekt: {activeJobInfo.projectName}</span>
                        </div>
                      )}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={() => {
                        setShowJobPopover(false);
                        const url = activeJobInfo.jobNumber
                          ? `/auftraege/${encodeURIComponent(activeJobInfo.jobNumber)}`
                          : `/auftraege`;
                        router.push(url);
                      }}
                    >
                      <ExternalLink className="mr-2 size-3.5" />
                      Details anzeigen
                    </Button>
                  </div>
                )}
              </>
            )}
            {!isOnBreak && (
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 rounded-full shadow-md"
                onClick={() => openJobPicker('switch')}
                disabled={isPending}
                title="Auftrag wechseln"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </Button>
            )}
            {breakMode === 'manual' ? (
              <Button
                size="icon"
                variant="outline"
                className={cn(
                  'h-8 w-8 rounded-full shadow-md',
                  isOnBreak &&
                    'border-yellow-500/50 bg-yellow-500/10 text-yellow-700 hover:bg-yellow-500/20 dark:text-yellow-300'
                )}
                onClick={handleBreakClick}
                disabled={isPending}
                title={isOnBreak ? 'Arbeit fortsetzen' : 'Pause starten'}
              >
                {isOnBreak ? (
                  <Play className="h-3.5 w-3.5" />
                ) : (
                  <Coffee className="h-3.5 w-3.5" />
                )}
              </Button>
            ) : null}
          </div>
        )}

        <Button
          size="icon"
          onClick={handleFABClick}
          disabled={isPending || !!statusError}
          className={cn(
            'h-14 w-14 rounded-full shadow-lg transition-all',
            isClockedIn &&
              'animate-pulse bg-destructive hover:bg-destructive/90',
            statusError && 'bg-muted text-muted-foreground'
          )}
          title={isClockedIn ? 'Ausstempeln' : 'Einstempeln'}
        >
          {isPending ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : isClockedIn ? (
            <Square className="h-6 w-6" />
          ) : (
            <Play className="h-6 w-6" />
          )}
        </Button>

        {statusError && (
          <div className="max-w-[200px] rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
            Fehler
          </div>
        )}
      </div>
    </>
  );
}
