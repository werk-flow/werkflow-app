import type { Database } from '@/lib/supabase/database.types';
import type { WorkExecutionState } from '@/lib/work-lifecycle/types';

type ProjectChildState = {
  executionState: WorkExecutionState | null;
  status: Database['public']['Enums']['job_status'];
};

export function resolveChildState(child: ProjectChildState): WorkExecutionState {
  if (child.executionState) return child.executionState;
  if (child.status === 'in_bearbeitung') return 'in_progress';
  if (child.status === 'fertig') return 'execution_complete';
  return 'not_started';
}

export function resolveProjectHandoverExecutionState(
  explicitState: WorkExecutionState | null,
  legacyStatus: Database['public']['Enums']['project_status'] | null,
  children: ProjectChildState[],
): WorkExecutionState {
  if (explicitState) return explicitState;
  if (children.length === 0) {
    if (legacyStatus === 'in_bearbeitung') return 'in_progress';
    if (legacyStatus === 'abgeschlossen') return 'execution_complete';
    return 'not_started';
  }

  const childStates = children.map(resolveChildState);
  if (childStates.every((state) => state === 'cancelled')) return 'cancelled';
  if (childStates.every((state) => (
    state === 'execution_complete' || state === 'handed_over' || state === 'cancelled'
  ))) {
    return 'execution_complete';
  }
  if (childStates.some((state) => (
    state === 'in_progress' || state === 'execution_complete' || state === 'handed_over'
  ))) {
    return 'in_progress';
  }
  if (childStates.some((state) => state === 'interrupted')) return 'interrupted';
  return 'not_started';
}
