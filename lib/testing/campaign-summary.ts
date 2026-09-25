/**
 * The cost of a verification campaign, read from the reports it produced.
 * A slice that spends more than the budget, or collects more harness
 * failures than the budget allows, changes the harness before it closes
 * (protocol, "Campaign budget"); the numbers here are that rule's evidence.
 */
import { INPUT_DRIFT_REASON } from "./group-evidence";
import { BROWSER_INPUT_DRIFT_MESSAGE } from "./test-evidence";

export type CampaignReport = {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "passed" | "failed";
  results: ReadonlyArray<{ groupId: string; status: "passed" | "failed" | "blocked"; startedAt: string; runKey: string | null; reason: string | null }>;
  /** The input snapshot the report ran on: path to content digest. */
  files: Readonly<Record<string, string>>;
};

export type CampaignRun = { runKey: string; classification: string | null };

export type CampaignSummary = {
  since: string;
  reports: number;
  wallClockMinutes: number;
  groupsRun: number;
  groupsReused: number;
  failed: number;
  blocked: number;
  /** Failed browser groups by their run's classification; a failure without a classified run counts as `unclassified`. */
  failuresByClassification: Record<string, number>;
  overBudget: string[];
};

export type CampaignBudget = { wallClockMinutes: number; harnessFailures: number };
/** Four hours of verification or eight harness failures per slice: past either, the harness changes before the slice closes. */
const CAMPAIGN_BUDGET: CampaignBudget = { wallClockMinutes: 240, harnessFailures: 8 };

export function summarizeCampaign(input: { reports: readonly CampaignReport[]; runs: readonly CampaignRun[]; since: string; budget?: CampaignBudget }): CampaignSummary {
  const budget = input.budget ?? CAMPAIGN_BUDGET;
  const classificationOf = new Map(input.runs.map((run) => [run.runKey, run.classification ?? "unclassified"]));
  const reports = input.reports.filter((report) => report.startedAt >= input.since);
  let wallClockMs = 0;
  let groupsRun = 0;
  let groupsReused = 0;
  let failed = 0;
  let blocked = 0;
  const failuresByClassification: Record<string, number> = {};
  for (const report of reports) {
    // An aborted report never completes; its last group start is the end of what it cost.
    const endedAt = report.completedAt ?? report.results.reduce((latest, result) => (result.startedAt > latest ? result.startedAt : latest), report.startedAt);
    wallClockMs += Math.max(0, Date.parse(endedAt) - Date.parse(report.startedAt));
    for (const result of report.results) {
      // A reused result carries the start time of its original execution, before this report began.
      if (result.startedAt < report.startedAt) { groupsReused += 1; continue; }
      groupsRun += 1;
      if (result.status === "blocked") { blocked += 1; continue; }
      if (result.status !== "failed") continue;
      // An attempt the runner voided for input drift was never diagnosed; it is not a failure of anything.
      if (result.reason !== null && (result.reason.startsWith(INPUT_DRIFT_REASON) || result.reason.startsWith(BROWSER_INPUT_DRIFT_MESSAGE))) continue;
      failed += 1;
      const classification = result.runKey ? classificationOf.get(result.runKey) ?? "unclassified" : "static";
      failuresByClassification[classification] = (failuresByClassification[classification] ?? 0) + 1;
    }
  }
  const wallClockMinutes = Math.round(wallClockMs / 60_000);
  const harnessFailures = failuresByClassification.harness ?? 0;
  const overBudget: string[] = [];
  if (wallClockMinutes > budget.wallClockMinutes) overBudget.push(`${wallClockMinutes} minutes of verification against a budget of ${budget.wallClockMinutes}`);
  if (harnessFailures > budget.harnessFailures) overBudget.push(`${harnessFailures} harness failures against a budget of ${budget.harnessFailures}`);
  return { since: input.since, reports: reports.length, wallClockMinutes, groupsRun, groupsReused, failed, blocked, failuresByClassification, overBudget };
}

/** Files whose change counts as a harness change: the runner, the support modules, the configs and the conventions. */
const HARNESS_INPUT = /^(lib\/testing\/|scripts\/|tests\/[^/]+\/support\/|tests\/[^/]+\/global-|playwright\.[^/]*config\.ts$|eslint-rules\/|bunfig\.toml$)/;

function isDriftVoided(reason: string | null): boolean {
  return reason !== null && (reason.startsWith(INPUT_DRIFT_REASON) || reason.startsWith(BROWSER_INPUT_DRIFT_MESSAGE));
}

/**
 * Owner rule of 2026-09-25 (protocol, "Campaign Budget"): the second time a run fails for a reason that
 * is not the product, the harness changes before the next run. Since the last commit, two or more
 * browser failures classified harness or environment refuse the next verification until a harness
 * input differs from the snapshot of the report that holds the latest such failure.
 */
export function campaignGateProblem(input: { reports: readonly CampaignReport[]; runs: readonly CampaignRun[]; since: string; currentFiles: Readonly<Record<string, string>> }): string | undefined {
  const classificationOf = new Map(input.runs.map((run) => [run.runKey, run.classification]));
  const failures: Array<{ report: CampaignReport; groupId: string; classification: string }> = [];
  for (const report of [...input.reports].filter((report) => report.startedAt >= input.since).sort((left, right) => left.startedAt.localeCompare(right.startedAt))) {
    for (const result of report.results) {
      if (result.status !== "failed" || result.startedAt < report.startedAt || isDriftVoided(result.reason) || !result.runKey) continue;
      const classification = classificationOf.get(result.runKey);
      if (classification === "harness" || classification === "environment") failures.push({ report, groupId: result.groupId, classification });
    }
  }
  const latest = failures.at(-1);
  if (failures.length < 2 || !latest) return undefined;
  const paths = new Set([...Object.keys(latest.report.files), ...Object.keys(input.currentFiles)].filter((path) => HARNESS_INPUT.test(path)));
  for (const path of paths) if (latest.report.files[path] !== input.currentFiles[path]) return undefined;
  const named = failures.map((failure) => `${failure.groupId} (${failure.classification}, report ${failure.report.id})`).join(", ");
  return `${failures.length} non-product failures since the last commit: ${named}. No harness input changed since report ${latest.report.id}. Change the harness (a fixture, a runner rule, a convention test, a split of ownership) before the next run; a repeat is not a repair (docs/plans/phase-1/protocol.md, "Campaign Budget").`;
}

export function formatCampaignSummary(summary: CampaignSummary): string {
  const classes = Object.entries(summary.failuresByClassification).sort().map(([name, count]) => `${name} ${count}`).join(", ") || "none";
  const lines = [
    `Campaign since ${summary.since}: ${summary.reports} reports, ${summary.wallClockMinutes} min of verification, ${summary.groupsRun} groups run, ${summary.groupsReused} reused, ${summary.failed} failed (${classes}), ${summary.blocked} blocked.`,
  ];
  for (const problem of summary.overBudget) lines.push(`Over budget: ${problem}. The harness changes before this slice closes (docs/plans/phase-1/protocol.md, "Campaign budget").`);
  return lines.join("\n");
}
