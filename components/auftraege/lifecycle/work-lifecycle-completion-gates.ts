import type { LiveClockState } from '@/lib/time-tracking/types';
import type { WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';

type WorkGates = WorkLifecycleSnapshot['gates'];

/**
 * The gates that block „Ausführung abschließen“, in the order a field worker
 * clears them. The server repeats this check in `transition_work_execution`.
 */
const COMPLETION_GATE_KEYS = [
  'activeJobClocks',
  'incompleteRequiredInstructions',
  'reopenedInstructionPredecessors',
  'incompleteInstructionEvidence',
  'openBlockers',
  'openCompletionDependencies',
  'incompleteProjectChildren',
] as const satisfies readonly (keyof WorkGates)[];

export type CompletionGateKey = (typeof COMPLETION_GATE_KEYS)[number];

export type FailingCompletionGate = { key: CompletionGateKey; count: number };

/** Each gate that blocks completing execution, with its open count. Empty when completion may proceed. */
export function failingCompletionGates(gates: WorkGates): FailingCompletionGate[] {
  return COMPLETION_GATE_KEYS.flatMap((key) => (gates[key] > 0 ? [{ key, count: gates[key] }] : []));
}

/** Whose running time holds the clock gate, as far as the viewer's own clock tells. */
export type RunningClockOwner = 'own' | 'own-and-others' | 'others' | 'unknown';

/**
 * The server counts open work and callout time on the job (`activeJobClocks`);
 * travel, breaks and other activities do not hold completion. A legacy open
 * entry carries no activity, so its job stands for it.
 */
function ownClockCountsOnJob(clock: LiveClockState, jobId: string): boolean {
  if (!clock.isClockedIn) return false;
  const activity = clock.currentActivity;
  if (!activity) return clock.legacyOpen && clock.activeJobId === jobId;
  return (activity.kind === 'work' || activity.kind === 'callout') && activity.jobId === jobId;
}

export function runningClockOwner({
  activeJobClocks,
  clock,
  jobId,
}: {
  activeJobClocks: number;
  /** The viewer's clock, or null while it is unknown. */
  clock: LiveClockState | null;
  jobId: string;
}): RunningClockOwner {
  if (!clock) return 'unknown';
  if (!ownClockCountsOnJob(clock, jobId)) return 'others';
  return activeJobClocks > 1 ? 'own-and-others' : 'own';
}
