import { ADVISORY_GROUP_ID } from '../evidence/advisory-freshness';
import { DEPENDENCY_GATE_INPUTS } from '../publication/dependency-audit';
import type { ChangeTrigger } from './change-triggers';
import { scopeEntryOwns, TEST_SCOPE_PREFIXES } from './test-groups';

type SelectableGroup = {
  id: string;
  kind: string;
  /** A browser group's spec files and the test support they import. */
  executionInputs?: readonly string[];
  scopes?: readonly string[];
  /** A browser group's `changeTrigger`; a group without one keeps the scope selection. */
  trigger?: ChangeTrigger | undefined;
};

/** Why a group is in the plan, and the changed files that put it there. */
type GroupSelection = { reason: string; changedFiles: readonly string[] };

const MEASURED_GROUP_PREFIX = 'audit:performance:';
const RUNNER_PILOTS = new Set(['golden:p1-24a', 'audit:wave-3:p1-24a']);
const ORCHESTRATION_INPUTS =
  /^lib\/testing\/(selection\/(group-selection|test-groups)|evidence\/(group-(qualification|evidence)|campaign-summary|browser-group-evidence)|runner\/(group-(schedule|recovery)|verification-lifecycle|prepared-plan|run-policy|playwright-discovery|backend-health)|publication\/release-breaker|runs\/run-retention|local-stack\/(owned-world-lifecycle|local-stack-startup))\.ts$/;

/**
 * What a changed auth or dependency file selects in change mode besides the
 * critical journeys, which every row also selects. Every matching row applies.
 * Decision 0007, amendments 2026-10-01 and 2026-10-29.
 */
export const CORE_SELECTION: readonly { name: string; pattern: RegExp; groups: readonly string[] }[] = [
  {
    name: 'Authentication and session boundary',
    pattern:
      /^(proxy\.ts$|lib\/auth\/|app\/auth\/|app\/\(auth\)\/|components\/auth\/|lib\/data\/cached\.ts$|hooks\/use-sign-out\.ts$)/,
    groups: ['audit:security:account'],
  },
  {
    name: 'Dependencies or backend environment',
    pattern: /^(package\.json|bun\.lock|<environment>)$/,
    groups: ['audit:security:account'],
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

/**
 * Why one changed file selects a browser group in change mode, or undefined.
 * `sharedSupport` holds the test support any browser group executes.
 */
function browserSelection(
  file: string,
  group: SelectableGroup,
  sharedSupport: ReadonlySet<string>,
): string | undefined {
  if (isRunnerInput(file)) return undefined;
  const trigger = group.trigger ?? 'scope';
  if (isTestInput(file)) {
    if (group.executionInputs?.includes(file)) return 'Test execution dependency changed';
    return trigger === 'critical' && sharedSupport.has(file)
      ? 'Critical journey: test support changed'
      : undefined;
  }
  const rows = CORE_SELECTION.filter((entry) => entry.pattern.test(file));
  if (trigger === 'critical' && (rows.length || isProductFile(file)))
    return `Critical journey: ${rows[0]?.name ?? 'product code'} changed`;
  const row = rows.find((entry) => entry.groups.includes(group.id));
  if (row) return `Core set: ${row.name}`;
  if (trigger !== 'scope' || !isProductFile(file)) return undefined;
  const owners = scopeOwners(file);
  return owners.some((owner) => group.scopes?.includes(owner))
    ? `Permission test, declared scope: ${owners.join(', ')}`
    : undefined;
}

/**
 * Chooses what a change must check. Release mode selects every group. Change
 * mode selects the cheap gates and the browser groups each `changeTrigger`
 * names: the critical journeys for any product, migration or shared test
 * support change, permission groups by declared scope, the core table, and
 * any group whose own test code changed. When a browser group's latest result
 * failed or was blocked, it selects those browser groups and the groups whose
 * own test code changed instead (repair mode).
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
    (group) =>
      isBrowser(group) && group.trigger !== 'release-only' && input.unresolvedGroupIds.includes(group.id),
  );
  const runnerChanges = input.changedFiles.filter(isRunnerInput);
  const sharedSupport = new Set(
    input.groups
      .filter(isBrowser)
      .flatMap((group) => group.executionInputs ?? [])
      .filter((file) => isTestInput(file) && !file.endsWith('.spec.ts')),
  );
  for (const group of input.groups) {
    if (input.mode === 'release') {
      selections.set(group.id, { reason: 'Release coverage', changedFiles: [] });
    } else if (group.trigger === 'release-only') {
      // The author of a sweep or a capture gets feedback on the change; a wall-clock group never runs in it.
      const testChanges = ownTestChanges(group, input.changedFiles);
      if (testChanges.length && !group.id.startsWith(MEASURED_GROUP_PREFIX))
        selections.set(group.id, { reason: 'Test execution dependency changed', changedFiles: testChanges });
    } else if (group.id === ADVISORY_GROUP_ID) {
      // Every change plan carries an advisory result; the plan reuses a pass under 24 hours old
      // (lib/testing/evidence/advisory-freshness.ts), so a new advisory surfaces within a day.
      const changedFiles = input.changedFiles.filter((file) =>
        DEPENDENCY_GATE_INPUTS.some((dependency) => dependency === file),
      );
      selections.set(
        group.id,
        changedFiles.length
          ? { reason: 'Dependency inputs changed', changedFiles }
          : input.unresolvedGroupIds.includes(group.id)
            ? { reason: 'Unresolved result', changedFiles: [] }
            : { reason: 'Advisory check; a pass stays reusable for 24 hours', changedFiles: [] },
      );
    } else if (group.kind === 'static') {
      selections.set(group.id, { reason: 'Current policy check', changedFiles: [] });
    } else if (!isBrowser(group)) {
      selections.set(group.id, { reason: 'Cheap gate; runs when its inputs changed', changedFiles: [] });
    } else if (input.unresolvedGroupIds.includes(group.id)) {
      selections.set(group.id, { reason: 'Repair: latest result failed or was blocked', changedFiles: [] });
    } else if (repairing) {
      // A repair absorbs shared product changes into its baseline, but never a group's own test code:
      // until 2026-10-16 a spec rewritten during a repair became baseline without ever running.
      const testChanges = ownTestChanges(group, input.changedFiles);
      if (testChanges.length)
        selections.set(group.id, { reason: 'Test execution dependency changed', changedFiles: testChanges });
    } else if (RUNNER_PILOTS.has(group.id) && runnerChanges.length) {
      selections.set(group.id, { reason: 'Runner integration pilot', changedFiles: runnerChanges });
    } else {
      const reasons = input.changedFiles
        .map((file) => [file, browserSelection(file, group, sharedSupport)] as const)
        .filter(([, reason]) => reason !== undefined);
      const first = reasons[0]?.[1];
      if (first) selections.set(group.id, { reason: first, changedFiles: reasons.map(([file]) => file) });
    }
  }
  return selections;
}

/** The changed spec and test support files a browser group executes. */
function ownTestChanges(group: SelectableGroup, changedFiles: readonly string[]): string[] {
  return changedFiles.filter((file) => isTestInput(file) && group.executionInputs?.includes(file));
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

/**
 * The wall-clock groups (`audit:performance:*`) whose declared scopes own a
 * changed product file. A change plan never selects them: their medians follow
 * the machine's load, so they
 * run on a quiet machine with an explicit `--group`, which enforces their
 * deadlines. The plan names them for a run before the next release; CI never
 * runs them (docs/technical/performance.md).
 */
export function measuredGroupsForChange(
  groups: readonly SelectableGroup[],
  changedFiles: readonly string[],
): { id: string; changedFiles: string[] }[] {
  return groups.flatMap((group) => {
    if (!group.id.startsWith(MEASURED_GROUP_PREFIX)) return [];
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
