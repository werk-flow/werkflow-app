import { ResponsivenessError } from "./live-observation";

/**
 * A single cross-session freshness or readiness sample is judged like a
 * performance median: the target stays the contract, and the approved
 * combined tolerance (25% or 250 ms, whichever is larger) separates ordinary
 * variation from a failure. The measurement engine still records and raises
 * every over-target sample; the freshness and readiness helpers accept a raise
 * inside the tolerance limit, and the evidence check reports it as over target
 * without failing the group. Beyond the limit the sample fails (owner
 * decision, 2026-09-14, after four release runs failed on samples between
 * 2030 ms and 2073 ms against 2000 ms).
 */
const RESPONSIVENESS_TOLERANCE = { relative: 0.25, absoluteMs: 250 } as const;

export function responsivenessLimitMs(targetMs: number): number {
  return targetMs + Math.max(targetMs * RESPONSIVENESS_TOLERANCE.relative, RESPONSIVENESS_TOLERANCE.absoluteMs);
}

/** Runs a measurement; an over-target raise inside the tolerance limit resolves with the measured time. */
export async function toleratingResponsiveness(targetMs: number, measure: () => Promise<number>): Promise<number> {
  try {
    return await measure();
  } catch (error) {
    if (error instanceof ResponsivenessError && error.measurement.measuredMs <= responsivenessLimitMs(targetMs)) return error.measurement.measuredMs;
    throw error;
  }
}
