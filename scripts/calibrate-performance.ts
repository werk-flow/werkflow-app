import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { captureInputSnapshot } from "../lib/testing/group-evidence";
import { createGroupQualification } from "../lib/testing/group-qualification";
import { getGroupTimingRequirements, getTestGroups } from "../lib/testing/test-groups";
import { checkLatencyEvidence, SCENARIO_ARCHIVE, scenarioObservationSchema } from "../lib/testing/latency-evidence";
import { draftPerformanceBaselines, type CalibrationRun } from "../lib/testing/performance-calibration";
import { readPerformanceBaselines, validatePerformanceBaselines } from "../lib/testing/performance-baselines";
import { MEASURED_SCENARIOS } from "../lib/testing/measured-scenarios";
import { measurementDigest, performanceProtocol, workloadDigest } from "../lib/testing/performance-context";
import { withWorkspaceTestLock } from "../lib/testing/workspace-test-lock";
import { writeJsonAtomically } from "../lib/testing/file-lock";
import { loadEnvLocal } from "../tests/golden/support/env";
import { readRunManifest, runDirectory } from "../tests/golden/support/run-state";

const root = resolve(import.meta.dir, "..");
const argumentsLeft = process.argv.slice(2);
const values = new Map<string, string>();
while (argumentsLeft.length) {
  const name = argumentsLeft.shift()!;
  const value = argumentsLeft.shift();
  if (!["--runs", "--reason", "--scenarios"].includes(name) || values.has(name) || !value || value.startsWith("--")) throw new Error("Use --runs <one-to-three comma-separated run keys> --reason <review reason> [--scenarios <ids>].");
  values.set(name, value);
}
const runKeys = (values.get("--runs") ?? "").split(",").filter(Boolean);
const reason = values.get("--reason") ?? "";
if (!runKeys.length || runKeys.length > 3 || !reason.trim()) throw new Error("Calibration requires one to three owned run keys and a review reason.");
if (runKeys.some((key) => !/^\d{4}-\d{2}-\d{2}T\d{9}Z-[a-f0-9]+$/.test(key))) throw new Error("Calibration requires exact run keys, not paths.");
loadEnvLocal();

await withWorkspaceTestLock({ operation: "draft reviewed performance baselines" }, async () => {
  const groups = getTestGroups(root);
  const snapshot = captureInputSnapshot(root);
  const qualification = createGroupQualification(root, groups, snapshot);
  const runs: CalibrationRun[] = runKeys.map((runKey) => {
    const manifest = readRunManifest(runKey);
    const group = groups.find((entry) => entry.id === manifest.groupId);
    if (!group || !manifest.buildId) throw new Error(`${runKey} has no registered group/build identity.`);
    const evidence = checkLatencyEvidence({ directory: runDirectory(runKey), ...getGroupTimingRequirements(group, groups, root) });
    if (evidence.problems.length) throw new Error(`${runKey} has invalid measurement evidence: ${evidence.problems.join("; ")}`);
    const observations = readFileSync(resolve(runDirectory(runKey), SCENARIO_ARCHIVE), "utf8").split(/\r?\n/).filter(Boolean).map((line) => scenarioObservationSchema.parse(JSON.parse(line)));
    for (const observation of observations) {
      const scenario = MEASURED_SCENARIOS.find((entry) => entry.id === observation.scenarioId)!;
      const protocol = performanceProtocol(scenario);
      if (observation.context.workloadDigest !== workloadDigest(root, scenario, runDirectory(runKey)) || observation.context.measurementDigest !== measurementDigest(root, scenario) || observation.context.protocol !== protocol.protocol || observation.context.role !== protocol.role || observation.backend !== manifest.target) throw new Error(`${runKey}/${scenario.id} has incompatible workload or protocol provenance.`);
    }
    return { runKey, buildId: manifest.buildId, passed: manifest.status === "passed", cleaned: Boolean(manifest.cleanedAt), diagnostic: manifest.lane !== "group", currentInputs: manifest.groupFingerprint === qualification.qualify(group).fingerprint, observations };
  });
  const scenarioIds = values.has("--scenarios") ? values.get("--scenarios")!.split(",") : [...new Set(runs.flatMap((run) => run.observations.map((record) => record.scenarioId)))];
  const recordedAt = new Date().toISOString();
  const draft = draftPerformanceBaselines({ runs, scenarios: MEASURED_SCENARIOS, existing: readPerformanceBaselines(), scenarioIds, reason, reviewedAt: recordedAt });
  const draftProblems = validatePerformanceBaselines(draft, MEASURED_SCENARIOS);
  if (draftProblems.length) throw new Error(`Invalid calibration draft: ${draftProblems.join("; ")}`);
  const directory = resolve(root, ".agent-logs/performance-calibration", recordedAt.replaceAll(":", "").replaceAll(".", ""));
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, "performance-baselines.candidate.json");
  writeJsonAtomically(path, draft);
  console.log(`Draft only: ${path}`);
  console.log("Review the individual samples, comparison tolerance and provenance before copying the reference into lib/testing/performance-baselines.json and marking those scenarios required. This command does not activate a baseline or run a browser.");
});
