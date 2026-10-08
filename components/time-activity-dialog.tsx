'use client';

import { useState } from 'react';

import { JobPickerModal } from '@/components/job-picker-modal';
import { useClockState } from '@/components/clock-state-provider';
import {
  ACTIVITY_OPTIONS,
  TimeActivityJobField,
  TimeActivityKindPicker,
  TimeActivityQualifierFields,
  TimeActivityRecoveryNotice,
  TimeActivityStatusNotice,
} from '@/components/time-activity-fields';
import { Button } from '@/components/ui/button';
import { useBanner } from '@/components/ui/banner';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { useServerAction } from '@/hooks/use-server-action';
import { getTransitionErrorMessage, isSameActivitySelection } from '@/lib/time-tracking/clock-actions';
import type {
  TimeActivitySelection,
  TimeInternalActivity,
  TimeSegmentKind,
  TimeStandbyContext,
  TimeTravelRole,
  TimeTravelRoute,
} from '@/lib/time-tracking/types';

function buildSelection(
  kind: TimeSegmentKind,
  jobId: string | null,
  internalType: TimeInternalActivity,
  travelRoute: TimeTravelRoute,
  travelRole: TimeTravelRole,
  standbyContext: TimeStandbyContext,
): TimeActivitySelection {
  if (kind === 'break') {
    return { kind, allocationKind: 'none' };
  }
  if (kind === 'standby') {
    return { kind, allocationKind: 'none', standbyContext };
  }
  if (kind === 'internal_activity') {
    return { kind, allocationKind: 'internal_activity', internalType };
  }
  if (kind === 'travel') {
    return jobId
      ? { kind, allocationKind: 'job', jobId, travelRoute, travelRole }
      : {
          kind,
          allocationKind: 'unallocated',
          jobId: null,
          travelRoute,
          travelRole,
        };
  }
  return jobId
    ? { kind, allocationKind: 'job', jobId }
    : { kind, allocationKind: 'unallocated', jobId: null };
}

type TimeActivityDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the dialog's own transition was accepted, before it closes. */
  onSettled?: (() => void) | undefined;
  organizationId: string;
  preferredJobId?: string | null;
};

export function TimeActivityDialog(props: TimeActivityDialogProps) {
  return props.open ? <TimeActivityDialogForm {...props} /> : null;
}

function TimeActivityDialogForm({
  open,
  onOpenChange,
  onSettled,
  organizationId,
  preferredJobId = null,
}: TimeActivityDialogProps) {
  const {
    state,
    isReady,
    isPending,
    statusError,
    refresh,
    transitionActivity,
    recoverAndContinue,
    clockOut,
  } = useClockState();
  const { showBanner } = useBanner();
  const current = state?.currentActivity;
  const [kind, setKind] = useState<TimeSegmentKind>(current?.kind ?? 'work');
  const [jobId, setJobId] = useState<string | null>(current?.jobId ?? preferredJobId);
  const [internalType, setInternalType] = useState<TimeInternalActivity>(
    current?.internalType ?? 'internal_work',
  );
  const [travelRoute, setTravelRoute] = useState<TimeTravelRoute>(current?.travelRoute ?? 'unspecified');
  const [travelRole, setTravelRole] = useState<TimeTravelRole>(current?.travelRole ?? 'unspecified');
  const [standbyContext, setStandbyContext] = useState<TimeStandbyContext>(
    current?.standbyContext ?? 'unspecified',
  );
  const [showJobPicker, setShowJobPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each footer button spins for its own call; the shared clock `isPending`
  // only gates both against a double submit.
  const submitAction = useServerAction(submit);
  const endAction = useServerAction(endNow);

  const availableOptions = ACTIVITY_OPTIONS.filter(
    (option) => option.kind !== 'break' || (state?.isClockedIn && state.breakMode === 'manual'),
  );
  const canLinkJob = kind === 'work' || kind === 'travel' || kind === 'callout';
  const knownJob = [state?.activeJobInfo, state?.resumeJobInfo].find((job) => job && job.id === jobId);
  const selectedJobLabel = knownJob ? knownJob.title : jobId ? 'Auftrag ausgewählt' : 'Ohne Auftrag';
  const recovery = Boolean(state?.recoveryReason);
  // Switching to exactly the running activity is not an action: the database
  // would answer `no_change`, and a user who meant to change something would
  // read the closed dialog as a switch that never happened.
  const isUnchanged =
    Boolean(state?.isClockedIn) &&
    !recovery &&
    !state?.legacyOpen &&
    isSameActivitySelection(
      buildSelection(kind, jobId, internalType, travelRoute, travelRole, standbyContext),
      state?.currentActivity,
    );

  async function submit(): Promise<void> {
    setError(null);
    const selection = buildSelection(kind, jobId, internalType, travelRoute, travelRole, standbyContext);
    const result = recovery ? await recoverAndContinue(selection) : await transitionActivity(selection);
    const fallback = 'Die Aktivität konnte nicht gespeichert werden. Bitte versuche es erneut.';
    if (!result.success) {
      if (result.error === 'time_transition_working_other_org' || result.error === 'on_approved_vacation') {
        onOpenChange(false);
        onSettled?.();
        showBanner({ variant: 'error', message: getTransitionErrorMessage(result.error, fallback) });
        return;
      }
      setError(getTransitionErrorMessage(result.error, fallback));
      return;
    }
    if (result.outcome === 'recovery_required') {
      setError('Die Erfassung muss zuerst geprüft werden. Du kannst sie fortsetzen oder jetzt beenden.');
      return;
    }
    onOpenChange(false);
    onSettled?.();
    if (result.notice === 'sickness_reported_today') {
      showBanner({
        variant: 'info',
        message:
          'Für heute liegt eine Krankmeldung vor: Du bist eingestempelt. Bitte prüfe deine Krankmeldung und trage das Enddatum nach, wenn du wieder arbeitest.',
        autoDismissMs: 8000,
      });
    }
  }

  async function endNow(): Promise<void> {
    setError(null);
    const result = await clockOut(recovery);
    if (!result.success) {
      setError('Die Erfassung konnte nicht beendet werden. Bitte versuche es erneut.');
      return;
    }
    if (result.outcome === 'recovery_required') {
      setError('Die Erfassung ist ungewöhnlich lang. Prüfe den Stand und bestätige das Beenden erneut.');
      return;
    }
    onOpenChange(false);
    onSettled?.();
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setError(null);
          onOpenChange(nextOpen);
        }}
        pending={submitAction.isPending || endAction.isPending}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{state?.isClockedIn ? 'Aktivität wechseln' : 'Aktivität wählen'}</DialogTitle>
            <DialogDescription>
              {state?.isClockedIn
                ? 'Wähle, was du gerade machst. Der Wechsel beendet die laufende Aktivität und startet die neue in einem Schritt.'
                : 'Wähle, womit du startest. Angaben zu Strecke, Rolle und Bereitschaft sind freiwillig.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {recovery && <TimeActivityRecoveryNotice />}

            <TimeActivityKindPicker options={availableOptions} kind={kind} onKindChange={setKind} />

            {canLinkJob && (
              <TimeActivityJobField
                selectedJobLabel={selectedJobLabel}
                hasJob={Boolean(jobId)}
                onPickJob={() => setShowJobPicker(true)}
                onClearJob={() => setJobId(null)}
              />
            )}

            <TimeActivityQualifierFields
              kind={kind}
              internalType={internalType}
              onInternalTypeChange={setInternalType}
              travelRoute={travelRoute}
              onTravelRouteChange={setTravelRoute}
              travelRole={travelRole}
              onTravelRoleChange={setTravelRole}
              standbyContext={standbyContext}
              onStandbyContextChange={setStandbyContext}
            />
            <TimeActivityStatusNotice
              isReady={isReady}
              statusError={statusError}
              onRetry={() => void refresh()}
            />
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            {state?.isClockedIn && (
              <Button
                pending={endAction.isPending}
                type="button"
                variant="outline"
                disabled={!isReady || isPending}
                onClick={() => void endAction.run()}
              >
                Erfassung beenden
              </Button>
            )}
            <Button
              pending={submitAction.isPending}
              type="button"
              disabled={!isReady || isPending || isUnchanged}
              onClick={() => void submitAction.run()}
            >
              {recovery ? 'Prüfen und fortsetzen' : state?.isClockedIn ? 'Aktivität wechseln' : 'Starten'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <JobPickerModal
        open={showJobPicker}
        onClose={() => setShowJobPicker(false)}
        onConfirm={(selectedJobId) => {
          setJobId(selectedJobId);
          setShowJobPicker(false);
        }}
        organizationId={organizationId}
        mode={state?.isClockedIn ? 'switch' : 'clock_in'}
        currentJobId={state?.activeJobId ?? null}
        isPending={isPending}
      />
    </>
  );
}
