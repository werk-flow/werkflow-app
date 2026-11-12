'use client';

import { ParkingCircle } from 'lucide-react';
import { useState } from 'react';

import { useClockState } from '@/components/clock-state-provider';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import type { LiveClockState } from '@/lib/time-tracking/types';
import {
  isTerminalWorkExecutionState,
  workTransitionActionLabel,
  type WorkBlocker,
  type WorkExecutionState,
  type WorkLifecycleSnapshot,
} from '@/lib/work-lifecycle/types';
import { WorkLifecycleCompletionGateList } from './work-lifecycle-completion-gate-list';
import { failingCompletionGates, runningClockOwner } from './work-lifecycle-completion-gates';
import type { WorkLifecycleDialogState } from './work-lifecycle-dialog-state';

type WorkLifecycleTransitionActionsProps = {
  snapshot: WorkLifecycleSnapshot;
  /** The steps the server accepts from this state for this role (`getAllowedWorkTransitions`). */
  transitions: readonly WorkExecutionState[];
  isManager: boolean;
  fieldMode: boolean;
  hasPendingDispatch: boolean;
  canStart: boolean;
  parking: WorkBlocker | undefined;
  pendingState: WorkExecutionState | null;
  setDialog: (dialog: WorkLifecycleDialogState | null) => void;
  /** Completes execution without the dialog; resolves with the refusal sentence or null. */
  completeExecution: () => Promise<string | null>;
  /** Reads the card's snapshot again. */
  refresh: () => Promise<void>;
};

type FieldTransitionActionsProps = Omit<WorkLifecycleTransitionActionsProps, 'fieldMode'>;

const START_BLOCKED_REASON_ID = 'field-start-blocked-reason';
const COMPLETION_BLOCKED_REASON_ID = 'field-completion-blocked-reason';

/** The manager's project override reset and parking. */
function ManagerTransitionActions({
  snapshot,
  parking,
  setDialog,
}: Pick<WorkLifecycleTransitionActionsProps, 'snapshot' | 'parking' | 'setDialog'>) {
  return (
    <>
      {snapshot.targetType === 'project' && !snapshot.isLegacy && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setDialog({ type: 'clear-project-override' })}
        >
          Automatisch ableiten
        </Button>
      )}
      {!parking && !isTerminalWorkExecutionState(snapshot.executionState) && (
        <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ type: 'parking' })}>
          <ParkingCircle className="size-4" />
          Parken
        </Button>
      )}
    </>
  );
}

/**
 * One button per allowed step. Each button names its step; the state itself
 * is the badge in the card header. Cancelling is reversible, so it is an
 * outline action too.
 */
/*
 * A plain function, not a component: the card re-renders on every snapshot,
 * and one more component layer costs a render per commit (lab componentRenders).
 */
function transitionButtons({
  snapshot,
  transitions,
  fieldMode,
  pendingState,
  setDialog,
  primaryTransition,
  blockedReasonId,
}: Pick<
  WorkLifecycleTransitionActionsProps,
  'snapshot' | 'transitions' | 'fieldMode' | 'pendingState' | 'setDialog'
> & {
  primaryTransition: WorkExecutionState | null;
  /** The id of the text that says why a step waits, or undefined when it may proceed. */
  blockedReasonId: (state: WorkExecutionState) => string | undefined;
}) {
  return transitions.map((state) => {
    const reasonId = blockedReasonId(state);
    const isPrimary = state === primaryTransition;
    return (
      <Button
        key={state}
        data-testid={isPrimary ? 'field-primary-next-action' : undefined}
        type="button"
        size="sm"
        variant={isPrimary ? 'default' : 'outline'}
        className={fieldMode ? 'min-h-11' : undefined}
        disabled={reasonId !== undefined || pendingState !== null}
        aria-describedby={reasonId}
        onClick={() => setDialog({ type: 'transition', state })}
      >
        {workTransitionActionLabel(snapshot.executionState, state)}
      </Button>
    );
  });
}

/**
 * Which field steps wait and why, the one primary next action, and whether
 * ending the worker's own time is all that completion still needs.
 */
function fieldTransitionRules({
  snapshot,
  transitions,
  hasPendingDispatch,
  canStart,
  clock,
}: Pick<
  WorkLifecycleTransitionActionsProps,
  'snapshot' | 'transitions' | 'hasPendingDispatch' | 'canStart'
> & { clock: LiveClockState | null }) {
  const failingGates = failingCompletionGates(snapshot.gates);
  const clockOwner = runningClockOwner({
    activeJobClocks: snapshot.gates.activeJobClocks,
    clock,
    jobId: snapshot.targetId,
  });
  const startBlocked = transitions.includes('in_progress') && !canStart;
  const completionBlocked = transitions.includes('execution_complete') && failingGates.length > 0;
  const blockedReasonId = (state: WorkExecutionState): string | undefined =>
    state === 'in_progress' && startBlocked
      ? START_BLOCKED_REASON_ID
      : state === 'execution_complete' && completionBlocked
        ? COMPLETION_BLOCKED_REASON_ID
        : undefined;
  const primaryCandidate: WorkExecutionState | null =
    snapshot.executionState === 'not_started' || snapshot.executionState === 'interrupted'
      ? 'in_progress'
      : snapshot.executionState === 'in_progress'
        ? 'execution_complete'
        : null;
  const primaryTransition =
    !hasPendingDispatch &&
    primaryCandidate &&
    transitions.includes(primaryCandidate) &&
    !blockedReasonId(primaryCandidate)
      ? primaryCandidate
      : null;
  // Ending the worker's own time is the only open point: that one click is the next action.
  const clockEndCompletes = completionBlocked && failingGates.length === 1 && clockOwner === 'own';
  const showOpenPointsLink =
    !hasPendingDispatch && transitions.length > 0 && primaryTransition === null && !clockEndCompletes;
  return {
    failingGates,
    clockOwner,
    startBlocked,
    completionBlocked,
    blockedReasonId,
    primaryTransition,
    clockEndCompletes,
    showOpenPointsLink,
  };
}

/**
 * The field worker's steps: one primary next action, and under the buttons
 * what a waiting step needs. A waiting completion names each failing gate
 * with the step that clears it.
 */
export function FieldTransitionActions({
  snapshot,
  transitions,
  isManager,
  hasPendingDispatch,
  canStart,
  parking,
  pendingState,
  setDialog,
  completeExecution,
  refresh,
}: FieldTransitionActionsProps) {
  const { state: clock, isReady: clockKnown } = useClockState();
  // Lives here, not in the gate row: once the time ended, the row may leave
  // with the next snapshot while a completion refusal still needs showing.
  const [clockStepRefusal, setClockStepRefusal] = useState<string | null>(null);
  const {
    failingGates,
    clockOwner,
    startBlocked,
    completionBlocked,
    blockedReasonId,
    primaryTransition,
    clockEndCompletes,
    showOpenPointsLink,
  } = fieldTransitionRules({
    snapshot,
    transitions,
    hasPendingDispatch,
    canStart,
    clock: clockKnown ? clock : null,
  });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {transitionButtons({
          snapshot,
          transitions,
          fieldMode: true,
          pendingState,
          setDialog,
          primaryTransition,
          blockedReasonId,
        })}
        {showOpenPointsLink && (
          <Button asChild size="sm" className="min-h-11" data-testid="field-primary-next-action">
            <a href={completionBlocked ? `#${COMPLETION_BLOCKED_REASON_ID}` : '#offene-punkte'}>
              Offene Punkte prüfen
            </a>
          </Button>
        )}
        {isManager && (
          <ManagerTransitionActions snapshot={snapshot} parking={parking} setDialog={setDialog} />
        )}
      </div>
      {startBlocked && (
        <p id={START_BLOCKED_REASON_ID} className="text-sm text-muted-foreground">
          Kläre zuerst die angezeigten offenen Punkte.
        </p>
      )}
      {completionBlocked && (
        <WorkLifecycleCompletionGateList
          id={COMPLETION_BLOCKED_REASON_ID}
          gates={failingGates}
          clockOwner={clockOwner}
          clockEndCompletes={clockEndCompletes}
          clockEndIsPrimary={clockEndCompletes && !hasPendingDispatch}
          completeExecution={completeExecution}
          refreshGates={refresh}
          onRefusal={setClockStepRefusal}
        />
      )}
      {clockStepRefusal && <ErrorText>{clockStepRefusal}</ErrorText>}
    </>
  );
}

/** The manager's and office's state-change buttons of the card; the field work pack uses `FieldTransitionActions`. */
export function WorkLifecycleTransitionActions({
  snapshot,
  transitions,
  isManager,
  parking,
  pendingState,
  setDialog,
}: Pick<
  WorkLifecycleTransitionActionsProps,
  'snapshot' | 'transitions' | 'isManager' | 'parking' | 'pendingState' | 'setDialog'
>) {
  return (
    <div className="flex flex-wrap gap-2">
      {transitionButtons({
        snapshot,
        transitions,
        fieldMode: false,
        pendingState,
        setDialog,
        primaryTransition: null,
        blockedReasonId: () => undefined,
      })}
      {isManager && <ManagerTransitionActions snapshot={snapshot} parking={parking} setDialog={setDialog} />}
    </div>
  );
}
