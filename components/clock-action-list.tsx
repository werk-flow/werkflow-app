'use client';

import { useState } from 'react';
import {
  ArrowLeftRight,
  BriefcaseBusiness,
  Coffee,
  Loader2,
  Play,
  Route,
  SlidersHorizontal,
  Square,
} from 'lucide-react';

import { JobPickerModal } from '@/components/job-picker-modal';
import { useClockState } from '@/components/clock-state-provider';
import { TimeActivityDialog } from '@/components/time-activity-dialog';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { usePendingTask } from '@/hooks/use-server-action';
import {
  deriveClockActions,
  getTransitionErrorMessage,
  selectionForPickedJob,
  type ClockAction,
  type ClockActionIcon,
  type ClockPickerMode,
} from '@/lib/time-tracking/clock-actions';
import type { TimeTransitionResult } from '@/lib/time-tracking/types';
import { cn } from '@/lib/utils';

const ICONS: Record<ClockActionIcon, typeof Play> = {
  work: BriefcaseBusiness,
  travel: Route,
  break: Coffee,
  resume: Play,
  job: ArrowLeftRight,
  end: Square,
  more: SlidersHorizontal,
};

/**
 * The state-aware list of next clock actions (registry: "Clock next actions").
 * One tap per transition, the job carried along; the rare activity kinds and
 * qualifiers sit behind "Weitere Aktivitäten …", which opens the full
 * `TimeActivityDialog`. The clock button's sheet and the Zeiterfassung
 * dashboard render this same list.
 */
export function ClockActionList({
  organizationId,
  onSettled,
  initialPickerMode = null,
  className,
}: {
  organizationId: string;
  /** Called after a transition the list performed was accepted; containers close on it. */
  onSettled?: () => void;
  /** Open the job picker at once, for a hot key whose action is a job choice. */
  initialPickerMode?: ClockPickerMode | null;
  className?: string;
}) {
  const { state, isReady, isPending, statusError, refresh, transitionActivity, recoverAndContinue, clockOut } =
    useClockState();
  const { showBanner } = useBanner();
  const { run, isPending: isRunning } = usePendingTask();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<ClockPickerMode | null>(initialPickerMode);
  const [moreOpen, setMoreOpen] = useState(false);
  const recovery = Boolean(state?.recoveryReason);
  const actions = deriveClockActions(state);
  const busy = !isReady || isPending || isRunning;

  function handleResult(result: TimeTransitionResult, fallback: string): boolean {
    if (!result.success) {
      if (result.error === 'time_transition_working_other_org' || result.error === 'on_approved_vacation') {
        showBanner({ variant: 'error', message: getTransitionErrorMessage(result.error, fallback) });
        onSettled?.();
        return false;
      }
      setError(getTransitionErrorMessage(result.error, fallback));
      return false;
    }
    if (result.outcome === 'recovery_required') {
      setError('Die Erfassung muss zuerst geprüft werden. Du kannst sie fortsetzen oder jetzt beenden.');
      return false;
    }
    if (result.notice === 'sickness_reported_today') {
      showBanner({
        variant: 'info',
        message:
          'Für heute liegt eine Krankmeldung vor: Du bist eingestempelt. Bitte prüfe deine Krankmeldung und trage das Enddatum nach, wenn du wieder arbeitest.',
        autoDismissMs: 8000,
      });
    }
    onSettled?.();
    return true;
  }

  function perform(id: string, task: () => Promise<TimeTransitionResult>, fallback: string): void {
    setError(null);
    setPendingId(id);
    void run(async () => {
      try {
        handleResult(await task(), fallback);
      } finally {
        setPendingId(null);
      }
    });
  }

  function activate(action: ClockAction): void {
    switch (action.kind) {
      case 'transition':
        perform(
          action.id,
          () => (recovery ? recoverAndContinue(action.selection) : transitionActivity(action.selection)),
          'Die Aktivität konnte nicht gespeichert werden. Bitte versuche es erneut.'
        );
        return;
      case 'end':
        perform(action.id, () => clockOut(recovery), 'Die Erfassung konnte nicht beendet werden. Bitte versuche es erneut.');
        return;
      case 'picker':
        setError(null);
        setPickerMode(action.pickerMode);
        return;
      case 'more':
        setError(null);
        setMoreOpen(true);
        return;
    }
  }

  function confirmPickedJob(jobId: string | null): void {
    const mode = pickerMode;
    setPickerMode(null);
    const selection = selectionForPickedJob(state, jobId);
    perform(
      'picked-job',
      () => (recovery ? recoverAndContinue(selection) : transitionActivity(selection)),
      mode === 'clock_in'
        ? 'Das Einstempeln hat nicht funktioniert. Bitte versuche es erneut.'
        : 'Der Auftrag konnte nicht gewechselt werden. Bitte versuche es erneut.'
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {recovery && (
        <div className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground">
          <p className="font-medium">Ungewöhnlich lange Erfassung</p>
          <p className="mt-1">Prüfe den Stand. Jede Aktion unten setzt die Erfassung bewusst fort; „Erfassung beenden“ schließt sie.</p>
        </div>
      )}
      <div className="flex flex-col gap-2" role="group" aria-label="Nächste Aktion">
        {actions.map((action, index) => {
          const Icon = ICONS[action.icon];
          const isPrimary = index === 0 && action.kind !== 'more';
          return (
            <Button
              key={action.id}
              type="button"
              variant={isPrimary ? 'default' : action.kind === 'more' ? 'ghost' : 'outline'}
              className={cn('h-auto min-h-12 w-full justify-start gap-3 px-4 text-left text-base whitespace-normal', action.kind === 'more' && 'text-muted-foreground')}
              disabled={busy}
              onClick={() => activate(action)}
            >
              {pendingId === action.id ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
            </Button>
          );
        })}
      </div>
      {!isReady && (
        <p role="status" className="text-sm text-muted-foreground">
          {statusError ? 'Der Zeitstatus konnte nicht sicher geladen werden.' : 'Zeitstatus wird geladen…'}
        </p>
      )}
      {statusError && (
        <Button type="button" variant="outline" onClick={() => void refresh()}>
          Erneut laden
        </Button>
      )}
      <ErrorText>{error}</ErrorText>

      <JobPickerModal
        open={pickerMode !== null}
        onClose={() => setPickerMode(null)}
        onConfirm={confirmPickedJob}
        organizationId={organizationId}
        mode={pickerMode ?? 'clock_in'}
        currentJobId={state?.activeJobId ?? null}
        isPending={busy}
      />
      <TimeActivityDialog
        open={moreOpen}
        onOpenChange={setMoreOpen}
        onSettled={onSettled}
        organizationId={organizationId}
        preferredJobId={state?.activeJobId ?? state?.resumeActivity?.jobId ?? null}
      />
    </div>
  );
}
