'use client';

import { useState, useEffect, useTransition, useCallback, useRef } from 'react';
import {
  Play,
  Square,
  Loader2,
  X,
  AlertCircle,
  Briefcase,
  ArrowLeftRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  clockIn,
  clockOut,
  getClockStatus,
  getActiveJobId,
  switchJob,
  getJobsForPicker,
} from '@/lib/time-tracking/actions';
import { useOrganization } from '@/components/organization/organization-context';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { JobPickerModal } from '@/components/job-picker-modal';

export function ClockFAB() {
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
  const [activeJobTitle, setActiveJobTitle] = useState<string | null>(null);

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
      const [statusResult, activeResult] = await Promise.all([
        getClockStatus(activeOrgId),
        getActiveJobId(activeOrgId)
      ]);

      if (statusResult.success) {
        setIsClockedIn(statusResult.isClockedIn);
        setStatusError(null);
      } else {
        setStatusError(statusResult.error);
      }

      if (activeResult.success) {
        setActiveJobId(activeResult.jobId);
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

  useRealtimeEvent('time_entries', fetchClockStatus);

  const fetchActiveJobTitle = useCallback(async () => {
    if (!activeJobId || !activeOrgId) {
      setActiveJobTitle(null);
      return;
    }
    try {
      const result = await getJobsForPicker(activeOrgId);
      if (result.success) {
        const job = result.jobs.find((j) => j.id === activeJobId);
        setActiveJobTitle(job?.title ?? null);
      }
    } catch {
      setActiveJobTitle(null);
    }
  }, [activeJobId, activeOrgId]);

  useEffect(() => {
    fetchActiveJobTitle();
  }, [fetchActiveJobTitle]);

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
              setIsClockedIn(true);
              setActiveJobId(jobId);
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
              setActiveJobId(jobId);
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
      <div className="fixed bottom-6 right-6 z-50">
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
            isBannerExiting ? 'animate-out' : 'animate-in'
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

      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
        {isClockedIn && (
          <div className="flex items-center gap-1.5">
            {activeJobTitle && (
              <div className="max-w-[180px] rounded-full bg-background/90 px-3 py-1 text-xs font-medium shadow-md ring-1 ring-border backdrop-blur-sm truncate">
                <Briefcase className="mr-1 inline-block h-3 w-3 text-muted-foreground" />
                {activeJobTitle}
              </div>
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
