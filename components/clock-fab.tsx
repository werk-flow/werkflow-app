'use client';

import { Clock3, Loader2, Play } from 'lucide-react';
import { useState } from 'react';

import { useClockState } from '@/components/clock-state-provider';
import { useOrganization } from '@/components/organization/organization-context';
import { TimeActivityDialog } from '@/components/time-activity-dialog';
import { Button } from '@/components/ui/button';
import { TIME_ACTIVITY_LABELS } from '@/lib/time-tracking/types';

export function ClockFAB() {
  const { activeOrgId, activeOrg } = useOrganization();
  const { state, isLoading, isPending, statusError, refresh } = useClockState();
  const [open, setOpen] = useState(false);

  if (!activeOrgId || !activeOrg) return null;
  const isClockedIn = state?.isClockedIn ?? false;
  const currentLabel = state?.currentActivity
    ? TIME_ACTIVITY_LABELS[state.currentActivity.kind]
    : state?.legacyOpen
      ? 'Laufende Erfassung'
      : null;

  return (
    <>
      <TimeActivityDialog open={open} onOpenChange={setOpen} organizationId={activeOrgId} />
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2 will-change-transform" style={{ contain: 'layout style' }}>
        {isClockedIn && currentLabel && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            title="Laufende Zeiterfassung öffnen"
            className="flex min-h-11 max-w-64 items-center rounded-md border bg-background/95 px-3 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {currentLabel}
            {state?.activeJobInfo ? ` · ${state.activeJobInfo.title}` : ''}
          </button>
        )}
        <Button
          size="icon"
          className="size-14 rounded-full shadow-lg"
          onClick={() => setOpen(true)}
          disabled={isLoading || isPending || Boolean(statusError)}
          aria-label={isClockedIn ? 'Laufende Zeiterfassung öffnen' : 'Zeiterfassung starten'}
          title={isClockedIn ? 'Zeiterfassung öffnen' : 'Zeiterfassung starten'}
        >
          {isLoading || isPending ? (
            <Loader2 className="size-6 animate-spin" />
          ) : isClockedIn ? (
            <Clock3 className="size-6" />
          ) : (
            <Play className="size-6" />
          )}
        </Button>
        {statusError && (
          <div className="max-w-56 rounded-md bg-destructive/10 px-2 py-2 text-xs text-destructive" role="alert">
            <p>Der Zeitstatus konnte nicht sicher geladen werden.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 min-h-11"
              onClick={() => void refresh()}
            >
              Erneut laden
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
