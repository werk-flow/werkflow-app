'use client';

import { useState, useEffect, useTransition, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Play,
  Square,
  Loader2,
  X,
  AlertCircle,
  Briefcase,
  ArrowLeftRight,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  clockIn,
  clockOut,
  switchJob,
  getClockStatusWithActiveJob,
  getJobInfoById,
} from '@/lib/time-tracking/actions';
import { useOrganization } from '@/components/organization/organization-context';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { JobPickerModal } from '@/components/job-picker-modal';

type ActiveJobInfo = {
  id: string;
  title: string;
  jobNumber: string | null;
  status: string;
  projectName: string | null;
  clientName: string | null;
};

export function ClockFAB() {
  const router = useRouter();
  const { activeOrgId, activeOrg } = useOrganization();
  const [isPending, startTransition] = useTransition();
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [banner, setBanner] = useState<null | {
    title: string;
    message: string;
  }>(null);
  const [isBannerExiting, setIsBannerExiting] = useState(false);
  const bannerTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [showJobPicker, setShowJobPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'clock_in' | 'switch'>('clock_in');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobInfo, setActiveJobInfo] = useState<ActiveJobInfo | null>(null);
  const [showJobPopover, setShowJobPopover] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const skipNextRealtimeRef = useRef(false);

  const dismissBanner = useCallback(() => {
    setIsBannerExiting(true);
    setTimeout(() => {
      setIsBannerExiting(false);
      setBanner(null);
    }, 150);
  }, []);

  const fetchClockStatus = useCallback(async () => {
    if (!activeOrgId) {
      setIsLoading(false);
      return;
    }

    try {
      const result = await getClockStatusWithActiveJob(activeOrgId);

      if (result.success) {
        setIsClockedIn(result.isClockedIn);
        setActiveJobId(result.activeJobId);
        setStatusError(null);
      } else {
        setStatusError(result.error);
      }
    } catch (err) {
      console.error('Error fetching clock status:', err);
      setStatusError('fetch_failed');
    } finally {
      setIsLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    setIsLoading(true);
    fetchClockStatus();
  }, [fetchClockStatus]);

  useRealtimeEvent('time_entries', () => {
    if (skipNextRealtimeRef.current) {
      skipNextRealtimeRef.current = false;
      return;
    }
    fetchClockStatus();
  });

  // Fetch active job info only when we have a job ID — uses a lightweight
  // single-job lookup instead of loading all org jobs.
  useEffect(() => {
    if (!activeJobId) {
      setActiveJobInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await getJobInfoById(activeJobId);
        if (!cancelled && result.success) {
          setActiveJobInfo(result.job ?? null);
        }
      } catch {
        if (!cancelled) setActiveJobInfo(null);
      }
    })();
    return () => { cancelled = true; };
  }, [activeJobId]);

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
    (mode: 'clock_in' | 'switch') => {
      setPickerMode(mode);
      setShowJobPicker(true);
    },
    []
  );

  const handlePickerConfirm = useCallback(
    (jobId: string | null) => {
      if (!activeOrgId) return;

      if (pickerMode === 'clock_in') {
        startTransition(async () => {
          try {
            const result = await clockIn(activeOrgId, jobId);
            if (result.success) {
              skipNextRealtimeRef.current = true;
              setIsClockedIn(true);
              setActiveJobId(jobId);
              if (result.jobInfo) {
                setActiveJobInfo(result.jobInfo);
              }
              setStatusError(null);
              setShowJobPicker(false);
            } else {
              if (
                result.error === 'working_in_other_org' &&
                'otherOrgName' in result &&
                typeof result.otherOrgName === 'string'
              ) {
                setBanner({
                  title: 'Bereits in anderer Organisation eingestempelt',
                  message: `Du bist aktuell in „${result.otherOrgName}" eingestempelt. Bitte stemple dort zuerst aus, bevor du hier startest.`
                });
                if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
                bannerTimerRef.current = setTimeout(dismissBanner, 6000);
                setStatusError(null);
                setShowJobPicker(false);
              } else {
                setStatusError(result.error);
              }
            }
          } catch (err) {
            console.error('Error clocking in:', err);
            setStatusError('unexpected_error');
          }
        });
      } else {
        startTransition(async () => {
          try {
            const result = await switchJob(activeOrgId, jobId);
            if (result.success) {
              skipNextRealtimeRef.current = true;
              setActiveJobId(jobId);
              if (result.jobInfo) {
                setActiveJobInfo(result.jobInfo);
              }
              setShowJobPicker(false);
            } else {
              setStatusError(result.error);
            }
          } catch (err) {
            console.error('Error switching job:', err);
            setStatusError('unexpected_error');
          }
        });
      }
    },
    [activeOrgId, pickerMode, dismissBanner]
  );

  const handleClockOut = useCallback(() => {
    if (!activeOrgId) return;

    startTransition(async () => {
      try {
        const result = await clockOut(activeOrgId);
        if (result.success) {
          skipNextRealtimeRef.current = true;
          setIsClockedIn(false);
          setActiveJobId(null);
          setStatusError(null);
        } else {
          setStatusError(result.error);
        }
      } catch (err) {
        console.error('Error clocking out:', err);
        setStatusError('unexpected_error');
      }
    });
  }, [activeOrgId]);

  const handleFABClick = useCallback(() => {
    if (isClockedIn) {
      handleClockOut();
    } else {
      openJobPicker('clock_in');
    }
  }, [isClockedIn, handleClockOut, openJobPicker]);

  if (!activeOrgId || !activeOrg) {
    return null;
  }

  if (isLoading) {
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
      {banner && (
        <div
          className={cn(
            'fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-lg',
            isBannerExiting ? 'animate-banner-out' : 'animate-banner-in'
          )}
        >
          <div className="flex items-center gap-3 rounded-lg bg-red-50 p-4 text-red-800 shadow-lg ring-1 ring-red-200/50 dark:bg-red-950 dark:text-red-200 dark:ring-red-800/50">
            <AlertCircle className="size-5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">{banner.title}</p>
              <p className="mt-0.5 text-sm">{banner.message}</p>
            </div>
            <button
              onClick={dismissBanner}
              className="shrink-0 rounded-md p-1 hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
              aria-label="Banner schließen"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

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
            {activeJobInfo && (
              <>
                <button
                  ref={pillRef}
                  type="button"
                  onClick={() => setShowJobPopover((v) => !v)}
                  className="max-w-[180px] rounded-full bg-background/95 px-3 py-1 text-xs font-medium shadow-md ring-1 ring-border truncate cursor-pointer hover:bg-accent/80 transition-colors"
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
                        <p className="font-semibold truncate">{activeJobInfo.title}</p>
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
