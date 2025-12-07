'use client';

import { useState, useEffect, useTransition, useCallback } from 'react';
import { Play, Square, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { clockIn, clockOut, getClockStatus } from '@/lib/time-tracking/actions';
import { useOrganization } from '@/components/organization/organization-context';

/**
 * Custom event name for clock status refresh
 * Used to sync FAB state when manual entries are added
 */
export const CLOCK_STATUS_REFRESH_EVENT = 'clockStatusRefresh';

/**
 * Dispatch event to trigger FAB clock status refresh
 * Call this after manual entries are added/approved that might affect clock status
 */
export function dispatchClockStatusRefresh() {
  window.dispatchEvent(new CustomEvent(CLOCK_STATUS_REFRESH_EVENT));
}

export function ClockFAB() {
  const { activeOrgId, activeOrg } = useOrganization();
  const [isPending, startTransition] = useTransition();
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial clock status
  const fetchClockStatus = useCallback(async () => {
    if (!activeOrgId) {
      setIsLoading(false);
      return;
    }

    try {
      const result = await getClockStatus(activeOrgId);
      if (result.success) {
        setIsClockedIn(result.isClockedIn);
        setError(null);
      } else {
        setError(result.error);
      }
    } catch (err) {
      console.error('Error fetching clock status:', err);
      setError('fetch_failed');
    } finally {
      setIsLoading(false);
    }
  }, [activeOrgId]);

  // Fetch clock status on mount and when org changes
  useEffect(() => {
    setIsLoading(true);
    fetchClockStatus();
  }, [fetchClockStatus]);

  // Listen for clock status refresh events (e.g., from manual entry dialog)
  useEffect(() => {
    const handleRefresh = () => {
      fetchClockStatus();
    };

    window.addEventListener(CLOCK_STATUS_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(CLOCK_STATUS_REFRESH_EVENT, handleRefresh);
    };
  }, [fetchClockStatus]);

  // Handle clock in/out
  const handleToggle = useCallback(() => {
    if (!activeOrgId) return;

    startTransition(async () => {
      try {
        if (isClockedIn) {
          // Clock out
          const result = await clockOut(activeOrgId);
          if (result.success) {
            setIsClockedIn(false);
            setError(null);
          } else {
            setError(result.error);
          }
        } else {
          // Clock in
          const result = await clockIn(activeOrgId);
          if (result.success) {
            setIsClockedIn(true);
            setError(null);
          } else {
            setError(result.error);
          }
        }
      } catch (err) {
        console.error('Error toggling clock:', err);
        setError('unexpected_error');
      }
    });
  }, [activeOrgId, isClockedIn]);

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
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {/* FAB Button */}
      <Button
        size="icon"
        onClick={handleToggle}
        disabled={isPending || !!error}
        className={cn(
          'h-14 w-14 rounded-full shadow-lg transition-all',
          isClockedIn && 'animate-pulse bg-destructive hover:bg-destructive/90',
          error && 'bg-muted text-muted-foreground'
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
      {error && (
        <div className="max-w-[200px] rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
          Fehler beim Laden
        </div>
      )}
    </div>
  );
}
