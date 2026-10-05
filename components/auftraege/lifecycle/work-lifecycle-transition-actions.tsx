'use client';

import { ParkingCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  getAllowedWorkTransitions,
  isTerminalWorkExecutionState,
  workTransitionActionLabel,
  type WorkBlocker,
  type WorkExecutionState,
  type WorkLifecycleSnapshot,
} from '@/lib/work-lifecycle/types';
import type { WorkLifecycleDialogState } from './work-lifecycle-dialog-state';

type WorkLifecycleTransitionActionsProps = {
  snapshot: WorkLifecycleSnapshot;
  isManager: boolean;
  fieldMode: boolean;
  hasPendingDispatch: boolean;
  readOnly: boolean;
  canStart: boolean;
  parking: WorkBlocker | undefined;
  pendingState: WorkExecutionState | null;
  setDialog: (dialog: WorkLifecycleDialogState | null) => void;
};

/**
 * The state-change buttons of the card, including the field worker's primary
 * next action. Each button names its step; the state itself is the badge in
 * the card header. Cancelling is reversible, so it is an outline action too.
 */
export function WorkLifecycleTransitionActions({
  snapshot,
  isManager,
  fieldMode,
  hasPendingDispatch,
  readOnly,
  canStart,
  parking,
  pendingState,
  setDialog,
}: WorkLifecycleTransitionActionsProps) {
  const transitions = getAllowedWorkTransitions(snapshot.executionState, isManager);
  const primaryFieldTransition =
    snapshot.executionState === 'not_started' || snapshot.executionState === 'interrupted'
      ? 'in_progress'
      : snapshot.executionState === 'in_progress'
        ? 'execution_complete'
        : null;
  const canCompleteExecution =
    snapshot.gates.incompleteRequiredInstructions === 0 &&
    snapshot.gates.reopenedInstructionPredecessors === 0 &&
    snapshot.gates.incompleteInstructionEvidence === 0 &&
    snapshot.gates.openBlockers === 0 &&
    snapshot.gates.openCompletionDependencies === 0 &&
    snapshot.gates.activeJobClocks === 0 &&
    snapshot.gates.incompleteProjectChildren === 0;
  const isFieldTransitionBlocked = (state: WorkExecutionState): boolean =>
    fieldMode &&
    ((state === 'in_progress' && !canStart) || (state === 'execution_complete' && !canCompleteExecution));
  const hasAvailablePrimaryFieldTransition = transitions.some(
    (state) => state === primaryFieldTransition && !isFieldTransitionBlocked(state),
  );

  return (
    <>
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          {transitions.map((state) => {
            const isBlockedFieldTransition = isFieldTransitionBlocked(state);
            const isPrimaryFieldAction =
              fieldMode &&
              !hasPendingDispatch &&
              !isBlockedFieldTransition &&
              state === primaryFieldTransition;
            return (
              <Button
                key={state}
                data-testid={isPrimaryFieldAction ? 'field-primary-next-action' : undefined}
                type="button"
                size="sm"
                variant={isPrimaryFieldAction ? 'default' : 'outline'}
                className={fieldMode ? 'min-h-11' : undefined}
                disabled={isBlockedFieldTransition || pendingState !== null}
                aria-describedby={isBlockedFieldTransition ? 'field-transition-blocked-reason' : undefined}
                title={isBlockedFieldTransition ? 'Kläre zuerst die angezeigten offenen Punkte.' : undefined}
                onClick={() => setDialog({ type: 'transition', state })}
              >
                {workTransitionActionLabel(snapshot.executionState, state)}
              </Button>
            );
          })}
          {fieldMode &&
            !hasPendingDispatch &&
            !readOnly &&
            transitions.length > 0 &&
            !hasAvailablePrimaryFieldTransition && (
              <Button asChild size="sm" className="min-h-11" data-testid="field-primary-next-action">
                <a href="#offene-punkte">Offene Punkte prüfen</a>
              </Button>
            )}
          {isManager && snapshot.targetType === 'project' && !snapshot.isLegacy && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDialog({ type: 'clear-project-override' })}
            >
              Automatisch ableiten
            </Button>
          )}
          {isManager && !parking && !isTerminalWorkExecutionState(snapshot.executionState) && (
            <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ type: 'parking' })}>
              <ParkingCircle className="size-4" />
              Parken
            </Button>
          )}
        </div>
      )}
      {!readOnly && fieldMode && transitions.some(isFieldTransitionBlocked) && (
        <p id="field-transition-blocked-reason" className="text-sm text-muted-foreground">
          Kläre zuerst die angezeigten offenen Punkte.
        </p>
      )}
    </>
  );
}
