'use client';

import { Clock3, Coffee, Play } from 'lucide-react';
import { useState } from 'react';

import { ClockActionList } from '@/components/clock-action-list';
import { useClockState } from '@/components/clock-state-provider';
import { useOrganization } from '@/components/organization/organization-context';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { cn, formatBerlinTime } from '@/lib/utils';

/** The CSS variable that carries the dock's height to the app layout's bottom reserve. */
const DOCK_HEIGHT_VARIABLE = '--clock-dock-height';

/**
 * Publishes the dock's rendered height while it is mounted (a callback ref with
 * cleanup). The layout pads the page column by it, so a status error or the
 * hot keys' second row on a phone never cover the page's last control.
 */
function publishDockHeight(dock: HTMLDivElement): () => void {
  const root = document.documentElement;
  const observer = new ResizeObserver(() => {
    root.style.setProperty(DOCK_HEIGHT_VARIABLE, `${dock.offsetHeight}px`);
  });
  observer.observe(dock, { box: 'border-box' });
  return () => {
    observer.disconnect();
    root.style.removeProperty(DOCK_HEIGHT_VARIABLE);
  };
}

/** The sheet's open state and the hot keys, which act directly or open the sheet at their picker. */
function useClockFabControls(transitionActivity: ReturnType<typeof useClockState>['transitionActivity']) {
  const { showBanner } = useBanner();
  const { run, isPending: isHotKeyRunning } = usePendingTask();
  const [open, setOpen] = useState(false);
  const [isListRunning, setIsListRunning] = useState(false);
  const [sheetPickerMode, setSheetPickerMode] = useState<ClockPickerMode | null>(null);
  const [pendingHotKey, setPendingHotKey] = useState<string | null>(null);

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
              'Die Aktivität konnte nicht gespeichert werden. Bitte versuche es erneut.',
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

  return {
    isHotKeyRunning,
    open,
    setOpen,
    isListRunning,
    setIsListRunning,
    sheetPickerMode,
    pendingHotKey,
    openSheet,
    activateHotKey,
  };
}

/** The confirmed state for measurements and tests; a pending transition is never "in" or "out". */
function confirmedClockState(clock: {
  isReady: boolean;
  isPending: boolean;
  isOnBreak: boolean;
  isClockedIn: boolean;
}): 'loading' | 'pending' | 'break' | 'in' | 'out' {
  if (!clock.isReady) return 'loading';
  if (clock.isPending) return 'pending';
  if (clock.isOnBreak) return 'break';
  return clock.isClockedIn ? 'in' : 'out';
}

export function ClockFAB() {
  const { activeOrgId, activeOrg } = useOrganization();
  const { state, isLoading, isReady, isPending, statusError, refresh, transitionActivity } = useClockState();
  const controls = useClockFabControls(transitionActivity);

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
  const busy = !isReady || isPending || controls.isHotKeyRunning;

  return (
    <>
      <Dialog
        open={controls.open}
        onOpenChange={controls.setOpen}
        pending={isPending || controls.isListRunning}
      >
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
            initialPickerMode={controls.sheetPickerMode}
            onSettled={() => controls.setOpen(false)}
            onPendingChange={controls.setIsListRunning}
          />
        </DialogContent>
      </Dialog>

      <div
        ref={publishDockHeight}
        data-clock-fab=""
        data-clock-state={confirmedClockState({ isReady, isPending, isOnBreak, isClockedIn })}
        // The dock spans the content column; the app layout reserves its height, so no page control sits under it.
        // On a phone the button keeps the bottom: a late clock read adds the hot keys' row above, not under it.
        className="fixed inset-x-0 bottom-0 z-30 flex items-end gap-3 border-t bg-card px-4 py-2 will-change-transform sm:items-center sm:px-6 md:left-64"
        style={{ contain: 'layout style' }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 self-center sm:flex-row sm:items-center sm:gap-3">
          {statusError ? (
            <SectionError className="min-w-0 flex-1" onRetry={() => void refresh()}>
              Der Zeitstatus konnte nicht sicher geladen werden.
            </SectionError>
          ) : (
            // What runs now, or that nobody is clocked in; empty while the state loads. Inline, not a
            // component: the dock renders with every clock change, and lab counts count components.
            // Two lines keep a job's number and customer readable on a phone.
            <p
              data-clock-status=""
              className={cn(
                'line-clamp-2 min-h-5 min-w-0 break-words text-sm sm:max-w-md',
                isClockedIn ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {!isReady ? null : isClockedIn ? currentLabel : 'Nicht eingestempelt'}
            </p>
          )}
          <ClockHotKeys
            hotKeys={hotKeys}
            pendingHotKey={controls.pendingHotKey}
            busy={busy}
            onActivate={controls.activateHotKey}
          />
        </div>
        <ClockFabButton
          isClockedIn={isClockedIn}
          isOnBreak={isOnBreak}
          pending={isLoading || isPending}
          isReady={isReady}
          onOpen={() => controls.openSheet()}
        />
      </div>
    </>
  );
}

/** The direct actions beside the clock button while a session runs. */
function ClockHotKeys({
  hotKeys,
  pendingHotKey,
  busy,
  onActivate,
}: {
  hotKeys: ClockAction[];
  pendingHotKey: string | null;
  busy: boolean;
  onActivate: (action: ClockAction) => void;
}) {
  if (hotKeys.length === 0) return null;
  return (
    <div className="flex min-w-0 gap-2">
      {hotKeys.map((action) => (
        <Button
          pending={pendingHotKey === action.id}
          key={action.id}
          type="button"
          variant="outline"
          className="min-h-11 min-w-0 flex-1 px-4 sm:max-w-64 sm:flex-initial"
          title={action.label}
          disabled={busy}
          onClick={() => onActivate(action)}
        >
          <span className="min-w-0 truncate">{action.label}</span>
        </Button>
      ))}
    </div>
  );
}

/** The round clock button: green while working, yellow on a break, a play icon while clocked out. */
function ClockFabButton({
  isClockedIn,
  isOnBreak,
  pending,
  isReady,
  onOpen,
}: {
  isClockedIn: boolean;
  isOnBreak: boolean;
  pending: boolean;
  isReady: boolean;
  onOpen: () => void;
}) {
  return (
    <Button
      size="icon"
      className={cn(
        'size-14 rounded-full shadow-lg [&>[data-slot=spinner]]:size-6',
        isClockedIn &&
          !isOnBreak &&
          'bg-success/90 text-success-foreground hover:bg-success animate-green-glow',
        isOnBreak && 'bg-warning/90 text-warning-foreground hover:bg-warning animate-yellow-glow',
      )}
      onClick={onOpen}
      pending={pending}
      disabled={!isReady}
      aria-label={isClockedIn ? 'Laufende Zeiterfassung öffnen' : 'Zeiterfassung starten'}
      title={isClockedIn ? 'Zeiterfassung öffnen' : 'Zeiterfassung starten'}
    >
      {isOnBreak ? (
        <Coffee className="size-6" />
      ) : isClockedIn ? (
        <Clock3 className="size-6" />
      ) : (
        <Play className="size-6" />
      )}
    </Button>
  );
}
