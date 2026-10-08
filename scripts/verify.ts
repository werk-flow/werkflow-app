import { withVerificationReport } from '../lib/testing/runner/verification-lifecycle';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { readBuildReceipt } from '../lib/testing/evidence/build-identity';
import {
  captureInputSnapshot,
  changedInputs,
  groupAttemptKey,
  groupAttemptProblem,
  groupResultSchema,
  INPUT_DRIFT_REASON,
  inputSnapshotSchema,
  isDocumentationInput,
  reusableGroupResult,
} from '../lib/testing/evidence/group-evidence';
import {
  getGroupTimingRequirements,
  getTestGroups,
  isPerformanceSpec,
  isReleaseOnlySpec,
  type TestGroup,
} from '../lib/testing/selection/test-groups';
import {
  createGroupQualification,
  directGroupRetryProblem,
} from '../lib/testing/evidence/group-qualification';
import { writeJsonAtomically } from '../lib/testing/runner/file-lock';
import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';
import { runSessionCommand } from '../lib/testing/local-stack/local-stack-lease';
import { runWithLogCleanup } from '../lib/testing/runner/command-log';
import { loadEnvLocal } from '../tests/golden/support/env';
import {
  changedTestsFirstBlock,
  runGroupSchedule,
  waitOutsideMidnightWindow,
} from '../lib/testing/runner/group-schedule';
import {
  createRunKey,
  listRunManifests,
  manifestPath,
  readRunManifest,
  runDirectory,
  type RunManifest,
} from '../tests/golden/support/run-state';
import { checkLatencyEvidence, latencyEvidenceSchema } from '../lib/testing/latency-evidence';
import { recoveredEnvironmentRuns } from '../lib/testing/runner/group-recovery';
import { readGroupDiagnoses, recoveredGroupAttempts } from '../lib/testing/evidence/group-diagnosis';
import {
  changedTestTier,
  groupSelections,
  measuredGroupsForChange,
  passedSinceSelection,
  selectionBaseline,
} from '../lib/testing/selection/group-selection';
import { calculateCandidateFingerprint } from '../lib/testing/evidence/candidate-identity';
import {
  browserGroupReuseProblem,
  unclassifiedFailureProblem,
  unresolvedBrowserGroupIds,
} from '../lib/testing/evidence/browser-group-evidence';
import { INCIDENT_LOG_PATH, releaseAttemptProblem } from '../lib/testing/publication/release-breaker';
import { browserStorageProblem } from '../lib/testing/runs/run-retention';
import {
  discoverPlaywrightSelection,
  selectedDiscoveryArguments,
  type DiscoveredPlaywrightTest,
} from '../lib/testing/runner/playwright-discovery';
import { PREPARED_PLAN_ENV, writePreparedPlan, type PreparedPlan } from '../lib/testing/runner/prepared-plan';
import type { PlaywrightSuite } from '../lib/testing/runner/run-policy';
import { ensureRealtimeHealthy } from '../lib/testing/local-stack/realtime-health';
import { formatCampaignSummary, summarizeCampaign } from '../lib/testing/evidence/campaign-summary';
import { runPlaywrightPreflight } from './playwright-preflight';
import { lastCommitTime, readCampaignReports } from './campaign-summary';
import { probeRealtimeReadiness, restartLocalRealtimeContainer } from './realtime-probe';
import { requireEnv } from '../tests/golden/support/env';
import { getR2Endpoint } from '../lib/storage/r2';
import {
  backendDownBeforeGroupReason,
  backendHealthAfterFailureNote,
  backendHealthBeforeGroup,
  backendHealthProbes,
  checkBackendHealth,
  type BackendHealth,
} from '../lib/testing/runner/backend-health';

const repository = resolve(import.meta.dir, '..');
const archive = resolve(repository, '.agent-logs/verification');
const BROWSER_KINDS: ReadonlySet<TestGroup['kind']> = new Set(['golden', 'audit', 'canary']);
/** Browser workers share one application server and one local stack; beyond eight the server, not the groups, is the bottleneck. */
const MAX_JOBS = 8;
/** A warm local Realtime tenant confirms a database subscription well under this; a slower answer gets one restart. */
const REALTIME_HEALTHY_MS = 5_000;
const reportSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  mode: z.enum(['change', 'release']),
  target: z.enum(['local', 'cloud']),
  status: z.enum(['running', 'passed', 'failed']),
  snapshot: inputSnapshotSchema,
  scope: z.enum(['selected-groups', 'all-required-groups']),
  jobs: z.number().int().min(1).max(MAX_JOBS),
  selected: z.array(z.string()),
  results: z.array(groupResultSchema),
  /** Why each group was selected and which changed files selected it. */
  selection: z
    .record(z.string(), z.object({ reason: z.string(), changedFiles: z.array(z.string()) }))
    .default({}),
  measurements: z.record(z.string(), latencyEvidenceSchema).default({}),
});

function readHistory(): z.infer<typeof reportSchema>[] {
  if (!existsSync(archive)) return [];
  return readdirSync(archive)
    .sort()
    .flatMap((directory) => {
      const file = resolve(archive, directory, 'report.json');
      return existsSync(file) ? [reportSchema.parse(JSON.parse(readFileSync(file, 'utf8')))] : [];
    });
}

function uncommittedInputChanges(snapshot: z.infer<typeof inputSnapshotSchema>): string[] {
  const options = { cwd: repository, encoding: 'utf8' as const, maxBuffer: 16 * 1024 * 1024 };
  const changed = execFileSync(
    'git',
    ['-c', 'core.safecrlf=false', 'diff', '--name-only', '-z', 'HEAD', '--'],
    options,
  );
  const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], options);
  return [...new Set([...changed.split('\0'), ...added.split('\0')])].filter(
    (file) =>
      file &&
      !isDocumentationInput(file) &&
      (file in snapshot.files || !existsSync(resolve(repository, file))),
  );
}

function parseArguments(): {
  execute: boolean;
  mode: 'change' | 'release';
  target: 'local' | 'cloud';
  jobs: number;
  fresh: boolean;
  groupIds?: string[];
} {
  const args = process.argv.slice(2);
  const execute = args[0] === 'run';
  if (!['run', 'plan'].includes(args.shift() ?? ''))
    throw new Error('Use bun run test:plan or bun run test:verify.');
  const values: Record<string, string> = {};
  let fresh = false;
  while (args.length) {
    const name = args.shift()!;
    // `--fresh` runs the selected groups even when a proof exists: harness measurement and calibration need real executions.
    if (name === '--fresh') {
      fresh = true;
      continue;
    }
    if (!['--mode', '--target', '--group', '--jobs'].includes(name) || values[name])
      throw new Error(`Unknown or repeated argument: ${name}`);
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    values[name] = value;
  }
  if (fresh && !values['--group']) throw new Error('--fresh applies to an explicit --group selection only.');
  return {
    execute,
    fresh,
    jobs: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_JOBS)
      .parse(values['--jobs'] ?? process.env.WERKFLOW_VERIFY_JOBS ?? '1'),
    mode: z.enum(['change', 'release']).parse(values['--mode'] ?? 'change'),
    target: z.enum(['local', 'cloud']).parse(values['--target'] ?? 'local'),
    ...(values['--group'] ? { groupIds: values['--group'].split(',') } : {}),
  };
}

function commandForGroup(group: TestGroup, target: 'local' | 'cloud'): string[] {
  switch (group.kind) {
    case 'golden':
    case 'audit':
    case 'canary':
      return [
        process.execPath,
        'scripts/run-playwright.ts',
        'group',
        group.kind,
        '--group',
        group.id,
        '--target',
        target,
      ];
    case 'unit':
      return [process.execPath, 'run', 'test:unit'];
    case 'ui':
      return [process.execPath, 'run', 'test:ui'];
    case 'sql':
      return [process.execPath, 'scripts/run-sql-assertions.ts', ...group.files];
    case 'static': {
      if (!group.script)
        throw new Error(
          `Static group ${group.id} declares no package script in lib/testing/selection/test-groups.ts.`,
        );
      return [process.execPath, 'run', group.script];
    }
  }
}

/** The manifest of a run the parent named itself; a missing file means Playwright never started. */
function readRunManifestIfPresent(runKey: string): RunManifest | undefined {
  return existsSync(manifestPath(runKey)) ? readRunManifest(runKey) : undefined;
}

/** One bounded probe of the application-to-backend path a browser group writes through. */
function probeBrowserBackend(): Promise<BackendHealth> {
  return checkBackendHealth(
    backendHealthProbes({
      appOrigin: 'http://localhost:3000',
      supabaseUrl: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
      publishableKey: requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
      storageEndpoint: getR2Endpoint(),
    }),
  );
}

async function main(): Promise<void> {
  const options = parseArguments();
  loadEnvLocal();
  const planningStarted = performance.now();
  console.log('[verify] Reading current inputs and prior evidence...');
  const groups = getTestGroups(repository);
  const snapshot = captureInputSnapshot(repository);
  const history = readHistory().filter((report) => report.target === options.target);
  const priorResults = history.flatMap((report) =>
    report.results.map((result) => ({ ...result, snapshot: report.snapshot })),
  );
  const browserHistory = listRunManifests();
  const baseline = selectionBaseline(history);
  const changed = baseline ? changedInputs(baseline.snapshot, snapshot) : uncommittedInputChanges(snapshot);
  console.log(
    `[verify] Inputs and history read in ${((performance.now() - planningStarted) / 1000).toFixed(1)}s; qualifying groups...`,
  );
  const qualification = createGroupQualification(repository, groups, snapshot);
  const candidates = groups.filter((group) =>
    options.target === 'cloud' ? group.kind === 'canary' : group.kind !== 'canary',
  );
  if (options.groupIds?.some((id) => !candidates.some((group) => group.id === id)))
    throw new Error(
      'Requested group is unknown or incompatible with the target/mode. Use test:plan to list available groups.',
    );
  if (options.mode === 'release' && options.groupIds)
    throw new Error('Release verification cannot omit groups. Use change mode for focused work.');
  const selected = options.groupIds
    ? candidates.filter((group) => options.groupIds!.includes(group.id))
    : candidates;
  const qualified = selected
    .map((group) => ({
      group,
      ...qualification.qualify(group),
      timing: getGroupTimingRequirements(group, repository),
      // Deadlines fail a group in release mode and for an explicitly requested performance group; elsewhere they are recorded.
      enforceDeadlines: options.mode === 'release' || group.files.some(isPerformanceSpec),
    }))
    .map((entry) => ({
      ...entry,
      // Changed-spec-first: in a change plan, browser groups whose own test code changed run first.
      tier:
        options.mode === 'change' && BROWSER_KINDS.has(entry.group.kind)
          ? changedTestTier(entry.executionInputs, changed)
          : -1,
    }))
    .sort((left, right) => {
      const order = { static: 0, unit: 1, sql: 2, ui: 3, golden: 4, audit: 4, canary: 4 };
      return order[left.group.kind] - order[right.group.kind] || left.tier - right.tier;
    });
  const latestResults = new Map(
    [...priorResults]
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .map((result) => [result.groupId, result]),
  );
  const unresolved = [...latestResults.values()]
    .filter((result) => result.status !== 'passed')
    .map((result) => result.groupId);
  unresolved.push(...unresolvedBrowserGroupIds(browserHistory, options.target));
  const selections = groupSelections({
    mode: options.mode,
    groups: qualified.map((entry) => ({
      id: entry.group.id,
      kind: entry.group.kind,
      scopes: entry.group.scopes,
      executionInputs: entry.executionInputs,
      releaseOnly: entry.group.files.some(isReleaseOnlySpec),
    })),
    changedFiles: changed,
    unresolvedGroupIds: unresolved,
  });
  const automatic = !options.groupIds && options.target !== 'cloud';
  const planning = (automatic ? qualified.filter((entry) => selections.has(entry.group.id)) : qualified).map(
    (entry) => {
      // Cheap current-policy checks always execute, including documentation and catalog validation.
      let reusable =
        entry.group.kind === 'static' || entry.group.kind === 'canary' || options.fresh
          ? undefined
          : reusableGroupResult({
              groupId: entry.group.id,
              fingerprint: entry.fingerprint,
              inputs: entry.inputs,
              snapshot,
              results: priorResults,
            });
      // A browser proof fingerprints test code only, so its pass must also have run on the current content of the files that selected it.
      if (
        reusable &&
        ['golden', 'audit'].includes(entry.group.kind) &&
        (!reusable.snapshot ||
          !reusable.runKey ||
          !passedSinceSelection({
            then: reusable.snapshot.files,
            now: snapshot.files,
            selection: automatic ? selections.get(entry.group.id) : undefined,
          }) ||
          browserGroupReuseProblem({ result: reusable, target: options.target, runs: browserHistory }) ||
          checkLatencyEvidence({
            directory: runDirectory(reusable.runKey),
            ...entry.timing,
            enforceDeadlines: entry.enforceDeadlines,
          }).problems.length)
      )
        reusable = undefined;
      return { ...entry, reusable };
    },
  );
  const freshBrowserEntries = planning.filter(
    (entry) => !entry.reusable && BROWSER_KINDS.has(entry.group.kind),
  );
  const repairing =
    automatic &&
    options.mode === 'change' &&
    planning.some((entry) => selections.get(entry.group.id)?.reason.startsWith('Repair'));
  console.log(`[verify] Plan prepared in ${((performance.now() - planningStarted) / 1000).toFixed(1)}s.`);
  console.log(
    `Verification ${options.mode}/${options.target}: ${changed.length} changed inputs since ${baseline ? `report ${baseline.id}` : 'HEAD'}; ${planning.length} required groups; ${freshBrowserEntries.length} browser groups to run on up to ${options.jobs} workers. Performance, freshness, SQL and setup gates run alone.`,
  );
  if (repairing)
    console.log(
      '[verify] Repair mode: only the browser groups whose latest result failed or was blocked are selected. Their pass verifies the repair.',
    );
  if (changed.length > 0 && changed.length <= 12) console.log(`[verify] changed: ${changed.join(', ')}`);
  for (const entry of planning) {
    const browser = ['golden', 'audit'].includes(entry.group.kind);
    const proof = entry.reusable
      ? `passed ${browser ? 'since selection, ' : ''}${entry.reusable.completedAt}`
      : browser
        ? 'no pass since selection'
        : 'missing or changed proof';
    console.log(
      `${entry.reusable ? 'REUSE' : 'RUN  '} ${entry.group.id} | ${automatic ? (selections.get(entry.group.id)?.reason ?? 'Explicit selection') : 'Explicit selection'} | ${entry.inputs.length} proof inputs | ${proof}`,
    );
  }
  if (automatic) {
    // One line per reason, so a large selection names the change that caused it.
    const causes = new Map<string, { groups: number; file: string | undefined }>();
    for (const entry of planning) {
      const selection = selections.get(entry.group.id);
      if (!selection || !BROWSER_KINDS.has(entry.group.kind)) continue;
      const cause = causes.get(selection.reason) ?? { groups: 0, file: selection.changedFiles[0] };
      causes.set(selection.reason, { ...cause, groups: cause.groups + 1 });
    }
    for (const [reason, cause] of causes)
      console.log(
        `[verify] ${reason}: ${cause.groups} browser groups${cause.file ? `; first selecting file ${cause.file}` : ''}`,
      );
  }
  const firstTier = planning.filter((entry) => entry.tier === 0 && !entry.reusable);
  if (firstTier.length)
    console.log(
      `[verify] Changed-spec tier runs first (${firstTier.length}): ${firstTier.map((entry) => entry.group.id).join(', ')}. When one fails, the later browser groups wait for the repair.`,
    );
  if (automatic && options.mode === 'change')
    for (const measured of measuredGroupsForChange(
      qualified.map((entry) => entry.group),
      changed,
    ))
      console.log(
        `[verify] Measured group for this change, not selected: ${measured.id} (first file ${measured.changedFiles[0]}). Run it while you work: bun run test:verify --group ${measured.id}`,
      );
  // The breaker and the archive guard refuse in run mode and only warn in plan mode, so the plan still lists what a focused run must prove.
  const refusals = [
    options.mode === 'release'
      ? releaseAttemptProblem({
          history,
          current: new Map(
            qualified.map((entry) => [
              entry.group.id,
              { fingerprint: entry.fingerprint, inputs: entry.inputs },
            ]),
          ),
          snapshot,
          incidentLog: readFileSync(resolve(repository, INCIDENT_LOG_PATH), 'utf8'),
        })
      : undefined,
    freshBrowserEntries.length ? browserStorageProblem(repository) : undefined,
    unclassifiedFailureProblem({
      groupIds: freshBrowserEntries.map((entry) => entry.group.id),
      target: options.target,
      runs: browserHistory,
    }),
  ].filter((refusal): refusal is string => Boolean(refusal));
  for (const refusal of refusals) console.log(`[verify] refused: ${refusal}`);
  if (!options.execute) return;
  if (refusals.length) throw new Error(refusals.join('\n'));
  await withWorkspaceTestLock({ operation: 'independent verification groups' }, async () => {
    if (changedInputs(snapshot, captureInputSnapshot(repository)).length)
      throw new Error('Inputs changed after planning. Re-plan before executing or reusing results.');
    // One archive scan for the whole run: the retry rules and the reuse checks read this list, not the disk.
    const lockedRuns = listRunManifests();
    const recoveredRunKeys = recoveredEnvironmentRuns(lockedRuns);
    // A group without a browser run records its diagnosis beside the report: bun run test:runs classify <group-id> ...
    const recoveredAttemptKeys = recoveredGroupAttempts(readGroupDiagnoses(archive));
    const candidateFingerprint = freshBrowserEntries.length ? calculateCandidateFingerprint(repository) : '';
    for (const entry of planning) {
      if (!entry.reusable || !['golden', 'audit'].includes(entry.group.kind)) continue;
      const invalid = browserGroupReuseProblem({
        result: entry.reusable,
        target: options.target,
        runs: lockedRuns,
      });
      const latencyProblems = entry.reusable.runKey
        ? checkLatencyEvidence({
            directory: runDirectory(entry.reusable.runKey),
            ...entry.timing,
            enforceDeadlines: entry.enforceDeadlines,
          }).problems
        : ['Missing browser run identity'];
      if (invalid || latencyProblems.length)
        throw new Error(
          `Cannot reuse ${entry.group.id}: ${invalid ?? latencyProblems.join('; ')}. Re-plan or diagnose the archived evidence.`,
        );
    }
    const id = `${new Date().toISOString().replaceAll(':', '').replaceAll('.', '')}-${randomUUID().slice(0, 8)}`;
    const directory = resolve(archive, id);
    mkdirSync(directory, { recursive: true });
    const report: z.infer<typeof reportSchema> = {
      version: 1,
      id,
      startedAt: new Date().toISOString(),
      completedAt: null,
      mode: options.mode,
      target: options.target,
      scope: options.groupIds ? 'selected-groups' : 'all-required-groups',
      jobs: options.jobs,
      status: 'running',
      snapshot,
      selected: planning.map((entry) => entry.group.id),
      results: [],
      measurements: {},
      selection: Object.fromEntries(
        planning.flatMap((entry) => {
          const selection = automatic ? selections.get(entry.group.id) : undefined;
          return selection
            ? [[entry.group.id, { reason: selection.reason, changedFiles: [...selection.changedFiles] }]]
            : [];
        }),
      ),
    };
    const planIndex = new Map(planning.map((entry, index) => [entry.group.id, index]));
    // Workers finish in any order; the report lists results in plan order.
    const publish = (): void => {
      report.results.sort(
        (left, right) => (planIndex.get(left.groupId) ?? 0) - (planIndex.get(right.groupId) ?? 0),
      );
      writeJsonAtomically(resolve(directory, 'report.json'), report);
    };
    await withVerificationReport({
      report,
      groups: planning.map((entry) => ({
        groupId: entry.group.id,
        fingerprint: entry.fingerprint,
        logPath: resolve(directory, `${entry.group.id.replaceAll(':', '-')}.log`),
      })),
      publish,
      run: async (signal) => {
        // The shared work of a browser run happens once here: the server and backend preflight, one
        // discovery per suite, the run identity per group. Each group runner reads the prepared plan.
        const runKeys = new Map<string, string>();
        let preparation: Promise<void> | undefined;
        const prepareBrowsers = async (): Promise<void> => {
          signal.throwIfAborted();
          await runPlaywrightPreflight({ lane: 'group', target: options.target, repositoryRoot: repository });
          signal.throwIfAborted();
          const discoveries: PreparedPlan['discoveries'] = {};
          for (const suite of new Set(
            freshBrowserEntries.map((entry) => entry.group.kind as PlaywrightSuite),
          )) {
            const playwrightArgs = selectedDiscoveryArguments(
              freshBrowserEntries.map((entry) => entry.group),
              suite,
            );
            const tests: DiscoveredPlaywrightTest[] = (
              await discoverPlaywrightSelection({ suite, playwrightArgs, repositoryRoot: repository, signal })
            ).tests;
            discoveries[suite] = tests;
            console.log(`[verify] discovered ${tests.length} ${suite} tests`);
          }
          for (const entry of freshBrowserEntries) runKeys.set(entry.group.id, createRunKey());
          const buildId = readBuildReceipt(repository).buildId;
          const preparedPath = resolve(directory, 'prepared-plan.json');
          writePreparedPlan(preparedPath, {
            version: 1,
            target: options.target,
            preparedAt: new Date().toISOString(),
            buildId,
            discoveries,
            groups: Object.fromEntries(
              freshBrowserEntries.map((entry) => [
                entry.group.id,
                {
                  fingerprint: entry.fingerprint,
                  runKey: runKeys.get(entry.group.id)!,
                  enforceDeadlines: entry.enforceDeadlines,
                },
              ]),
            ),
          });
          process.env[PREPARED_PLAN_ENV] = preparedPath;
        };
        // Only a failed shared prerequisite blocks the groups after it: a static gate, a drift of the
        // inputs, or an interruption. A browser group's own failure never blocks its neighbours.
        let globalBlock: string | undefined;
        const failedFirstTier: string[] = [];
        await runGroupSchedule({
          entries: planning,
          jobs: options.jobs,
          tier: (entry) => entry.tier,
          canOverlap: (entry) => ['audit', 'golden'].includes(entry.group.kind) && !entry.timing.exclusive,
          run: async (entry) => {
            if (entry.reusable) {
              if (entry.reusable.runKey)
                report.measurements[entry.group.id] = checkLatencyEvidence({
                  directory: runDirectory(entry.reusable.runKey),
                  ...entry.timing,
                  enforceDeadlines: entry.enforceDeadlines,
                });
              report.results.push(entry.reusable);
              publish();
              return;
            }
            const logPath = resolve(directory, `${entry.group.id.replaceAll(':', '-')}.log`);
            const browser = BROWSER_KINDS.has(entry.group.kind);
            // A browser group may run again once anything in the tree changed since its failure; the cheap groups compare their own inputs.
            const blocked =
              globalBlock ??
              (entry.tier > 0 ? changedTestsFirstBlock(failedFirstTier) : undefined) ??
              (entry.group.kind === 'static'
                ? undefined
                : browser
                  ? directGroupRetryProblem({
                      groupId: entry.group.id,
                      target: options.target,
                      candidateFingerprint,
                      runs: lockedRuns,
                      recoveredRunKeys,
                    })
                  : groupAttemptProblem({
                      groupId: entry.group.id,
                      fingerprint: entry.fingerprint,
                      inputs: entry.inputs,
                      snapshot,
                      results: priorResults,
                      recoveredRunKeys,
                      recoveredAttemptKeys,
                    }));
            if (blocked) {
              console.log(`[verify] ${entry.group.id}: blocked; ${blocked}`);
              const startedAt = new Date().toISOString();
              report.results.push({
                groupId: entry.group.id,
                fingerprint: entry.fingerprint,
                status: 'blocked',
                startedAt,
                completedAt: startedAt,
                durationMs: 0,
                runKey: null,
                buildId: null,
                logPath,
                reason: blocked,
              });
              publish();
              return;
            }
            if (browser) {
              preparation ??= prepareBrowsers();
              await preparation;
              await waitOutsideMidnightWindow({
                groupId: entry.group.id,
                signal,
                log: (line) => console.log(`[verify] ${line}`),
              });
              // The preflight proved the backend once per run; one that died since blocks the group instead of failing it.
              const before = await backendHealthBeforeGroup({
                check: probeBrowserBackend,
                wait: (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
              });
              if (!before.healthy) {
                const reason = backendDownBeforeGroupReason(before);
                console.log(`[verify] ${entry.group.id}: blocked; ${reason}`);
                const blockedAt = new Date().toISOString();
                report.results.push({
                  groupId: entry.group.id,
                  fingerprint: entry.fingerprint,
                  status: 'blocked',
                  startedAt: blockedAt,
                  completedAt: blockedAt,
                  durationMs: 0,
                  runKey: null,
                  buildId: null,
                  logPath,
                  reason,
                  backendHealth: before,
                });
                publish();
                return;
              }
            }
            const startedAt = new Date().toISOString();
            const runKey = runKeys.get(entry.group.id);
            console.log(
              `[verify] starting ${entry.group.id}${runKey ? ` as run ${runKey}` : ''}; log ${logPath}`,
            );
            // A timing-sensitive group measures against the local Realtime service; a lagging tenant is
            // restarted before the group, never blamed on the group afterwards.
            if (browser && entry.timing.exclusive && options.target === 'local') {
              await ensureRealtimeHealthy({
                probe: () =>
                  probeRealtimeReadiness({
                    url: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
                    publishableKey: requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
                    secretKey: requireEnv('SUPABASE_SECRET_KEY'),
                  }),
                restart: restartLocalRealtimeContainer,
                maxElapsedMs: REALTIME_HEALTHY_MS,
                log: (line) => console.log(`[verify] ${entry.group.id}: ${line}`),
              });
            }
            const log = createWriteStream(logPath);
            log.on('error', () => undefined);
            let errorMessage: string | undefined;
            let exitCode = 1;
            try {
              exitCode = await runWithLogCleanup({
                command: () =>
                  runSessionCommand(commandForGroup(entry.group, options.target), {
                    cwd: repository,
                    env: process.env,
                    signal: signal,
                    onStdout: (chunk) => log.write(chunk),
                    onStderr: (chunk) => log.write(chunk),
                  }),
                closeLog: () =>
                  new Promise<void>((done, reject) =>
                    log.end((error?: Error | null) => (error ? reject(error) : done())),
                  ),
                reportSecondaryFailure: (error) => console.error(`Log finalization failed: ${String(error)}`),
              });
            } catch (error) {
              errorMessage = error instanceof Error ? error.message : String(error);
            }
            const run = runKey ? readRunManifestIfPresent(runKey) : undefined;
            const current = captureInputSnapshot(repository);
            const drift = changedInputs(snapshot, current);
            const latencyEvidence = run
              ? checkLatencyEvidence({
                  directory: runDirectory(run.runKey),
                  ...entry.timing,
                  enforceDeadlines: entry.enforceDeadlines,
                })
              : undefined;
            if (latencyEvidence) {
              report.measurements[entry.group.id] = latencyEvidence;
              for (const measured of latencyEvidence.comparisons)
                console.log(
                  `[verify] ${entry.group.id}/${measured.scenarioId} ${measured.basis === 'median' ? `median of ${measured.samples.length} samples` : `sample ${measured.sample}`}: correctness=${measured.correctness}; responsiveness=${measured.responsiveness}; baseline=${measured.comparison.status}`,
                );
              for (const note of latencyEvidence.overTarget)
                console.log(`[verify] ${entry.group.id}: ${note}`);
            }
            const latencyProblems = latencyEvidence?.problems ?? [];
            const browserQualified =
              !browser ||
              (run?.status === 'passed' &&
                Boolean(run.cleanedAt) &&
                run.target === options.target &&
                run.lane === 'group' &&
                run.groupFingerprint === entry.fingerprint &&
                run.buildId === readBuildReceipt(repository).buildId &&
                run.total === run.passed &&
                run.failed === 0 &&
                run.skipped === 0);
            const passed =
              exitCode === 0 &&
              !drift.length &&
              !latencyProblems.length &&
              browserQualified &&
              !signal.aborted;
            const failureDetails = [
              errorMessage,
              drift.length ? `${INPUT_DRIFT_REASON}: ${drift.join(', ')}` : undefined,
              run?.failures[0]?.message,
              ...latencyProblems,
            ].filter((detail): detail is string => Boolean(detail));
            // The probe after a failure only suggests environment; the trace and the classification decide (P1-08).
            const backendHealth =
              browser && !passed && !signal.aborted ? await probeBrowserBackend() : undefined;
            const reason = passed
              ? null
              : [
                  failureDetails.join('; ') || `Command exited ${exitCode}; inspect ${logPath}`,
                  backendHealth && backendHealthAfterFailureNote(backendHealth),
                ]
                  .filter((detail): detail is string => Boolean(detail))
                  .join('; ');
            report.results.push({
              groupId: entry.group.id,
              fingerprint: entry.fingerprint,
              status: passed ? 'passed' : browser && !run ? 'blocked' : 'failed',
              startedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - Date.parse(startedAt),
              runKey: run?.runKey ?? null,
              buildId: run?.buildId ?? null,
              logPath,
              reason,
              ...(backendHealth ? { backendHealth } : {}),
            });
            publish();
            console.log(
              `[verify] ${entry.group.id}: ${passed ? 'passed' : 'failed'}${reason ? `; ${reason}` : ''}`,
            );
            if (!passed && browser && entry.tier === 0) failedFirstTier.push(entry.group.id);
            if (!passed && (entry.group.kind === 'static' || drift.length || signal.aborted)) {
              globalBlock = `Required setup or source validity failed in ${entry.group.id}. ${reason}`;
            }
          },
        });
        report.status =
          !signal.aborted &&
          report.results.length === planning.length &&
          report.results.every((result) => result.status === 'passed')
            ? 'passed'
            : 'failed';
        if (changedInputs(snapshot, captureInputSnapshot(repository)).length) {
          report.status = 'failed';
          console.error('Inputs changed during verification; this report cannot qualify acceptance.');
        }
        if (
          options.mode === 'release' &&
          listRunManifests().some((run) => run.retainedAt && !run.cleanedAt)
        ) {
          report.status = 'failed';
          console.error('Release verification requires cleanup of every retained test world.');
        }
      },
      summarize: () => {
        const wallClockMinutes = (
          (Date.parse(report.completedAt ?? report.startedAt) - Date.parse(report.startedAt)) /
          60_000
        ).toFixed(1);
        console.log(
          `[verify] ${report.status} in ${wallClockMinutes} min (${report.results.filter((result) => result.status === 'passed').length} passed, ${report.results.filter((result) => result.status === 'failed').length} failed, ${report.results.filter((result) => result.status === 'blocked').length} blocked): ${resolve(directory, 'report.json')}`,
        );
        // The campaign since the last commit, so the cost of a slice's verification is visible on every run.
        console.log(
          `[verify] ${formatCampaignSummary(
            summarizeCampaign({
              reports: readCampaignReports(),
              runs: [
                ...listRunManifests().map((run) => ({
                  runKey: run.runKey,
                  classification: run.classification,
                })),
                ...readGroupDiagnoses(archive).map((diagnosis) => ({
                  runKey: groupAttemptKey(diagnosis),
                  classification: diagnosis.classification,
                })),
              ],
              since: lastCommitTime(),
            }),
          )}`,
        );
        process.exitCode = report.status === 'passed' ? 0 : 1;
      },
    });
  });
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
