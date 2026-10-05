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
