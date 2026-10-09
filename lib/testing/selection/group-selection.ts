import { DEPENDENCY_GATE_INPUTS } from '../publication/dependency-audit';
import { scopeEntryOwns, TEST_SCOPE_PREFIXES } from './test-groups';

type SelectableGroup = {
  id: string;
  kind: string;
  /** A browser group's spec files and the test support they import. */
  executionInputs?: readonly string[];
  scopes?: readonly string[];
  /** Measured performance groups run in release mode and on explicit request only. */
  releaseOnly?: boolean;
};

/** Why a group is in the plan, and the changed files that put it there. */
type GroupSelection = { reason: string; changedFiles: readonly string[] };

const RUNNER_PILOTS = new Set(['golden:p1-24a', 'audit:wave-3:p1-24a']);
const ORCHESTRATION_INPUTS =
  /^lib\/testing\/(selection\/(group-selection|test-groups)|evidence\/(group-(qualification|evidence)|campaign-summary|browser-group-evidence)|runner\/(group-(schedule|recovery)|verification-lifecycle|prepared-plan|run-policy|playwright-discovery|backend-health)|publication\/release-breaker|runs\/run-retention|local-stack\/(owned-world-lifecycle|local-stack-startup))\.ts$/;

/**
 * What a changed product file selects when no feature scope owns it, in change
 * mode. Every matching row applies; a product file that matches no row and has
 * no owner selects the core journey alone. Decision 0007, amendment 2026-10-01.
 */
const CORE_JOURNEY = 'golden:gg-00';
export const CORE_SELECTION: readonly { name: string; pattern: RegExp; groups: readonly string[] }[] = [
  {
    name: 'Shared controls and tokens',
    pattern: /^(components\/ui\/|app\/globals\.css$)/,
    groups: [CORE_JOURNEY, 'audit:layout'],
  },
  {
    name: 'Authentication and session boundary',
    pattern:
      /^(proxy\.ts$|lib\/auth\/|app\/auth\/|app\/\(auth\)\/|components\/auth\/|lib\/data\/cached\.ts$|hooks\/use-sign-out\.ts$)/,
    groups: [CORE_JOURNEY, 'audit:security:account'],
  },
  {
    name: 'Dependencies or backend environment',
    pattern: /^(package\.json|bun\.lock|<environment>)$/,
    groups: [CORE_JOURNEY, 'audit:layout', 'audit:security:account'],
  },
];

function isRunnerInput(file: string): boolean {
  return (
    ORCHESTRATION_INPUTS.test(file) ||
    ['tests/golden/support/fixtures.ts', 'tests/audit/support/fixtures.ts'].includes(file) ||
    /^scripts\/(verify|run-playwright|playwright-preflight|campaign-summary|realtime-probe|test-server)\.ts$/.test(
      file,
    )
  );
}

/** Pilot proof includes orchestration inputs even when the browser never imports them. */
export function runnerPilotInputs(groupId: string, files: readonly string[]): string[] {
  return RUNNER_PILOTS.has(groupId) ? files.filter(isRunnerInput) : [];
}

export function isTestInput(file: string): boolean {
  return (
    file.startsWith('tests/') ||
    file.startsWith('lib/testing/') ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    /^playwright(?:\.[a-z-]+)?\.config\.ts$/.test(file)
  );
}

/** Application code, schema and assets: what a browser journey exercises but its proof does not fingerprint. */
function isProductFile(file: string): boolean {
  if (isTestInput(file) || file.startsWith('lib/docs/') || file.startsWith('supabase/tests/')) return false;
  return (
    /^(app|components|hooks|lib|public|styles|types|supabase)\//.test(file) ||
    /^(proxy|middleware|instrumentation|instrumentation-client|next\.config)\.[cm]?[jt]s$/.test(file)
  );
}

/** The feature scopes whose declared prefixes own a file. */
function scopeOwners(file: string): string[] {
  return Object.entries(TEST_SCOPE_PREFIXES)
    .filter(([, entries]) => entries.some((entry) => scopeEntryOwns(entry, file)))
    .map(([scope]) => scope);
}

/** The browser groups one changed file selects in change mode. */
function browserSelection(file: string, group: SelectableGroup): string | undefined {
  if (isRunnerInput(file)) return undefined;
  if (isTestInput(file))
    return group.executionInputs?.includes(file) ? 'Test execution dependency changed' : undefined;
  const rows = CORE_SELECTION.filter((row) => row.pattern.test(file));
  const row = rows.find((entry) => entry.groups.includes(group.id));
  if (row) return `Core set: ${row.name}`;
  if (!isProductFile(file)) return undefined;
  const owners = scopeOwners(file);
  if (owners.some((owner) => group.scopes?.includes(owner))) return `Declared scope: ${owners.join(', ')}`;
  return !owners.length && !rows.length && group.id === CORE_JOURNEY
    ? 'Core set: shared application code'
    : undefined;
}

/**
 * Chooses what a change must check. Release mode selects every group. Change
 * mode selects the cheap gates, and browser groups by declared scope or the
 * core table; when a browser group's latest result failed or was blocked, it
 * selects exactly those browser groups instead (repair mode).
 */
export function groupSelections(input: {
  mode: 'change' | 'release';
  groups: readonly SelectableGroup[];
  changedFiles: readonly string[];
  unresolvedGroupIds: readonly string[];
}): Map<string, GroupSelection> {
  const selections = new Map<string, GroupSelection>();
  const isBrowser = (group: SelectableGroup): boolean => group.kind === 'golden' || group.kind === 'audit';
  const repairing = input.groups.some(
    (group) => isBrowser(group) && !group.releaseOnly && input.unresolvedGroupIds.includes(group.id),
  );
  const runnerChanges = input.changedFiles.filter(isRunnerInput);
  for (const group of input.groups) {
    if (input.mode === 'release') {
      selections.set(group.id, { reason: 'Release coverage', changedFiles: [] });
    } else if (group.releaseOnly) {
      continue;
    } else if (group.id === 'static:dependencies') {
      const changedFiles = input.changedFiles.filter((file) =>
        DEPENDENCY_GATE_INPUTS.some((dependency) => dependency === file),
      );
      if (changedFiles.length)
        selections.set(group.id, { reason: 'Dependency inputs changed', changedFiles });
      else if (input.unresolvedGroupIds.includes(group.id))
        selections.set(group.id, { reason: 'Unresolved result', changedFiles: [] });
    } else if (group.kind === 'static') {
      selections.set(group.id, { reason: 'Current policy check', changedFiles: [] });
    } else if (!isBrowser(group)) {
      selections.set(group.id, { reason: 'Cheap gate; runs when its inputs changed', changedFiles: [] });
    } else if (repairing) {
      if (input.unresolvedGroupIds.includes(group.id))
        selections.set(group.id, { reason: 'Repair: latest result failed or was blocked', changedFiles: [] });
    } else if (RUNNER_PILOTS.has(group.id) && runnerChanges.length) {
      selections.set(group.id, { reason: 'Runner integration pilot', changedFiles: runnerChanges });
    } else {
      const reasons = input.changedFiles
        .map((file) => [file, browserSelection(file, group)] as const)
        .filter(([, reason]) => reason !== undefined);
      const first = reasons[0]?.[1];
      if (first) selections.set(group.id, { reason: first, changedFiles: reasons.map(([file]) => file) });
    }
  }
  return selections;
}

/**
 * The schedule tier of a browser group in a change plan: 0 when its own spec
 * or test support under tests/ changed, 1 otherwise. Harness code under
 * lib/testing/ moves every group, so it decides no order.
 */
export function changedTestTier(
  executionInputs: readonly string[] | undefined,
  changedFiles: readonly string[],
): 0 | 1 {
  return executionInputs?.some((file) => file.startsWith('tests/') && changedFiles.includes(file)) ? 0 : 1;
}

const MEASURED_GROUP_PREFIXES = ['audit:performance:', 'audit:lab:'];

/**
 * The measured performance and lab groups whose declared scopes own a changed product
 * file. The plan prints them for information only: change mode never selects
 * them, so an agent runs one explicitly while it works on that scope.
 */
export function measuredGroupsForChange(
  groups: readonly SelectableGroup[],
  changedFiles: readonly string[],
): { id: string; changedFiles: string[] }[] {
  return groups.flatMap((group) => {
    if (!MEASURED_GROUP_PREFIXES.some((prefix) => group.id.startsWith(prefix))) return [];
    const owned = changedFiles.filter(
      (file) => isProductFile(file) && scopeOwners(file).some((owner) => group.scopes?.includes(owner)),
    );
    return owned.length ? [{ id: group.id, changedFiles: owned }] : [];
  });
}

type BaselineReport = {
  status: 'running' | 'passed' | 'failed';
  scope: 'selected-groups' | 'all-required-groups';
  selected: readonly string[];
  results: readonly { groupId: string; status: 'passed' | 'failed' | 'blocked' }[];
};

/**
 * The report whose snapshot the next change is compared with: the latest
 * passing automatic plan, or the explicit run that passed the last group an
 * automatic plan left unresolved. A verified repair is a new baseline, so
 * groups that share the repaired code are not selected again.
 */
export function selectionBaseline<Report extends BaselineReport>(
  history: readonly Report[],
): Report | undefined {
  let baseline: Report | undefined;
  let pending = new Set<string>();
  for (const report of history) {
    const passed = new Set(
      report.results.filter((result) => result.status === 'passed').map((result) => result.groupId),
    );
    if (report.scope === 'all-required-groups') {
      pending = new Set(report.selected.filter((groupId) => !passed.has(groupId)));
      if (report.status === 'passed') baseline = report;
      continue;
    }
    if (!pending.size) continue;
    for (const groupId of passed) pending.delete(groupId);
    if (!pending.size) baseline = report;
  }
  return baseline;
}

/**
 * A browser pass counts for a selection when it ran on the current content of
 * the files that selected the group. Release mode and explicit groups have no
 * selecting files, so every product file must match.
 */
export function passedSinceSelection(input: {
  then: Readonly<Record<string, string>>;
  now: Readonly<Record<string, string>>;
  selection: GroupSelection | undefined;
}): boolean {
  const files = input.selection?.changedFiles.length
    ? input.selection.changedFiles.filter((file) => file !== '<environment>')
    : [...new Set([...Object.keys(input.then), ...Object.keys(input.now)])].filter(isProductFile);
  return files.every((file) => input.then[file] === input.now[file]);
}
