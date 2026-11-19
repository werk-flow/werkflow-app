import type { WorkBlocker, WorkDependency, WorkExecutionState } from '@/lib/work-lifecycle/types';

export type WorkTransitionInput = {
  toState: WorkExecutionState;
  reason?: string;
  overrideGates: boolean;
};

export type WorkLifecycleDialogState =
  | { type: 'transition'; state: WorkExecutionState }
  | { type: 'blocker'; blocker?: WorkBlocker }
  | { type: 'parking' }
  | { type: 'resolve-blocker'; blocker: WorkBlocker }
  | { type: 'reopen-blocker'; blocker: WorkBlocker }
  | { type: 'unpark'; blocker: WorkBlocker }
  | { type: 'dependency' }
  | { type: 'artifact-approval-dependency'; dependency: WorkDependency }
  | {
      type: 'dependency-state';
      dependency: WorkDependency;
      state: 'open' | 'satisfied' | 'waived';
    }
  | { type: 'remove-dependency'; dependency: WorkDependency }
  | { type: 'clear-project-override' };

/** What a button that opens a dialog spreads: its press, and its pending while the dialog downloads. */
export type WorkLifecycleDialogOpener = (dialog: WorkLifecycleDialogState) => {
  onClick: () => void;
  pending: boolean;
};

/** Names one opener's dialog: its kind, the blocker or dependency it acts on, and its target state. */
export function workLifecycleDialogKey(dialog: WorkLifecycleDialogState): string {
  const subject =
    'blocker' in dialog ? dialog.blocker?.id : 'dependency' in dialog ? dialog.dependency.id : undefined;
  const state = 'state' in dialog ? dialog.state : undefined;
  return `${dialog.type}:${subject ?? ''}:${state ?? ''}`;
}
