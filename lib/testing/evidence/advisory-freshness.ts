/**
 * The dependency advisory check (`static:dependencies`, scripts/check-dependency-security.ts) asks
 * the registry which installed versions have published advisories. Until 2026-10-23 a change plan
 * ran it only when its inputs changed, so an advisory published later surfaced only on release.
 * Every automatic change plan now selects it and copies a pass only while that pass is under 24 hours
 * old, and the publication gate refuses a push whose newest report holds no such pass. A registry
 * failure stays a failed, unverified check: it never counts as a pass.
 */
import { z } from 'zod';
import type { GroupResult } from './group-evidence';

export const ADVISORY_GROUP_ID = 'static:dependencies';
const ADVISORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A completion time in the future is no evidence of age, so it is not fresh either. */
function completedWithinMaxAge(completedAt: string, now: Date): boolean {
  const age = now.getTime() - Date.parse(completedAt);
  return age >= 0 && age <= ADVISORY_MAX_AGE_MS;
}

/** The advisory pass a plan may copy instead of asking the registry again: the group's reusable pass, if it is under 24 hours old. */
export function freshAdvisoryPass(reusable: GroupResult | undefined, now: Date): GroupResult | undefined {
  return reusable?.status === 'passed' && completedWithinMaxAge(reusable.completedAt, now)
    ? reusable
    : undefined;
}

/** The part of a verification report the gate reads for the advisory check. */
export const advisoryReportSchema = z.object({
  id: z.string(),
  results: z.array(z.object({ groupId: z.string(), status: z.string(), completedAt: z.string() })),
});

/** Why the newest report cannot publish for want of a fresh advisory pass; undefined when it can. */
export function advisoryFreshnessProblem(
  report: z.infer<typeof advisoryReportSchema>,
  now: Date,
): string | undefined {
  const result = report.results.find((candidate) => candidate.groupId === ADVISORY_GROUP_ID);
  if (result?.status === 'passed' && completedWithinMaxAge(result.completedAt, now)) return undefined;
  const found = !result
    ? 'holds no result of it'
    : result.status === 'passed'
      ? `holds a pass from ${result.completedAt}`
      : `holds a ${result.status} result: the advisories are unverified`;
  return `A push needs a passing ${ADVISORY_GROUP_ID} check from the last 24 hours; verification report ${report.id} ${found}. Run: bun run test:verify (the plan runs the check when its pass is older).`;
}
