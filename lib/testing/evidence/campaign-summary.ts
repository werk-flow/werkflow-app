/**
 * The cost of a verification campaign, read from the reports it produced.
 * The summary informs; it never blocks a run or closes a slice (decision 0007,
 * amendment 2026-10-01).
 */
import { groupAttemptKey, INPUT_DRIFT_REASON } from './group-evidence';
import { BROWSER_INPUT_DRIFT_MESSAGE } from './test-evidence';

export type CampaignReport = {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'passed' | 'failed';
  results: ReadonlyArray<{
    groupId: string;
    status: 'passed' | 'failed' | 'blocked';
    startedAt: string;
    runKey: string | null;
    reason: string | null;
  }>;
};

/** A classified browser run, or a diagnosed attempt without a run keyed by `groupAttemptKey`. */
export type CampaignRun = { runKey: string; classification: string | null };

export type CampaignSummary = {
  since: string;
  reports: number;
  wallClockMinutes: number;
  groupsRun: number;
  groupsReused: number;
  failed: number;
  blocked: number;
  /** Failed groups by their classification; an unclassified browser failure counts as `unclassified`, an undiagnosed failure without a run as `static`. */
  failuresByClassification: Record<string, number>;
  /** Browser groups executed (passed or failed with a run), the denominator of the false-failure rate. */
  browserGroupsRun: number;
};

/**
 * Failures of proven tests that the tests, not the application, caused:
 * harness plus unclassified. `authoring` (test code that never passed) and
 * `accepted-change` (a stale visual reference after an accepted design) are
 * counted apart (docs/plans/phase-1/protocol.md, campaign line).
 */
const FALSE_FAILURE_CLASSES = ['harness', 'unclassified'] as const;

/** The false-failure rate in percent, or null without browser groups. */
export function falseFailureRate(summary: CampaignSummary): number | null {
  if (!summary.browserGroupsRun) return null;
  const falseFailures = FALSE_FAILURE_CLASSES.reduce(
    (total, name) => total + (summary.failuresByClassification[name] ?? 0),
    0,
  );
  return (falseFailures / summary.browserGroupsRun) * 100;
}

export function summarizeCampaign(input: {
  reports: readonly CampaignReport[];
  runs: readonly CampaignRun[];
  since: string;
}): CampaignSummary {
  const classificationOf = new Map(
    input.runs.map((run) => [run.runKey, run.classification ?? 'unclassified']),
  );
  const reports = input.reports.filter((report) => report.startedAt >= input.since);
  let wallClockMs = 0;
  let groupsRun = 0;
  let groupsReused = 0;
  let failed = 0;
  let blocked = 0;
  let browserGroupsRun = 0;
  const failuresByClassification: Record<string, number> = {};
  for (const report of reports) {
    // An aborted report never completes; its last group start is the end of what it cost.
    const endedAt =
      report.completedAt ??
      report.results.reduce(
        (latest, result) => (result.startedAt > latest ? result.startedAt : latest),
        report.startedAt,
      );
    wallClockMs += Math.max(0, Date.parse(endedAt) - Date.parse(report.startedAt));
    for (const result of report.results) {
      // A reused result carries the start time of its original execution, before this report began.
      if (result.startedAt < report.startedAt) {
        groupsReused += 1;
        continue;
      }
      if (result.status === 'blocked') {
        blocked += 1;
        continue;
      }
      groupsRun += 1;
      // Only a browser group executes with a run key; every other kind has none.
      if (result.runKey) browserGroupsRun += 1;
      if (result.status !== 'failed') continue;
      // An attempt the runner voided for input drift was never diagnosed; it is not a failure of anything.
      if (
        result.reason !== null &&
        (result.reason.startsWith(INPUT_DRIFT_REASON) ||
          result.reason.startsWith(BROWSER_INPUT_DRIFT_MESSAGE))
      )
        continue;
      failed += 1;
      const classification =
        classificationOf.get(result.runKey ?? groupAttemptKey(result)) ??
        (result.runKey ? 'unclassified' : 'static');
      failuresByClassification[classification] = (failuresByClassification[classification] ?? 0) + 1;
    }
  }
  return {
    since: input.since,
    reports: reports.length,
    wallClockMinutes: Math.round(wallClockMs / 60_000),
    groupsRun,
    groupsReused,
    failed,
    blocked,
    failuresByClassification,
    browserGroupsRun,
  };
}

export function formatCampaignSummary(summary: CampaignSummary): string {
  const classes =
    Object.entries(summary.failuresByClassification)
      .sort()
      .map(([name, count]) => `${name} ${count}`)
      .join(', ') || 'none';
  const rate = falseFailureRate(summary);
  const separate = (['authoring', 'accepted-change'] as const)
    .map((name) => `${name} ${summary.failuresByClassification[name] ?? 0}`)
    .join(', ');
  const falseFailures =
    rate === null
      ? 'no browser groups'
      : `false-failure rate ${rate.toFixed(1)} % (harness + unclassified of ${summary.browserGroupsRun} browser groups; ${separate} apart)`;
  return `Campaign since ${summary.since}: ${summary.reports} reports, ${summary.wallClockMinutes} min of verification, ${summary.groupsRun} groups run, ${summary.groupsReused} reused, ${summary.failed} failed (${classes}), ${summary.blocked} blocked; ${falseFailures}.`;
}
