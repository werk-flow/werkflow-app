import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { readBuildReceipt } from "../lib/testing/build-identity";
import { captureInputSnapshot, changedInputs, groupAttemptProblem, groupResultSchema, INPUT_DRIFT_REASON, inputSnapshotSchema, isDocumentationInput, reusableGroupResult } from "../lib/testing/group-evidence";
import { getGroupTimingRequirements, getTestGroups, type TestGroup } from "../lib/testing/test-groups";
import { createGroupQualification, directGroupRetryProblem } from "../lib/testing/group-qualification";
import { writeJsonAtomically } from "../lib/testing/file-lock";
import { withWorkspaceTestLock } from "../lib/testing/workspace-test-lock";
import { runSessionCommand } from "../lib/testing/local-stack-lease";
import { runWithLogCleanup } from "../lib/testing/command-log";
import { loadEnvLocal } from "../tests/golden/support/env";
import { runGroupSchedule } from "../lib/testing/group-schedule";
import { createRunKey, listRunManifests, manifestPath, readRunManifest, runDirectory, type RunManifest } from "../tests/golden/support/run-state";
import { checkLatencyEvidence, latencyEvidenceSchema } from "../lib/testing/latency-evidence";
import { recoveredEnvironmentRuns } from "../lib/testing/group-recovery";
import { selectRequiredGroups } from "../lib/testing/group-selection";
import { browserGroupReuseProblem, unresolvedBrowserGroupIds } from "../lib/testing/browser-group-evidence";
import { INCIDENT_LOG_PATH, releaseAttemptProblem } from "../lib/testing/release-breaker";
import { archiveSizeProblem, prunableArchiveBytes } from "../lib/testing/run-retention";
import { discoverPlaywrightSelection, type DiscoveredPlaywrightTest } from "../lib/testing/playwright-discovery";
import { PREPARED_PLAN_ENV, writePreparedPlan, type PreparedPlan } from "../lib/testing/prepared-plan";
import type { PlaywrightSuite } from "../lib/testing/run-policy";
import { ensureRealtimeHealthy } from "../lib/testing/realtime-health";
import { campaignGateProblem, formatCampaignSummary, summarizeCampaign } from "../lib/testing/campaign-summary";
import { runPlaywrightPreflight } from "./playwright-preflight";
import { lastCommitTime, readCampaignReports } from "./campaign-summary";
import { probeRealtimeReadiness, restartLocalRealtimeContainer } from "./realtime-probe";
import { requireEnv } from "../tests/golden/support/env";

const repository = resolve(import.meta.dir, "..");
const archive = resolve(repository, ".agent-logs/verification");
const BROWSER_KINDS: ReadonlySet<TestGroup["kind"]> = new Set(["golden", "audit", "canary"]);
/** Browser workers share one application server and one local stack; beyond eight the server, not the groups, is the bottleneck. */
const MAX_JOBS = 8;
/** A warm local Realtime tenant confirms a database subscription well under this; a slower answer gets one restart. */
const REALTIME_HEALTHY_MS = 5_000;
const reportSchema = z.object({
  version: z.literal(1), id: z.string(), startedAt: z.string(), completedAt: z.string().nullable(),
  mode: z.enum(["change", "release"]), target: z.enum(["local", "cloud"]),
  status: z.enum(["running", "passed", "failed"]), snapshot: inputSnapshotSchema,
  scope: z.enum(["selected-groups", "all-required-groups"]), jobs: z.number().int().min(1).max(MAX_JOBS),
  selected: z.array(z.string()), results: z.array(groupResultSchema),
  measurements: z.record(z.string(), latencyEvidenceSchema).default({}),
});

function readHistory(): z.infer<typeof reportSchema>[] {
  if (!existsSync(archive)) return [];
  return readdirSync(archive).sort().flatMap((directory) => {
    const file = resolve(archive, directory, "report.json");
    return existsSync(file) ? [reportSchema.parse(JSON.parse(readFileSync(file, "utf8")))] : [];
  });
}

function uncommittedInputChanges(snapshot: z.infer<typeof inputSnapshotSchema>): string[] {
  const options = { cwd: repository, encoding: "utf8" as const, maxBuffer: 16 * 1024 * 1024 };
  const changed = execFileSync("git", ["-c", "core.safecrlf=false", "diff", "--name-only", "-z", "HEAD", "--"], options);
  const added = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], options);
  return [...new Set([...changed.split("\0"), ...added.split("\0")])].filter((file) => file && !isDocumentationInput(file) && (file in snapshot.files || !existsSync(resolve(repository, file))));
}

function parseArguments(): { execute: boolean; mode: "change" | "release"; target: "local" | "cloud"; jobs: number; fresh: boolean; groupIds?: string[] } {
  const args = process.argv.slice(2);
  const execute = args[0] === "run";
  if (!["run", "plan"].includes(args.shift() ?? "")) throw new Error("Use bun run test:plan or bun run test:verify.");
  const values: Record<string, string> = {};
  let fresh = false;
  while (args.length) {
    const name = args.shift()!;
    // `--fresh` runs the selected groups even when a proof exists: harness measurement and calibration need real executions.
    if (name === "--fresh") { fresh = true; continue; }
    if (!["--mode", "--target", "--group", "--jobs"].includes(name) || values[name]) throw new Error(`Unknown or repeated argument: ${name}`);
    const value = args.shift();
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    values[name] = value;
  }
  if (fresh && !values["--group"]) throw new Error("--fresh applies to an explicit --group selection only.");
  return {
    execute,
    fresh,
    jobs: z.coerce.number().int().min(1).max(MAX_JOBS).parse(values["--jobs"] ?? process.env.WERKFLOW_VERIFY_JOBS ?? "1"),
    mode: z.enum(["change", "release"]).parse(values["--mode"] ?? "change"),
    target: z.enum(["local", "cloud"]).parse(values["--target"] ?? "local"),
    ...(values["--group"] ? { groupIds: values["--group"].split(",") } : {}),
  };
}

function commandForGroup(group: TestGroup, target: "local" | "cloud"): string[] {
  switch (group.kind) {
    case "golden": case "audit": case "canary":
      return [process.execPath, "scripts/run-playwright.ts", "group", group.kind, "--group", group.id, "--target", target];
    case "unit": return [process.execPath, "run", "test:unit"];
    case "ui": return [process.execPath, "run", "test:ui"];
    case "sql": return [process.execPath, "scripts/run-sql-assertions.ts", ...group.files];
    case "static": {
      if (!group.script) throw new Error(`Static group ${group.id} declares no package script in lib/testing/test-groups.ts.`);
      return [process.execPath, "run", group.script];
    }
  }
}

/** The manifest of a run the parent named itself; a missing file means Playwright never started. */
function readRunManifestIfPresent(runKey: string): RunManifest | undefined {
  return existsSync(manifestPath(runKey)) ? readRunManifest(runKey) : undefined;
}

async function main(): Promise<void> {
  const options = parseArguments();
  loadEnvLocal();
  const groups = getTestGroups(repository);
  const snapshot = captureInputSnapshot(repository);
  const history = readHistory().filter((report) => report.target === options.target);
  const priorResults = history.flatMap((report) => report.results.map((result) => ({ ...result, snapshot: report.snapshot })));
  const browserHistory = listRunManifests();
  const baseline = history.filter((report) => report.status === "passed" && report.scope === "all-required-groups").at(-1);
  const changed = baseline ? changedInputs(baseline.snapshot, snapshot) : uncommittedInputChanges(snapshot);
  const qualification = createGroupQualification(repository, groups, snapshot);
  const candidates = groups.filter((group) => options.target === "cloud" ? group.kind === "canary" : group.kind !== "canary")
    .filter((group) => options.mode === "release" ? group.kind !== "golden" || group.id === "golden:integrated" : group.id !== "golden:integrated");
  if (options.groupIds?.some((id) => !candidates.some((group) => group.id === id))) throw new Error("Requested group is unknown or incompatible with the target/mode. Use test:plan to list available groups.");
  if (options.mode === "release" && options.groupIds) throw new Error("Release verification cannot omit groups. Use change mode for focused work.");
  const selected = options.groupIds ? candidates.filter((group) => options.groupIds!.includes(group.id)) : candidates;
  const preliminaryPlan = selected.map((group) => {
    const { inputs, fingerprint } = qualification.qualify(group);
    // Cheap current-policy checks always execute, including documentation and catalog validation.
    let reusable = group.kind === "static" || group.kind === "canary" || options.fresh ? undefined : reusableGroupResult({ groupId: group.id, fingerprint, inputs, snapshot, results: priorResults });
    if (reusable && ["golden", "audit"].includes(group.kind) && browserGroupReuseProblem({ result: reusable, target: options.target, runs: browserHistory })) reusable = undefined;
    return { group, fingerprint, reusable, inputs, timing: getGroupTimingRequirements(group, groups, repository) };
  }).sort((left, right) => {
    const order = { static: 0, unit: 1, sql: 2, ui: 3, golden: 4, audit: 4, canary: 4 };
    return order[left.group.kind] - order[right.group.kind];
  });
  const latestResults = new Map([...priorResults].sort((left, right) => left.startedAt.localeCompare(right.startedAt)).map((result) => [result.groupId, result]));
  const unresolved = [...latestResults.values()].filter((result) => result.status !== "passed").map((result) => result.groupId);
  unresolved.push(...unresolvedBrowserGroupIds(browserHistory, options.target));
  unresolved.push(...preliminaryPlan.filter((entry) => !entry.reusable && ["golden", "audit"].includes(entry.group.kind) && reusableGroupResult({ groupId: entry.group.id, fingerprint: entry.fingerprint, results: priorResults })).map((entry) => entry.group.id));
  const required = selectRequiredGroups({ mode: options.mode, groups: preliminaryPlan.map((entry) => ({ id: entry.group.id, kind: entry.group.kind, inputs: entry.inputs })), changedFiles: changed, unresolvedGroupIds: unresolved });
  const planning = options.groupIds || options.target === "cloud" ? preliminaryPlan : preliminaryPlan.filter((entry) => required.includes(entry.group.id));
  const freshBrowserEntries = planning.filter((entry) => !entry.reusable && BROWSER_KINDS.has(entry.group.kind));
  console.log(`Verification ${options.mode}/${options.target}: ${changed.length} changed inputs; ${planning.length} required groups; ${freshBrowserEntries.length} browser groups to run on up to ${options.jobs} workers. Performance, freshness, SQL and setup gates run alone.`);
  if (changed.length > 0 && changed.length <= 12) console.log(`[verify] changed: ${changed.join(", ")}`);
  for (const entry of planning) console.log(`${entry.reusable ? "REUSE" : "RUN  "} ${entry.group.id} | ${entry.inputs.length} qualifying inputs | ${entry.reusable ? `passed ${entry.reusable.completedAt}` : "missing or changed proof"}`);
  // The breaker, the archive guard and the campaign gate refuse in run mode and only warn in plan mode, so the plan still lists what a focused run must prove.
  const refusals = [
    freshBrowserEntries.length ? campaignGateProblem({ reports: readCampaignReports(), runs: listRunManifests().map((run) => ({ runKey: run.runKey, classification: run.classification })), since: lastCommitTime(), currentFiles: snapshot.files }) : undefined,
    options.mode === "release" ? releaseAttemptProblem({ history, current: new Map(preliminaryPlan.map((entry) => [entry.group.id, { fingerprint: entry.fingerprint, inputs: entry.inputs }])), snapshot, incidentLog: readFileSync(resolve(repository, INCIDENT_LOG_PATH), "utf8") }) : undefined,
    freshBrowserEntries.length ? archiveSizeProblem(prunableArchiveBytes(resolve(repository, ".agent-logs/playwright-runs"))) : undefined,
  ].filter((refusal): refusal is string => Boolean(refusal));
  for (const refusal of refusals) console.log(`[verify] refused: ${refusal}`);
  if (!options.execute) return;
  if (refusals.length) throw new Error(refusals.join("\n"));
  await withWorkspaceTestLock({ operation: "independent verification groups" }, async () => {
    if (changedInputs(snapshot, captureInputSnapshot(repository)).length) throw new Error("Inputs changed after planning. Re-plan before executing or reusing results.");
    // One archive scan for the whole run: the retry rules and the reuse checks read this list, not the disk.
    const lockedRuns = listRunManifests();
    const recoveredRunKeys = recoveredEnvironmentRuns(lockedRuns);
    for (const entry of planning) {
      if (!entry.reusable || !["golden", "audit"].includes(entry.group.kind)) continue;
      const invalid = browserGroupReuseProblem({ result: entry.reusable, target: options.target, runs: lockedRuns });
      const latencyProblems = entry.reusable.runKey ? checkLatencyEvidence({ directory: runDirectory(entry.reusable.runKey), ...entry.timing }).problems : ["Missing browser run identity"];
      if (invalid || latencyProblems.length) throw new Error(`Cannot reuse ${entry.group.id}: ${invalid ?? latencyProblems.join("; ")}. Re-plan or diagnose the archived evidence.`);
    }
    const id = `${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}-${randomUUID().slice(0, 8)}`;
    const directory = resolve(archive, id);
    mkdirSync(directory, { recursive: true });
    const report: z.infer<typeof reportSchema> = { version: 1, id, startedAt: new Date().toISOString(), completedAt: null, mode: options.mode, target: options.target, scope: options.groupIds ? "selected-groups" : "all-required-groups", jobs: options.jobs, status: "running", snapshot, selected: planning.map((entry) => entry.group.id), results: [], measurements: {} };
    const planIndex = new Map(planning.map((entry, index) => [entry.group.id, index]));
    // Workers finish in any order; the report lists results in plan order.
    const publish = (): void => {
      report.results.sort((left, right) => (planIndex.get(left.groupId) ?? 0) - (planIndex.get(right.groupId) ?? 0));
      writeJsonAtomically(resolve(directory, "report.json"), report);
    };
    publish();
    // The shared work of a browser run happens once here: the server and backend preflight, one
    // discovery per suite, the run identity per group. Each group runner reads the prepared plan.
    const runKeys = new Map<string, string>();
    if (freshBrowserEntries.length) {
      await runPlaywrightPreflight({ lane: "group", target: options.target, repositoryRoot: repository });
      const discoveries: PreparedPlan["discoveries"] = {};
      for (const suite of new Set(freshBrowserEntries.map((entry) => entry.group.kind as PlaywrightSuite))) {
        const tests: DiscoveredPlaywrightTest[] = discoverPlaywrightSelection({ suite, playwrightArgs: [], repositoryRoot: repository }).tests;
        discoveries[suite] = tests;
        console.log(`[verify] discovered ${tests.length} ${suite} tests`);
      }
      for (const entry of freshBrowserEntries) runKeys.set(entry.group.id, createRunKey());
      const buildId = readBuildReceipt(repository).buildId;
      const preparedPath = resolve(directory, "prepared-plan.json");
      writePreparedPlan(preparedPath, { version: 1, target: options.target, preparedAt: new Date().toISOString(), buildId, discoveries, groups: Object.fromEntries(freshBrowserEntries.map((entry) => [entry.group.id, { fingerprint: entry.fingerprint, runKey: runKeys.get(entry.group.id)! }])) });
      process.env[PREPARED_PLAN_ENV] = preparedPath;
    }
    const controller = new AbortController();
    const stop = (): void => controller.abort(new Error("Verification interrupted; unfinished groups remain unproven."));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      // Only a failed shared prerequisite blocks the groups after it: a static gate, a drift of the
      // inputs, or an interruption. A browser group's own failure never blocks its neighbours.
      let globalBlock: string | undefined;
      await runGroupSchedule({ entries: planning, jobs: options.jobs,
        canOverlap: (entry) => ["audit", "golden"].includes(entry.group.kind) && entry.group.id !== "golden:integrated" && !entry.timing.exclusive,
        run: async (entry) => {
        if (entry.reusable) {
          if (entry.reusable.runKey) report.measurements[entry.group.id] = checkLatencyEvidence({ directory: runDirectory(entry.reusable.runKey), ...entry.timing });
          report.results.push(entry.reusable); publish(); return;
        }
        const startedAt = new Date().toISOString();
        const logPath = resolve(directory, `${entry.group.id.replaceAll(":", "-")}.log`);
        const browser = BROWSER_KINDS.has(entry.group.kind);
        const runKey = runKeys.get(entry.group.id);
        const blocked = globalBlock ?? (entry.group.kind === "static" ? undefined : groupAttemptProblem({ groupId: entry.group.id, fingerprint: entry.fingerprint, inputs: entry.inputs, snapshot, results: priorResults, recoveredRunKeys }))
          ?? (browser ? directGroupRetryProblem({ groupId: entry.group.id, target: options.target, fingerprint: entry.fingerprint, runs: lockedRuns, recoveredRunKeys }) : undefined);
        if (blocked) {
          console.log(`[verify] ${entry.group.id}: blocked; ${blocked}`);
          report.results.push({ groupId: entry.group.id, fingerprint: entry.fingerprint, status: "blocked", startedAt, completedAt: startedAt, durationMs: 0, runKey: null, buildId: null, logPath, reason: blocked });
          publish(); return;
        }
        console.log(`[verify] starting ${entry.group.id}${runKey ? ` as run ${runKey}` : ""}; log ${logPath}`);
        // A timing-sensitive group measures against the local Realtime service; a lagging tenant is
        // restarted before the group, never blamed on the group afterwards.
        if (browser && entry.timing.exclusive && options.target === "local") {
          await ensureRealtimeHealthy({
            probe: () => probeRealtimeReadiness({ url: requireEnv("NEXT_PUBLIC_SUPABASE_URL"), publishableKey: requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), secretKey: requireEnv("SUPABASE_SECRET_KEY") }),
            restart: restartLocalRealtimeContainer,
            maxElapsedMs: REALTIME_HEALTHY_MS,
            log: (line) => console.log(`[verify] ${entry.group.id}: ${line}`),
          });
        }
        const log = createWriteStream(logPath);
        log.on("error", () => undefined);
        let errorMessage: string | undefined;
        let exitCode = 1;
        try {
          exitCode = await runWithLogCleanup({
            command: () => runSessionCommand(commandForGroup(entry.group, options.target), { cwd: repository, env: process.env, signal: controller.signal, onStdout: (chunk) => log.write(chunk), onStderr: (chunk) => log.write(chunk) }),
            closeLog: () => new Promise<void>((done, reject) => log.end((error?: Error | null) => error ? reject(error) : done())),
            reportSecondaryFailure: (error) => console.error(`Log finalization failed: ${String(error)}`),
          });
        } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
        const run = runKey ? readRunManifestIfPresent(runKey) : undefined;
        const current = captureInputSnapshot(repository);
        const drift = changedInputs(snapshot, current);
        const latencyEvidence = run ? checkLatencyEvidence({ directory: runDirectory(run.runKey), ...entry.timing }) : undefined;
        if (latencyEvidence) {
          report.measurements[entry.group.id] = latencyEvidence;
          for (const measured of latencyEvidence.comparisons) console.log(`[verify] ${entry.group.id}/${measured.scenarioId} ${measured.basis === "median" ? `median of ${measured.samples.length} samples` : `sample ${measured.sample}`}: correctness=${measured.correctness}; responsiveness=${measured.responsiveness}; baseline=${measured.comparison.status}`);
          for (const note of latencyEvidence.overTarget) console.log(`[verify] ${entry.group.id}: ${note}`);
        }
        const latencyProblems = latencyEvidence?.problems ?? [];
        const browserQualified = !browser || (run?.status === "passed" && Boolean(run.cleanedAt) && run.target === options.target && run.lane === "group" && run.groupFingerprint === entry.fingerprint && run.buildId === readBuildReceipt(repository).buildId && run.total === run.passed && run.failed === 0 && run.skipped === 0);
        const passed = exitCode === 0 && !drift.length && !latencyProblems.length && browserQualified && !controller.signal.aborted;
        const failureDetails = [errorMessage, drift.length ? `${INPUT_DRIFT_REASON}: ${drift.join(", ")}` : undefined, run?.failures[0]?.message, ...latencyProblems].filter((detail): detail is string => Boolean(detail));
        const reason = passed ? null : failureDetails.join("; ") || `Command exited ${exitCode}; inspect ${logPath}`;
        report.results.push({ groupId: entry.group.id, fingerprint: entry.fingerprint, status: passed ? "passed" : browser && !run ? "blocked" : "failed", startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(startedAt), runKey: run?.runKey ?? null, buildId: run?.buildId ?? null, logPath, reason });
        publish();
        console.log(`[verify] ${entry.group.id}: ${passed ? "passed" : "failed"}${reason ? `; ${reason}` : ""}`);
        if (!passed && (entry.group.kind === "static" || drift.length || controller.signal.aborted)) {
          globalBlock = `Required setup or source validity failed in ${entry.group.id}. ${reason}`;
        }
      } });
      report.status = !controller.signal.aborted && report.results.length === planning.length && report.results.every((result) => result.status === "passed") ? "passed" : "failed";
      if (changedInputs(snapshot, captureInputSnapshot(repository)).length) {
        report.status = "failed";
        console.error("Inputs changed during verification; this report cannot qualify acceptance.");
      }
      if (options.mode === "release" && listRunManifests().some((run) => run.retainedAt && !run.cleanedAt)) {
        report.status = "failed";
        console.error("Release verification requires cleanup of every retained test world.");
      }
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      delete process.env[PREPARED_PLAN_ENV];
      if (report.status === "running") report.status = "failed";
      report.completedAt = new Date().toISOString();
      publish();
    }
    const wallClockMinutes = ((Date.parse(report.completedAt ?? report.startedAt) - Date.parse(report.startedAt)) / 60_000).toFixed(1);
    console.log(`[verify] ${report.status} in ${wallClockMinutes} min (${report.results.filter((result) => result.status === "passed").length} passed, ${report.results.filter((result) => result.status === "failed").length} failed, ${report.results.filter((result) => result.status === "blocked").length} blocked): ${resolve(directory, "report.json")}`);
    // The campaign since the last commit, so the cost of a slice's verification is visible on every run.
    console.log(`[verify] ${formatCampaignSummary(summarizeCampaign({ reports: readCampaignReports(), runs: listRunManifests().map((run) => ({ runKey: run.runKey, classification: run.classification })), since: lastCommitTime() })).replaceAll("\n", "\n[verify] ")}`);
    process.exitCode = report.status === "passed" ? 0 : 1;
  });
}

try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
