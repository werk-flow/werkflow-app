import { ResponsivenessError } from './live-observation';

export const LIVE_TARGET_MS = 2_000;
export const TIME_CORRECTION_READY_MS = 5_000;
// Bounds diagnosis, not acceptable responsiveness.
export const LIVE_HARD_BUDGET_MS: Record<'local' | 'cloud', number> = {
  local: 15_000,
  cloud: 15_000,
};

/**
 * A single cross-session freshness or readiness sample is judged like a
 * performance median: the target stays the contract, and the approved
 * combined tolerance (25% or 250 ms, whichever is larger) separates ordinary
 * variation from a failure. The measurement engine records every sample;
 * final evidence qualification rejects samples beyond the limit after the
 * remaining functional checks finish. Inside the limit it reports the sample
 * as over target without failing the group (owner
 * decision, 2026-09-14, after four release runs failed on samples between
 * 2030 ms and 2073 ms against 2000 ms).
 */
const RESPONSIVENESS_TOLERANCE = { relative: 0.25, absoluteMs: 250 } as const;

export function responsivenessLimitMs(targetMs: number): number {
  return (
    targetMs + Math.max(targetMs * RESPONSIVENESS_TOLERANCE.relative, RESPONSIVENESS_TOLERANCE.absoluteMs)
  );
}

/**
 * Finish a correctly observed task after its engine has archived a slow sample.
 * The runner qualifies every recorded sample before cleanup or acceptance.
 * Mutation, missing-result and observation failures still stop this task.
 */
export async function completeRecordedObservation(measure: () => Promise<number>): Promise<number> {
  try {
    return await measure();
  } catch (error) {
    if (
      error instanceof ResponsivenessError &&
      error.measurement.status === 'visible' &&
      error.measurement.correctness === 'observed'
    )
      return error.measurement.measuredMs;
    throw error;
  }
}
