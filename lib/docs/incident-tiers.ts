// Every incident-log entry since the enforcement ladder (decision 0005) names the tier where its
// prevention landed, and a Tier 1 or Tier 2 Prevention line names a mechanism that exists
// (lib/testing/runs/incident-mechanisms.ts). Entries before the ladder are history.

import { INCIDENT_TIER_PATTERN } from '../testing/runs/incident-record';

/** The first incident day the tier rule applies to: the adoption of decision 0005. */
const INCIDENT_TIERS_SINCE = '2026-08-27';

/**
 * Problems of the dated sections of the incident log: a section that names no tier, and a
 * Prevention line whose tier claim `claimProblem` refuses.
 */
export function findIncidentTierProblems(
  markdown: string,
  claimProblem: (preventionLine: string) => string | null,
): string[] {
  const problems: string[] = [];
  for (const section of markdown.split(/^(?=#{2,3} )/m)) {
    const heading = section.split('\n')[0] ?? '';
    const date = heading.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (!heading.startsWith('#') || date === undefined || date < INCIDENT_TIERS_SINCE) continue;
    const title = heading.replace(/^#+ /, '');
    const prevention = section.split('\n').find((line) => line.startsWith('- Prevention:'));
    const claim = prevention === undefined ? null : claimProblem(prevention);
    if (claim !== null) problems.push(`"${title}": ${claim}`);
    if (!INCIDENT_TIER_PATTERN.test(section))
      problems.push(
        `"${title}" names no enforcement tier; end the entry with Tier 1 or Tier 2, "Tier 3: <why no mechanism reaches it>" or "no prevention claim" (decision 0005)`,
      );
  }
  return problems;
}
