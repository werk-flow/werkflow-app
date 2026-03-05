'use client';

import { useState, useEffect, useTransition, useCallback, useRef } from 'react';
import { Play, Square, Loader2, X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { clockIn, clockOut, getClockStatus } from '@/lib/time-tracking/actions';
import { useOrganization } from '@/components/organization/organization-context';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';

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
      const result = await getClockStatus(activeOrgId);
      if (result.success) {
        setIsClockedIn(result.isClockedIn);
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

  // Fetch on mount and when org changes
  useEffect(() => {
    setIsLoading(true);
    fetchClockStatus();
  }, [fetchClockStatus]);

  // Realtime: refetch when any time_entry changes for this org
  useRealtimeEvent('time_entries', fetchClockStatus);

  // Handle clock in/out
  const handleToggle = useCallback(() => {
    if (!activeOrgId) return;

    startTransition(async () => {
      try {
        if (isClockedIn) {
          const result = await clockOut(activeOrgId);
          if (result.success) {
            setIsClockedIn(false);
            setStatusError(null);
          } else {
            setStatusError(result.error);
          }
        } else {
          const result = await clockIn(activeOrgId);
          if (result.success) {
            setIsClockedIn(true);
            setStatusError(null);
          } else {
            // Special case: show a banner when the user is already working in another org
            if (
              result.error === 'working_in_other_org' &&
              'otherOrgName' in result &&
              typeof result.otherOrgName === 'string'
            ) {
              const title = 'Bereits in anderer Organisation eingestempelt';
              const message = `Du bist aktuell in „${result.otherOrgName}“ eingestempelt. Bitte stemple dort zuerst aus, bevor du hier startest.`;
              setBanner({ title, message });
              // Auto-dismiss after 6 seconds
              if (bannerTimerRef.current) {
                clearTimeout(bannerTimerRef.current);
              }
              bannerTimerRef.current = setTimeout(() => {
                dismissBanner();
              }, 6000);
              setStatusError(null);
            } else {
              setStatusError(result.error);
            }
          }
        }
      } catch (err) {
        console.error('Error toggling clock:', err);
        setStatusError('unexpected_error');
      }
    });
  }, [activeOrgId, isClockedIn, dismissBanner]);

  // Don't show FAB if user has no active org
  if (!activeOrgId || !activeOrg) {
    return null;
  }

  // Show loading state
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

      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
        {/* FAB Button */}
        <Button
          size="icon"
          onClick={handleToggle}
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

        {/* Error indicator */}
        {statusError && (
          <div className="max-w-[200px] rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
            Fehler
          </div>
        )}
      </div>
    </>
  );
}
