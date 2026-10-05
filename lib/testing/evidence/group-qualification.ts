import type { RunManifest } from '../../../tests/golden/support/run-state';
import {
  groupFingerprint,
  groupInputFiles,
  sourceImportGraph,
  UNKNOWN_IMPORT_DEPENDENCY,
  type EvidenceGroup,
  type InputSnapshot,
} from './group-evidence';
import { TEST_SCOPE_PREFIXES, type TestGroup } from '../selection/test-groups';
import { isTestInput, runnerPilotInputs } from '../selection/group-selection';
import type { PlaywrightTarget } from '../runner/run-policy';
import { BROWSER_INPUT_DRIFT_MESSAGE } from './test-evidence';

export type GroupQualificationContext = {
  definitions: readonly EvidenceGroup[];
  graph: ReadonlyMap<string, readonly string[]>;
  qualify: (group: TestGroup) => { inputs: string[]; fingerprint: string; executionInputs: string[] };
};

/**
 * Files a kind executes for every one of its groups but no other kind reaches:
 * each business suite's Playwright config, the component runner and its
 * fixtures, the lint rule modules, Bun's test configuration. Before
 * 2026-09-14 these were unowned and therefore inputs of every browser group
 * (`tests/ui-contracts/run.ts` alone charged four `lib/testing` modules to all
 * 52 local groups). The three-suite global setup files stay global on purpose.
 */
const KIND_OWNED_PREFIXES: Readonly<Record<TestGroup['kind'], readonly string[]>> = {
  golden: ['playwright.config.ts'],
  audit: ['playwright.audit.config.ts'],
  // Provider-only helpers are not shared app inputs. Actual imports still
  // qualify any other consumer, and convention units retain every file.
  canary: ['tests/canary/support/', 'playwright.canary.config.ts'],
  ui: ['tests/ui-contracts/'],
  unit: ['bunfig.toml'],
  sql: [],
  static: [],
};
const BROWSER_KINDS: ReadonlySet<TestGroup['kind']> = new Set(['golden', 'audit', 'canary']);
/** Part of a browser proof's environment: a dependency change voids it, an application edit does not. */
const BROWSER_DEPENDENCY_INPUTS: readonly string[] = ['bun.lock', 'package.json'];
const GROUP_OWNED_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  'static:lint': ['eslint-rules/'],
  'static:format': ['.prettierignore', '.editorconfig'],
};

/** Direct commands and the orchestrator must qualify exactly the same inputs. */
export function createGroupQualification(
  repositoryRoot: string,
  groups: readonly TestGroup[],
  snapshot: InputSnapshot,
): GroupQualificationContext {
  const files = Object.keys(snapshot.files);
  const known = new Set(files);
  const graph = sourceImportGraph(repositoryRoot, files);
  const definitions: EvidenceGroup[] = groups.map((group) => ({
    id: group.id,
    files: group.files,
    sourcePrefixes: [
      ...(group.scopes.includes('*')
        ? Object.values(TEST_SCOPE_PREFIXES).flat()
        : group.scopes.flatMap((scope) => TEST_SCOPE_PREFIXES[scope] ?? [])),
      ...KIND_OWNED_PREFIXES[group.kind],
      ...(GROUP_OWNED_PREFIXES[group.id] ?? []),
    ],
  }));
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  return {
    definitions,
    graph,
    qualify: (group) => {
      const definition = byId.get(group.id);
      if (!definition) throw new Error(`Unknown group qualification: ${group.id}`);
      // Framework setup/reporters are loaded by path strings, not TypeScript imports.
      const browser = BROWSER_KINDS.has(group.kind);
      const roots = [
        ...definition.files,
        ...KIND_OWNED_PREFIXES[group.kind].filter((file) => known.has(file)),
        ...(browser
          ? [
              'tests/golden/global-setup.ts',
              'tests/golden/global-teardown.ts',
              'tests/golden/support/run-reporter.ts',
            ]
          : []),
      ];
      const execution = new Set<string>();
      const pending = [...roots];
      while (pending.length) {
        const file = pending.pop();
        if (!file || execution.has(file)) continue;
        if (file === UNKNOWN_IMPORT_DEPENDENCY) {
          // An unresolved import inside test support widens to all test support, never to product code.
          for (const candidate of files) if (isTestInput(candidate)) execution.add(candidate);
          continue;
        }
        // The closure stays inside test code: product modules a helper imports are not proof inputs.
        if (!isTestInput(file)) continue;
        execution.add(file);
        pending.push(...(graph.get(file) ?? []));
      }
      const executionInputs = [...execution].filter((file) => known.has(file)).sort();
      // Repository convention units inspect files through the filesystem, not
      // just imports, so their inexpensive proof covers every file. A browser
      // proof covers its test code, the pilot's runner inputs and the
      // dependency manifests; product code is checked by selection instead.
      const inputs =
        group.id === 'unit:all'
          ? [...files].sort()
          : browser
            ? [
                ...new Set([
                  ...executionInputs,
                  ...runnerPilotInputs(group.id, files),
                  ...BROWSER_DEPENDENCY_INPUTS.filter((file) => known.has(file)),
                ]),
              ].sort()
            : groupInputFiles({ group: definition, groups: definitions, files, graph });
      return { inputs, fingerprint: groupFingerprint(definition, snapshot, inputs), executionInputs };
    },
  };
}

type DirectGroupAttempt = Pick<
  RunManifest,
  | 'runKey'
  | 'groupId'
  | 'candidateFingerprint'
  | 'target'
  | 'status'
  | 'startedAt'
  | 'retainedAt'
  | 'cleanedAt'
> & { failures?: RunManifest['failures']; failed?: number };

/** A run voided because an input changed while it ran neither proves nor blocks its group. */
function voidedByDrift(run: DirectGroupAttempt): boolean {
  return run.failures?.some((failure) => failure.message === BROWSER_INPUT_DRIFT_MESSAGE) ?? false;
}

/** A recovered interruption without a failed business test is no attempt either: nothing about the group was observed. */
function interruptedWithoutFailure(run: DirectGroupAttempt): boolean {
  return run.status === 'interrupted' && (run.failed ?? 0) === 0;
}

/**
 * A browser group may run again as soon as anything in the source tree
 * changed since it failed: the repair may live in product code its proof does
 * not fingerprint. Only a repeat on the identical tree needs a diagnosis.
 */
export function directGroupRetryProblem(input: {
  groupId: string;
  target: PlaywrightTarget;
  candidateFingerprint: string;
  runs: readonly DirectGroupAttempt[];
  recoveredRunKeys: readonly string[];
}): string | undefined {
  const groupRuns = input.runs.filter((run) => run.groupId === input.groupId && run.target === input.target);
  const active = groupRuns.find((run) => run.status === 'starting' || run.status === 'running');
  if (active)
    return `Group ${input.groupId} has unfinished run ${active.runKey}. Recover its ownership before executing another group attempt.`;
  const retained = groupRuns.find((run) => run.retainedAt && !run.cleanedAt);
  if (retained)
    return `Group ${input.groupId} retains world ${retained.runKey}. Clean its world (bun run test:runs cleanup ${retained.runKey}) before repeating this group.`;
  const attempts = groupRuns
    .filter(
      (run) =>
        run.candidateFingerprint === input.candidateFingerprint &&
        !voidedByDrift(run) &&
        !interruptedWithoutFailure(run),
    )
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const latest = attempts.at(-1);
  if (!latest || latest.status === 'passed') return undefined;
  const failures = attempts.filter((run) => run.status !== 'passed');
  if (failures.length === 1 && input.recoveredRunKeys.includes(latest.runKey)) return undefined;
  return `Group ${input.groupId} already failed or stopped on this exact source tree in ${latest.runKey}. Change the cause, or classify an environment failure and replay it on the retained world; an unchanged repeat is not a repair.`;
}
