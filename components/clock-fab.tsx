'use client';

import { Clock3, Coffee, Loader2, Play } from 'lucide-react';
import { useState } from 'react';

import { ClockActionList } from '@/components/clock-action-list';
import { useClockState } from '@/components/clock-state-provider';
import { useOrganization } from '@/components/organization/organization-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SectionError } from '@/components/ui/section-error';
import { usePendingTask } from '@/hooks/use-server-action';
import {
  deriveClockActions,
  describeActivity,
  getTransitionErrorMessage,
  selectClockHotKeys,
  type ClockAction,
  type ClockPickerMode,
} from '@/lib/time-tracking/clock-actions';
import { useBanner } from '@/components/ui/banner';
import { cn } from '@/lib/utils';

function formatBerlinTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
}

export function ClockFAB() {
  const { activeOrgId, activeOrg } = useOrganization();
  const { state, isLoading, isReady, isPending, statusError, refresh, transitionActivity } = useClockState();
  const { showBanner } = useBanner();
  const { run, isPending: isHotKeyRunning } = usePendingTask();
  const [open, setOpen] = useState(false);
  const [sheetPickerMode, setSheetPickerMode] = useState<ClockPickerMode | null>(null);
  const [pendingHotKey, setPendingHotKey] = useState<string | null>(null);

  if (!activeOrgId || !activeOrg) return null;
  const isClockedIn = state?.isClockedIn ?? false;
  const isOnBreak = state?.isOnBreak ?? false;
  const recovery = Boolean(state?.recoveryReason);
  const currentLabel = state?.currentActivity
    ? describeActivity(state.currentActivity, state.activeJobInfo)
    : state?.legacyOpen
      ? 'Laufende Erfassung'
      : null;
  // Hot keys act directly; a job-choice hot key opens the sheet with its picker
  // already open. Recovery hides the hot keys, so they never bypass its review.
  const hotKeys = isClockedIn && !recovery ? selectClockHotKeys(deriveClockActions(state)) : [];
  const busy = !isReady || isPending || isHotKeyRunning;

  function openSheet(pickerMode: ClockPickerMode | null = null): void {
    setSheetPickerMode(pickerMode);
    setOpen(true);
  }

  function activateHotKey(action: ClockAction): void {
    if (action.kind === 'picker') {
      openSheet(action.pickerMode);
      return;
    }
    if (action.kind !== 'transition') return;
    setPendingHotKey(action.id);
    void run(async () => {
      try {
        const result = await transitionActivity(action.selection);
        if (!result.success) {
          showBanner({
            variant: 'error',
            message: getTransitionErrorMessage(
              result.error,
              'Die Aktivität konnte nicht gespeichert werden. Bitte versuche es erneut.'
            ),
          });
        } else if (result.outcome === 'recovery_required') {
          openSheet();
        }
      } finally {
        setPendingHotKey(null);
      }
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent placement="anchored">
          <DialogHeader>
            <DialogTitle>{isClockedIn ? 'Laufende Zeiterfassung' : 'Zeiterfassung starten'}</DialogTitle>
            <DialogDescription>
              {isClockedIn && currentLabel && state?.statusStartedAt
                ? `${currentLabel} · seit ${formatBerlinTime(state.statusStartedAt)} Uhr`
                : 'Wähle, womit du startest. Alles Weitere lässt sich jederzeit wechseln.'}
            </DialogDescription>
          </DialogHeader>
          <ClockActionList
            organizationId={activeOrgId}
            initialPickerMode={sheetPickerMode}
            onSettled={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <div
        className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2 will-change-transform"
        style={{ contain: 'layout style' }}
      >
        {isClockedIn && currentLabel && (
          <button
            type="button"
            onClick={() => openSheet()}
            title="Laufende Zeiterfassung öffnen"
            className="flex min-h-11 max-w-64 items-center rounded-md border bg-background/95 px-3 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="min-w-0 truncate">{currentLabel}</span>
          </button>
        )}
        {hotKeys.map((action) => (
          <Button
            key={action.id}
            type="button"
            variant="outline"
            className="min-h-11 max-w-64 rounded-full bg-background/95 px-4 shadow-md"
            disabled={busy}
            onClick={() => activateHotKey(action)}
          >
            {pendingHotKey === action.id && <Loader2 className="size-4 animate-spin" />}
            <span className="min-w-0 truncate">{action.label}</span>
          </Button>
        ))}
        <Button
          size="icon"
          className={cn(
            'size-14 rounded-full shadow-lg',
            isClockedIn && !isOnBreak && 'bg-success/90 text-success-foreground hover:bg-success animate-green-glow',
            isOnBreak && 'bg-warning/90 text-warning-foreground hover:bg-warning animate-yellow-glow'
          )}
          onClick={() => openSheet()}
          disabled={!isReady || isPending}
          aria-label={isClockedIn ? 'Laufende Zeiterfassung öffnen' : 'Zeiterfassung starten'}
          title={isClockedIn ? 'Zeiterfassung öffnen' : 'Zeiterfassung starten'}
        >
          {isLoading || isPending ? (
            <Loader2 className="size-6 animate-spin" />
          ) : isOnBreak ? (
            <Coffee className="size-6" />
          ) : isClockedIn ? (
            <Clock3 className="size-6" />
          ) : (
            <Play className="size-6" />
          )}
        </Button>
        {statusError && (
          <SectionError
            className="max-w-64 shadow-lg"
            onRetry={() => void refresh()}
            retryLabel="Erneut laden"
          >
            Der Zeitstatus konnte nicht sicher geladen werden.
          </SectionError>
        )}
      </div>
    </>
  );
}
