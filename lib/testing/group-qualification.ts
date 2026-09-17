import type { RunManifest } from "../../tests/golden/support/run-state";
import {
  groupFingerprint, groupInputFiles, sourceImportGraph,
  type EvidenceGroup, type InputSnapshot,
} from "./group-evidence";
import { getGroupExecutionFiles, TEST_SCOPE_PREFIXES, type TestGroup } from "./test-groups";
import type { PlaywrightTarget } from "./run-policy";

export type GroupQualificationContext = {
  definitions: readonly EvidenceGroup[];
  graph: ReadonlyMap<string, readonly string[]>;
  qualify: (group: TestGroup) => { inputs: string[]; fingerprint: string };
};

/**
 * Files a kind executes for every one of its groups but no other kind reaches:
 * each business suite's Playwright config, the component runner and its
 * fixtures, the lint rule modules, Bun's test configuration. Before
 * 2026-09-14 these were unowned and therefore inputs of every browser group
 * (`tests/ui-contracts/run.ts` alone charged four `lib/testing` modules to all
 * 52 local groups). The three-suite global setup files stay global on purpose.
 */
const KIND_OWNED_PREFIXES: Readonly<Record<TestGroup["kind"], readonly string[]>> = {
  golden: ["playwright.config.ts"],
  audit: ["playwright.audit.config.ts"],
  // Provider-only helpers are not shared app inputs. Actual imports still
  // qualify any other consumer, and convention units retain every file.
  canary: ["tests/canary/support/", "playwright.canary.config.ts"],
  ui: ["tests/ui-contracts/"],
  unit: ["bunfig.toml"],
  sql: [],
  static: [],
};
const GROUP_OWNED_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  "static:lint": ["eslint-rules/"],
};

/** Direct commands and the orchestrator must qualify exactly the same inputs. */
export function createGroupQualification(
  repositoryRoot: string,
  groups: readonly TestGroup[],
  snapshot: InputSnapshot,
): GroupQualificationContext {
  const files = Object.keys(snapshot.files);
  const graph = sourceImportGraph(repositoryRoot, files);
  const definitions: EvidenceGroup[] = groups.map((group) => ({
    id: group.id,
    files: getGroupExecutionFiles(group, groups),
    sourcePrefixes: [...(group.scopes.includes("*")
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
      const importedInputs = groupInputFiles({ group: definition, groups: definitions, files, graph });
      // Repository convention units inspect files through the filesystem, not
      // just imports. Keep their inexpensive proof broad without changing
      // framework-file ownership for application browser groups.
      const inputs = group.id === "unit:all"
        ? [...files].sort()
        : importedInputs;
      return { inputs, fingerprint: groupFingerprint(definition, snapshot, inputs) };
    },
  };
}

type DirectGroupAttempt = Pick<RunManifest,
  "runKey" | "groupId" | "groupFingerprint" | "target" | "status" |
  "startedAt" | "retainedAt" | "cleanedAt"
>;

/** Applies even when the orchestrator stopped before writing its GroupResult. */
export function directGroupRetryProblem(input: {
  groupId: string;
  target: PlaywrightTarget;
  fingerprint: string;
  runs: readonly DirectGroupAttempt[];
  recoveredRunKeys: readonly string[];
}): string | undefined {
  const groupRuns = input.runs.filter((run) => run.groupId === input.groupId && run.target === input.target);
  const active = groupRuns.find((run) => run.status === "starting" || run.status === "running");
  if (active) return `Group ${input.groupId} has unfinished run ${active.runKey}. Recover its ownership before executing another group attempt.`;
  const retained = groupRuns.find((run) => run.retainedAt && !run.cleanedAt);
  if (retained) return `Group ${input.groupId} retains world ${retained.runKey}. Diagnose and clean its own world before repeating this group.`;
  const unqualified = groupRuns.find((run) => !run.groupFingerprint && run.status !== "passed");
  if (unqualified) return `Group ${input.groupId} has failed historical run ${unqualified.runKey} without group input qualification. A changed global candidate cannot prove that its cause was repaired.`;
  const attempts = groupRuns.filter((run) => run.groupFingerprint === input.fingerprint)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const latest = attempts.at(-1);
  if (!latest || latest.status === "passed") return undefined;
  const failures = attempts.filter((run) => run.status !== "passed");
  if (failures.length === 1 && input.recoveredRunKeys.includes(latest.runKey)) return undefined;
  return `Group ${input.groupId} already failed or stopped on unchanged group inputs in ${latest.runKey}. Diagnose its evidence; unrelated edits and unchanged retries cannot produce acceptance.`;
}
