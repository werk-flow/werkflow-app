import type { IncidentClass } from '../runner/run-policy';

/**
 * The tier rule of a classified failure (decision 0005). `bun run test:runs classify` keeps the
 * diagnosis beside its report: a browser run in its run manifest, any other group in the report's
 * `diagnoses.json`. A failed acceptance run's prevention names its enforcement tier.
 */
const INCIDENT_TIER_PATTERN =
  /\bTier [12]\b|\bTier 3\b[^.\n]*(?::|\bbecause\b|\()|\bno (?:\w+ )*prevention claim\b/i;

/** Authoring and accepted-change are not failures of proven behavior, so they need no tier. */
const UNRECORDED_CLASSES: readonly IncidentClass[] = ['authoring', 'accepted-change'];

/** A failed acceptance run (the group lane) records an incident; focused and diagnostic runs do not. */
export function recordsIncident(
  run: { lane: string; groupId?: string | undefined },
  classification: IncidentClass,
): boolean {
  return run.lane === 'group' && Boolean(run.groupId) && !UNRECORDED_CLASSES.includes(classification);
}

export function incidentPreventionProblem(prevention: string): string | null {
  if (INCIDENT_TIER_PATTERN.test(prevention)) return null;
  return 'The prevention of a failed acceptance run must name its enforcement tier: "Tier 1 ...", "Tier 2 ...", "Tier 3: <why no mechanism reaches it>", or "no prevention claim" (decision 0005).';
}
