// A fake world for the merge queue's tests: GitHub, git and the runner behind one QueueAdapter,
// with switches for each failure the queue must survive.
import { createHash } from 'node:crypto';
import type { MainCommit, QueueAdapter, QueuedPull, QueueState, Verdict } from '../ci/queue';

/** A fake commit id of the whole seed, so two children of one parent never share an id. */
export const sha = (seed: string): string => createHash('sha1').update(seed).digest('hex');

export function pull(number: number, overrides: Partial<QueuedPull> = {}): QueuedPull {
  return {
    number,
    title: `PR ${number}`,
    headSha: sha(`head-${number}`),
    isDraft: false,
    queuedAt: `2026-11-21T08:0${number}:00Z`,
    check: 'SUCCESS',
    mergeState: 'BLOCKED',
    listGrowthApproved: false,
    ...overrides,
  };
}

export type Fake = {
  adapter: QueueAdapter;
  /** The PR sets each integration run tested, in order. */
  tested: number[][];
  landed: number[];
  rejected: number[];
  /** The PRs whose branch the queue updated with main, in order. */
  updated: number[];
  withdrawn: number[];
  /** The pending mark's PR when each merge was asked for: the mark is saved before it is posted. */
  pendingAtLand: (number | null)[];
  /** Whether the PR's auto-merge was still on when its `Queue` success and merge were asked for. */
  autoMergeAtLand: boolean[];
  /** The main run the queue had saved as owed when each merge was asked for. */
  owedAtLand: ({ base: string; prs: readonly number[]; merging: number } | null)[];
  /** The newest `Queue` on a head: success when the queue marked it, failure once withdrawn. */
  queueOn: (head: string) => 'success' | 'failure' | undefined;
  main: () => MainCommit;
  state: () => QueueState;
};

/** Fake git: commits with their parents and trees, and main's head. */
function fakeGit() {
  const commits = new Map<string, { parents: string[]; tree: string }>([
    [sha('main'), { parents: [], tree: 'main' }],
  ]);
  let mainCommit = sha('main');
  const commit = (parent: string, tree: string): string => {
    const id = sha(`${parent}:${tree}`);
    commits.set(id, { parents: [parent], tree });
    return id;
  };
  return {
    commit,
    treeOf: (id: string) => commits.get(id)?.tree,
    pushMain: (tree: string): void => {
      mainCommit = commit(mainCommit, tree);
    },
    main: (): MainCommit => ({
      commit: mainCommit,
      ...(commits.get(mainCommit) ?? { parents: [], tree: '' }),
    }),
  };
}

/** The fake publisher of `Queue`: down for PR n's first `failures[n]` withdrawals. */
function fakePublisher(failures: Readonly<Record<number, number>>) {
  const withdrawals = new Map<number, number>();
  const queueMarks = new Map<string, 'success' | 'failure'>();
  const withdrawn: number[] = [];
  const withdraw: QueueAdapter['withdraw'] = async (mark) => {
    const attempt = (withdrawals.get(mark.pull) ?? 0) + 1;
    withdrawals.set(mark.pull, attempt);
    if (attempt <= (failures[mark.pull] ?? 0)) throw new Error('publisher unavailable');
    queueMarks.set(mark.head, 'failure');
    withdrawn.push(mark.pull);
  };
  return {
    withdrawn,
    withdraw,
    mark: (head: string) => queueMarks.set(head, 'success'),
    queueOn: (head: string) => queueMarks.get(head),
  };
}

/**
 * The fake's squash, and its migration-order check: a tree is the list of PRs squashed onto main,
 * and PR n's migration conflicts with PR `migrationConflicts[n]`'s in the prefix it lands on.
 */
function fakeBatchGit(
  git: ReturnType<typeof fakeGit>,
  options: WorldOptions,
): Pick<QueueAdapter, 'squash' | 'migrationProblems'> {
  return {
    squash: async (parent, entry) => {
      if (entry.title.includes('conflict')) return undefined;
      const before = `${git.treeOf(parent)}`;
      const tree = options.unchanged?.includes(entry.number) ? before : `${before}+${entry.number}`;
      return { commit: git.commit(parent, tree), tree };
    },
    migrationProblems: async (parent, entry) => {
      const ahead = options.migrationConflicts?.[entry.pull.number];
      return ahead !== undefined && `${git.treeOf(parent)}`.split('+').includes(String(ahead))
        ? [`#${entry.pull.number}'s migration changes what #${ahead}'s newer migration changes.`]
        : [];
    },
  };
}

/**
 * What the queue held when it asked for each merge: its pending mark, the PR's auto-merge, and
 * main's run it saved as owed. Saving that run throws with `owingFails`.
 */
function fakeMergeRecord(owingFails: boolean | undefined) {
  const seen: Pick<Fake, 'pendingAtLand' | 'autoMergeAtLand' | 'owedAtLand'> = {
    pendingAtLand: [],
    autoMergeAtLand: [],
    owedAtLand: [],
  };
  let owed: Fake['owedAtLand'][number] = null;
  const oweMainRun: QueueAdapter['oweMainRun'] = async (followUp) => {
    if (owingFails) throw new Error('the work directory is full');
    owed = followUp;
  };
  const atLand = (entry: QueuedPull, open: readonly QueuedPull[], saved: QueueState): void => {
    seen.pendingAtLand.push(saved.pending?.pull ?? null);
    seen.autoMergeAtLand.push(
      open.some((candidate) => candidate.number === entry.number && candidate.queuedAt !== null),
    );
    seen.owedAtLand.push(owed);
  };
  return { seen, oweMainRun, atLand };
}

/** A PR after GitHub merged main into its branch: a new head, up to date, whose Check the runner has not posted yet. */
const updatedBranch = (entry: QueuedPull): QueuedPull => ({
  ...entry,
  headSha: sha(`updated-${entry.number}`),
  check: 'MISSING',
  mergeState: 'BLOCKED',
});

/** The fake run's verdict: `answer`'s, or failed when the prefix holds a PR of `breaks`. */
const fakeVerdict = (options: WorldOptions, prs: readonly number[], run: number): Verdict['kind'] =>
  options.answer?.(prs, run) ??
  (prs.some((number) => options.breaks?.includes(number)) ? 'failed' : 'passed');

/** The switches of `fakeWorld`, each described there. */
type WorldOptions = {
  breaks?: readonly number[];
  answer?: (prs: readonly number[], run: number) => Verdict['kind'] | undefined;
  afterRun?: (run: number, world: { pulls: QueuedPull[]; pushMain: (tree: string) => void }) => void;
  mergeTree?: (tree: string) => string;
  refuse?: number;
  lostAnswer?: number;
  beforeLand?: (merge: number, world: { pulls: QueuedPull[]; pushMain: (tree: string) => void }) => void;
  unprovenMain?: boolean;
  unchanged?: readonly number[];
  failedWithdrawals?: Readonly<Record<number, number>>;
  stuckAutoMerge?: number;
  state?: QueueState;
  migrationConflicts?: Readonly<Record<number, number>>;
  updateFails?: boolean;
  owingFails?: boolean;
};

/**
 * A fake world. A tree is the list of PRs squashed onto main. A run fails when its prefix holds a
 * PR of `breaks`, and `answer` can override a run's verdict. `afterRun` changes the world after
 * the n-th run (1-based). GitHub's merge squashes onto the current main, `mergeTree` may change
 * the tree it builds, `refuse` makes the merge throw without merging, and `lostAnswer` makes it
 * throw after merging. GitHub reports a merged PR's merge commit. `beforeLand` changes the world
 * before the n-th merge. The ledger proves main's tree unless `unprovenMain`. A PR of
 * `unchanged` holds only changes already in the batch, so its squash keeps the tree. The publisher
 * is down for PR n's first `failedWithdrawals[n]` withdrawals. GitHub refuses to turn off the auto-merge
 * of `stuckAutoMerge`. The queue's saved state starts as `state`. PR n's migration conflicts with
 * PR `migrationConflicts[n]`'s when that PR is in the prefix it lands on. Updating a branch throws
 * with `updateFails`. Saving an owed main run throws with `owingFails`.
 */
export function fakeWorld(pulls: QueuedPull[], options: WorldOptions = {}): Fake {
  const git = fakeGit();
  const { pushMain, main } = git;
  const publisher = fakePublisher(options.failedWithdrawals ?? {});
  let open = [...pulls];
  const tested: number[][] = [];
  const landed: number[] = [];
  const rejected: number[] = [];
  const updated: number[] = [];
  const record = fakeMergeRecord(options.owingFails);
  let saved: QueueState = options.state ?? { pending: null, frozen: null };
  const mergeCommits = new Map<number, string>();
  let merges = 0;
  const adapter: QueueAdapter = {
    main: async () => main(),
    pulls: async () => open,
    ...fakeBatchGit(git, options),
    integrationRun: async ({ tip, pulls: prefix }) => {
      const prs = prefix.map((entry) => entry.number);
      tested.push(prs);
      const kind = fakeVerdict(options, prs, tested.length);
      options.afterRun?.(tested.length, { pulls: open, pushMain });
      open = [...open];
      return { kind, runUrl: `run-${tested.length}:${tip.tree}`, detail: kind };
    },
    disableAutoMerge: async (entry) => {
      if (entry.number === options.stuckAutoMerge) throw new Error('GitHub refused');
      open = open.map((candidate) =>
        candidate.number === entry.number ? { ...candidate, queuedAt: null } : candidate,
      );
    },
    oweMainRun: record.oweMainRun,
    land: async (entry) => {
      record.atLand(entry, open, saved);
      publisher.mark(entry.headSha);
      options.beforeLand?.(++merges, { pulls: open, pushMain });
      if (entry.number === options.refuse) throw new Error('Pull request is not mergeable');
      const tree = `${main().tree}+${entry.number}`;
      pushMain(options.mergeTree?.(tree) ?? tree);
      landed.push(entry.number);
      mergeCommits.set(entry.number, main().commit);
      open = open.filter((candidate) => candidate.number !== entry.number);
      if (entry.number === options.lostAnswer) throw new Error('connection reset');
    },
    mergeCommit: async (number) => mergeCommits.get(number) ?? null,
    updateBranch: async (entry) => {
      if (options.updateFails) throw new Error('GitHub refused the update');
      updated.push(entry.number);
      open = open.map((candidate) =>
        candidate.number === entry.number ? updatedBranch(candidate) : candidate,
      );
    },
    reject: async (entry) => {
      rejected.push(entry.number);
    },
    withdraw: publisher.withdraw,
    state: async () => saved,
    saveState: async (state) => {
      saved = state;
    },
    proven: async (tree) => tree === 'main' && !options.unprovenMain,
  };
  return {
    adapter,
    tested,
    landed,
    rejected,
    updated,
    withdrawn: publisher.withdrawn,
    ...record.seen,
    queueOn: publisher.queueOn,
    main,
    state: () => saved,
  };
}
