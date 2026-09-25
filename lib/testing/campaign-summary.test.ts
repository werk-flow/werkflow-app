import { expect, test } from "bun:test";
import { formatCampaignSummary, summarizeCampaign, type CampaignReport } from "./campaign-summary";
import { BROWSER_INPUT_DRIFT_MESSAGE } from "./test-evidence";

const reports: CampaignReport[] = [
  {
    id: "old", startedAt: "2026-09-20T10:00:00.000Z", completedAt: "2026-09-20T11:00:00.000Z", status: "passed",
    results: [{ groupId: "golden:p1-01", status: "passed", startedAt: "2026-09-20T10:01:00.000Z", runKey: "r0", reason: null }],
  },
  {
    id: "a", startedAt: "2026-09-24T10:00:00.000Z", completedAt: "2026-09-24T11:30:00.000Z", status: "failed",
    results: [
      { groupId: "static:lint", status: "passed", startedAt: "2026-09-24T10:00:10.000Z", runKey: null, reason: null },
      { groupId: "golden:p1-01", status: "passed", startedAt: "2026-09-20T10:01:00.000Z", runKey: "r0", reason: null },
      { groupId: "golden:p1-04", status: "failed", startedAt: "2026-09-24T10:05:00.000Z", runKey: "r1", reason: null },
      { groupId: "audit:wave-3:p1-24a", status: "failed", startedAt: "2026-09-24T10:10:00.000Z", runKey: "r2", reason: null },
      { groupId: "golden:p1-06", status: "blocked", startedAt: "2026-09-24T10:20:00.000Z", runKey: null, reason: null },
    ],
  },
  {
    id: "b", startedAt: "2026-09-24T12:00:00.000Z", completedAt: "2026-09-24T12:30:00.000Z", status: "failed",
    results: [
      { groupId: "static:typecheck", status: "failed", startedAt: "2026-09-24T12:00:05.000Z", runKey: null, reason: "tsc" },
      { groupId: "audit:wave-1:a1", status: "failed", startedAt: "2026-09-24T12:00:06.000Z", runKey: "r3", reason: BROWSER_INPUT_DRIFT_MESSAGE },
    ],
  },
  {
    // Aborted: never completed, so the cost ends with its last group start.
    id: "c", startedAt: "2026-09-24T13:00:00.000Z", completedAt: null, status: "running",
    results: [{ groupId: "golden:p1-02", status: "passed", startedAt: "2026-09-24T13:10:00.000Z", runKey: "r4", reason: null }],
  },
];
const runs = [{ runKey: "r1", classification: "harness" }, { runKey: "r2", classification: null }];

test("the summary counts fresh and reused groups, failures by classification and the wall clock since the given time; a drift-voided attempt is not a failure", () => {
  const summary = summarizeCampaign({ reports, runs, since: "2026-09-24T00:00:00.000Z" });
  expect(summary.reports).toBe(3);
  expect(summary.wallClockMinutes).toBe(130);
  expect(summary.groupsRun).toBe(7);
  expect(summary.groupsReused).toBe(1);
  expect(summary.failed).toBe(3);
  expect(summary.blocked).toBe(1);
  expect(summary.failuresByClassification).toEqual({ harness: 1, unclassified: 1, static: 1 });
  expect(summary.overBudget).toEqual([]);
});

test("a campaign over the budget names the excess and the rule", () => {
  const summary = summarizeCampaign({ reports, runs, since: "2026-09-24T00:00:00.000Z", budget: { wallClockMinutes: 60, harnessFailures: 0 } });
  expect(summary.overBudget).toEqual(["130 minutes of verification against a budget of 60", "1 harness failures against a budget of 0"]);
  const text = formatCampaignSummary(summary);
  expect(text).toContain("3 reports, 130 min of verification, 7 groups run, 1 reused, 3 failed (harness 1, static 1, unclassified 1), 1 blocked");
  expect(text).toContain('The harness changes before this slice closes');
});
