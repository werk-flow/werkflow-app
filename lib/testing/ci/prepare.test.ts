// The environment steps every runner takes before a job body (scripts/ci/prepare.ts), run against
// stub commands: the list growth approval of a run's PRs, and the stack's start, which never tests
// against another job's schema and never publishes a port beyond loopback.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PREPARE = resolve(import.meta.dir, '../../../scripts/ci/prepare.ts');

// Answers like gh: `--jq` runs through real jq, so the step's own filter is under test. It records
// each call and lists `labels-<n>.json` for PR <n>. The merge queue's entries are `queue.json`
// (`queue.fail`: the query fails), the PRs GitHub merged as commit <sha> `pulls-<sha>.json`.
const GH_STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB/gh.calls"
filter=.
previous=
for argument in "$@"; do
  if test "$previous" = --jq; then filter="$argument"; fi
  previous="$argument"
done
case "$*" in
  *'/issues/'*'/labels'*)
    pr="$(sed -nE 's|.*/issues/([0-9]+)/labels.*|\\1|p' <<< "$*")"
    jq -r "$filter" "$STUB/labels-$pr.json" 2> /dev/null || echo '[]' | jq -r "$filter" ;;
  'api graphql '*)
    if test -e "$STUB/queue.fail"; then echo 'HTTP 502' >&2; exit 1; fi
    cat "$STUB/queue.json" 2> /dev/null || echo '{"data":{"repository":{"mergeQueue":null}}}' ;;
  *'/commits/'*'/pulls'*)
    sha="$(sed -nE 's|.*/commits/([0-9a-f]+)/pulls.*|\\1|p' <<< "$*")"
    cat "$STUB/pulls-$sha.json" 2> /dev/null || echo '[]' ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`;

// The stack's commands. `docker ps` prints $STUB/containers (empty: no stack runs); `supabase start`
// writes $STUB/started-containers there, as the CLI's containers would appear.
const STACK_STUBS: Record<string, string> = {
  docker: `#!/usr/bin/env bash
echo "docker $*" >> "$STUB/calls"
case "$1 $2" in
  'ps --filter') cat "$STUB/containers" 2> /dev/null || true ;;
  'network inspect') exit 1 ;;
  *) ;;
esac
`,
  supabase: `#!/usr/bin/env bash
echo "supabase $*" >> "$STUB/calls"
case "$1" in
  --version) echo 2.116.0 ;;
  start) cp "$STUB/started-containers" "$STUB/containers" ;;
  stop) : > "$STUB/containers" ;;
  status) printf '%s\\n' 'API_URL="http://127.0.0.1:54321"' 'PUBLISHABLE_KEY="publishable"' 'SECRET_KEY="secret"' \\
    'S3_PROTOCOL_ACCESS_KEY_ID="access"' 'S3_PROTOCOL_ACCESS_KEY_SECRET="access-secret"' 'STORAGE_S3_URL="http://127.0.0.1:54321/storage/v1/s3"' ;;
esac
`,
  sudo: `#!/usr/bin/env bash
echo "sudo $*" >> "$STUB/calls"
`,
  curl: `#!/usr/bin/env bash
echo '204 0.01s'
`,
};

let stub = '';
let repository = '';

function git(...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=CI', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

function commit(subject: string): string {
  writeFileSync(join(repository, 'file.txt'), subject);
  git('add', 'file.txt');
  git('commit', '--quiet', '--no-verify', '--message', subject);
  return git('rev-parse', 'HEAD');
}

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'ci-prepare-'));
  for (const [name, script] of Object.entries({ gh: GH_STUB, ...STACK_STUBS })) {
    writeFileSync(join(stub, name), script);
    chmodSync(join(stub, name), 0o755);
  }
  writeFileSync(join(stub, 'env'), '');
  repository = join(stub, 'repository');
  mkdirSync(join(repository, 'supabase'), { recursive: true });
  writeFileSync(join(repository, 'supabase/config.toml'), 'project_id = "werkflow-app"\n');
  git('init', '--quiet', '--initial-branch=main');
  commit('Main');
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

const read = (file: string): string =>
  existsSync(join(stub, file)) ? readFileSync(join(stub, file), 'utf8') : '';

function prepare(step: string, env: Record<string, string>): { passed: boolean; output: string } {
  const ran = spawnSync(process.execPath, [PREPARE, step], {
    cwd: repository,
    encoding: 'utf8',
    // Only these variables: no CI variable of the test's own run reaches the step.
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      HOME: stub,
      STUB: stub,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_ENV: join(stub, 'env'),
      ...env,
    },
  });
  return { passed: ran.status === 0, output: `${ran.stdout}${ran.stderr}` };
}

// A shrink-only list in the queue's commits: a JSON ratchet, long enough that git sees a moved and
// edited copy as a rename.
const RATCHET = 'eslint-rules/type-assertion-ratchet.json';
const ASIDE = 'eslint-rules/aside.json';
const LIST = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`lib/file-${index}.ts`, 1]));

/** A commit that sets the ratchet's entries, beyond the 20 every version holds. */
function ratchetCommit(subject: string, extra: Record<string, number> = {}): string {
  mkdirSync(join(repository, 'eslint-rules'), { recursive: true });
  writeFileSync(join(repository, RATCHET), JSON.stringify({ ...LIST, ...extra }, null, 1));
  git('add', RATCHET);
  git('commit', '--quiet', '--no-verify', '--message', subject);
  return git('rev-parse', 'HEAD');
}

/** A commit that drops `key` from the ratchet's 20 entries: a shrink. */
function shrinkCommit(subject: string, key: string): string {
  const kept = Object.entries(LIST).filter(([entry]) => entry !== key);
  writeFileSync(join(repository, RATCHET), JSON.stringify(Object.fromEntries(kept), null, 1));
  git('add', RATCHET);
  git('commit', '--quiet', '--no-verify', '--message', subject);
  return git('rev-parse', 'HEAD');
}

/** A commit that moves `from` to `to` with git mv, keeping its content. */
function moveCommit(subject: string, from: string, to: string): string {
  git('mv', from, to);
  git('commit', '--quiet', '--no-verify', '--message', subject);
  return git('rev-parse', 'HEAD');
}

const APPROVED = [{ name: 'approved: list growth' }];

/** The labels a reading by commit subject would find: the subject's PR is approved. */
const labelSubject = (pr: number): void =>
  writeFileSync(join(stub, `labels-${pr}.json`), JSON.stringify(APPROVED));

/** GitHub's merge queue: each running entry's head commit and PR. */
function mergeQueue(entries: readonly { commit: string; pr: number; approved: boolean }[]): void {
  const nodes = entries.map(({ commit, pr, approved }) => ({
    headCommit: { oid: commit },
    pullRequest: { number: pr, labels: { totalCount: approved ? 1 : 0, nodes: approved ? APPROVED : [] } },
  }));
  writeFileSync(
    join(stub, 'queue.json'),
    JSON.stringify({
      data: { repository: { mergeQueue: { entries: { totalCount: nodes.length, nodes } } } },
    }),
  );
}

/** Main holds the ratchet, and origin/main points at it, as a queue run's checkout fetched it. */
function onMain(): Record<string, string> {
  ratchetCommit('Main');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { GH_TOKEN: 'token', CI_EVENT: 'integration', CI_PRS: '12' };
}

/** The step's exported approval, or undefined when the step failed. */
function approval(queue: Record<string, string>): string | undefined {
  writeFileSync(join(stub, 'env'), '');
  return prepare('approval', queue).passed ? read('env') : undefined;
}

const graphqlCalls = (): number => read('gh.calls').split('api graphql').length - 1;

test("a queue entry behind an approved PR that grew a list takes that PR's approval, with one queue query", () => {
  const queue = onMain();
  const ahead = ratchetCommit('Ahead in the queue (#11)', { 'lib/b.ts': 1 });
  const entry = commit('This entry (#12)');
  mergeQueue([
    { commit: ahead, pr: 11, approved: true },
    { commit: entry, pr: 12, approved: false },
  ]);
  expect(approval(queue)).toBe('SHRINK_ONLY_GROWTH_APPROVED=true\n');
  expect(graphqlCalls()).toBe(1);
});

test('a queue entry that landed during the run binds through the PR GitHub merged as that commit', () => {
  const queue = onMain();
  const ahead = ratchetCommit('Ahead in the queue (#11)', { 'lib/b.ts': 1 });
  mergeQueue([{ commit: commit('This entry (#12)'), pr: 12, approved: false }]);
  const merged = (sha: string) => [
    { number: 11, merge_commit_sha: sha, merged_at: '2026-11-23T12:00:00Z', labels: APPROVED },
  ];
  writeFileSync(join(stub, `pulls-${ahead}.json`), JSON.stringify(merged(ahead)));
  expect(approval(queue)).toBe('SHRINK_ONLY_GROWTH_APPROVED=true\n');
  // A PR GitHub merged as another commit is no binding.
  writeFileSync(join(stub, `pulls-${ahead}.json`), JSON.stringify(merged('0'.repeat(40))));
  expect(approval(queue)).toBe('SHRINK_ONLY_GROWTH_APPROVED=false\n');
});

test("a commit subject naming an approved PR is no proof: only GitHub's records bind a commit to its PR", () => {
  const queue = onMain();
  const claimed = ratchetCommit('Claims the approved PR (#11)', { 'lib/b.ts': 1 });
  labelSubject(11);
  mergeQueue([{ commit: claimed, pr: 13, approved: false }]);
  expect(approval(queue)).toBe('SHRINK_ONLY_GROWTH_APPROVED=false\n');
  // A commit nothing binds keeps the gate strict too.
  mergeQueue([]);
  expect(approval(queue)).toBe('SHRINK_ONLY_GROWTH_APPROVED=false\n');
});

test('every commit that grows a list must be approved: a list moved aside and restored, a rename included', () => {
  const queue = onMain();
  // Approved #11 deletes the list; unapproved #12 restores it with a new entry, growth that no
  // comparison per commit sees, since the list is absent below it.
  git('rm', '--quiet', RATCHET);
  git('commit', '--quiet', '--no-verify', '--message', 'Removes the list (#11)');
  const removed = git('rev-parse', 'HEAD');
  const restored = ratchetCommit('Restores the list (#12)', { 'lib/b.ts': 1 });
  labelSubject(11);
  mergeQueue([
    { commit: removed, pr: 11, approved: true },
    { commit: restored, pr: 12, approved: false },
  ]);
  expect(approval(queue)).toBe('SHRINK_ONLY_GROWTH_APPROVED=false\n');

  // Unapproved #12 renames the list aside, so only the old path names it; approved #11 renames it back.
  git('reset', '--quiet', '--hard', 'origin/main');
  const aside = moveCommit('Moves the list aside (#12)', RATCHET, ASIDE);
  const back = moveCommit('Moves it back (#11)', ASIDE, RATCHET);
  mergeQueue([
    { commit: aside, pr: 12, approved: false },
    { commit: back, pr: 11, approved: true },
  ]);
  expect(approval(queue)).toBe('SHRINK_ONLY_GROWTH_APPROVED=false\n');
});

test("an unapproved PR that only shrinks a list leaves the approved PR's growth approved", () => {
  const queue = onMain();
  const grown = ratchetCommit('Grows the list (#11)', { 'lib/b.ts': 1 });
  const shrunk = shrinkCommit('Drops an entry (#12)', 'lib/file-0.ts');
  mergeQueue([
    { commit: grown, pr: 11, approved: true },
    { commit: shrunk, pr: 12, approved: false },
  ]);
  expect(approval(queue)).toBe('SHRINK_ONLY_GROWTH_APPROVED=true\n');
});

test("an unapproved PR that moves a list aside or renames it keeps the gate strict, an approved PR's growth beside it", () => {
  const queue = onMain();
  const grown = ratchetCommit('Grows the list (#11)', { 'lib/b.ts': 1 });
  const aside = moveCommit('Moves the list aside (#12)', RATCHET, ASIDE);
  mergeQueue([
    { commit: grown, pr: 11, approved: true },
    { commit: aside, pr: 12, approved: false },
  ]);
  expect(approval(queue)).toBe('SHRINK_ONLY_GROWTH_APPROVED=false\n');

  // A rename into the list's path, the same entries, is growth too: each entry is new at that path.
  git('reset', '--quiet', '--hard', 'origin/main');
  const moved = moveCommit('Moves the list aside (#11)', RATCHET, ASIDE);
  const renamed = moveCommit('Renames it back (#12)', ASIDE, RATCHET);
  mergeQueue([
    { commit: moved, pr: 11, approved: true },
    { commit: renamed, pr: 12, approved: false },
  ]);
  expect(approval(queue)).toBe('SHRINK_ONLY_GROWTH_APPROVED=false\n');
});

test('an unapproved PR that restores a removed list with a higher ceiling keeps the gate strict', () => {
  const queue = onMain();
  git('rm', '--quiet', RATCHET);
  git('commit', '--quiet', '--no-verify', '--message', 'Removes the list (#11)');
  const removed = git('rev-parse', 'HEAD');
  const restored = ratchetCommit('Restores the list (#12)', { 'lib/file-0.ts': 2 });
  mergeQueue([
    { commit: removed, pr: 11, approved: true },
    { commit: restored, pr: 12, approved: false },
  ]);
  expect(approval(queue)).toBe('SHRINK_ONLY_GROWTH_APPROVED=false\n');
});

// Merge-queue run 45741947708: #557, unapproved, edited a list's file outside the list, and the
// step dropped #512's approval for the commit ahead of it.
test("the replay of run 45741947708: an unapproved PR that edits a list's file outside the list keeps the approval", () => {
  const queue = onMain();
  const VOLUME = 'lib/attention/count-volume.test.ts';
  const volume = (row: string): string =>
    `function workRows() {\n  return [{ ${row} }];\n}\nconst HISTORY_READS: Readonly<Record<string, number>> = {};\n`;
  mkdirSync(join(repository, 'lib/attention'), { recursive: true });
  writeFileSync(join(repository, VOLUME), volume('updated_at: RECENT'));
  git('add', VOLUME);
  git('commit', '--quiet', '--no-verify', '--message', 'Main');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const approved = ratchetCommit('#512 grows the list (#512)', { 'lib/b.ts': 1 });
  writeFileSync(join(repository, VOLUME), volume('updated_at: RECENT, work_execution_events: []'));
  git('add', VOLUME);
  git('commit', '--quiet', '--no-verify', '--message', '#557 edits the file (#557)');
  const edited = git('rev-parse', 'HEAD');
  mergeQueue([
    { commit: approved, pr: 512, approved: true },
    { commit: edited, pr: 557, approved: false },
  ]);
  expect(approval(queue)).toBe('SHRINK_ONLY_GROWTH_APPROVED=true\n');
});

test("a merge commit in the queue's range fails the step: it brings in commits no queue entry names", () => {
  const queue = onMain();
  git('switch', '--quiet', '--create', 'side');
  ratchetCommit('A side commit', { 'lib/b.ts': 1 });
  git('switch', '--quiet', 'main');
  git('merge', '--quiet', '--no-ff', '--message', 'Queue entry (#11)', 'side');
  labelSubject(11);
  mergeQueue([{ commit: git('rev-parse', 'HEAD'), pr: 11, approved: true }]);
  expect(approval(queue)).toBeUndefined();
  expect(read('env')).toBe('');
});

test('a queue run that touches no list asks GitHub nothing and waives nothing', () => {
  const queue = onMain();
  commit('This entry (#12)');
  expect(approval(queue)).toBe('SHRINK_ONLY_GROWTH_APPROVED=false\n');
  expect(read('gh.calls')).toBe('');
});

test('a queue run whose merge queue cannot be read fails the step instead of passing it as approved', () => {
  const queue = onMain();
  ratchetCommit('Ahead in the queue (#11)', { 'lib/b.ts': 1 });
  writeFileSync(join(stub, 'queue.fail'), '');
  expect(approval(queue)).toBeUndefined();
  expect(read('env')).toBe('');
});

test('a queue run without the merge base with origin/main fails the step', () => {
  commit('This entry (#12)');
  expect(prepare('approval', { CI_EVENT: 'integration', CI_PRS: '12' }).passed).toBe(false);
  expect(read('env')).toBe('');
});

test("a pull request run takes only its own PR's approval", () => {
  writeFileSync(join(stub, 'labels-7.json'), JSON.stringify([{ name: 'approved: list growth' }]));
  expect(prepare('approval', { CI_EVENT: 'pr', CI_PRS: '8', CI_BASE_SHA: 'HEAD^1' }).passed).toBe(true);
  expect(read('env')).toBe('SHRINK_ONLY_GROWTH_APPROVED=false\n');
  expect(read('gh.calls')).not.toContain('/issues/7/');
});

test('an approval that cannot be read fails the step instead of passing it as unapproved', () => {
  expect(prepare('approval', { CI_EVENT: 'pr', CI_PRS: 'not a number' }).passed).toBe(false);
  expect(read('env')).toBe('');
});

const LOOPBACK = 'supabase_db_werkflow-app 127.0.0.1:54322->5432/tcp\n';

test("a stack that already runs fails the step unless the host serves CI alone, so no job tests another's schema", () => {
  writeFileSync(join(stub, 'containers'), LOOPBACK);
  writeFileSync(join(stub, 'started-containers'), LOOPBACK);
  const refused = prepare('stack', {});
  expect(refused.passed).toBe(false);
  expect(refused.output).toContain('A stack of the project runs already');
  expect(read('calls')).not.toContain('supabase stop');
  expect(read('calls')).not.toContain('supabase start');
  // Only a stack the job started is the runner's to stop afterwards (scripts/ci/process-executor.ts).
  expect(read('env')).not.toContain('CI_STACK_STARTED');

  const replaced = prepare('stack', { CI_REPLACE_STACK: '1' });
  expect(replaced.passed).toBe(true);
  const calls = read('calls');
  expect(calls.indexOf('supabase stop --no-backup')).toBeLessThan(calls.indexOf('supabase start'));
  expect(read('env')).toContain('CI_STACK_STARTED=1\n');
});

test('a stack port published beyond loopback fails the start', () => {
  writeFileSync(join(stub, 'started-containers'), 'supabase_kong_werkflow-app 0.0.0.0:54321->8000/tcp\n');
  const started = prepare('stack', {});
  expect(started.passed).toBe(false);
  expect(started.output).toContain('published on every address');
  expect(read('calls')).toContain(
    'docker network create --label com.supabase.cli.project=werkflow-app --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 supabase_network_werkflow-app',
  );
  expect(existsSync(join(repository, '.env.local-stack-backup'))).toBe(false);
});

test("the stack's environment is recorded and cached, and a later job takes it without a second stack", () => {
  writeFileSync(join(stub, 'started-containers'), LOOPBACK);
  const cache = join(stub, 'cache');
  expect(prepare('stack', { CI_CACHE_DIR: cache }).passed).toBe(true);
  const recorded = readFileSync(join(repository, '.env.local-stack-backup'), 'utf8');
  expect(recorded).toContain('NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n');
  expect(recorded).toContain('R2_ENDPOINT=http://127.0.0.1:54321/storage/v1/s3\n');

  rmSync(join(repository, '.env.local-stack-backup'));
  writeFileSync(join(stub, 'calls'), '');
  writeFileSync(join(stub, 'env'), '');
  expect(prepare('stack-environment', { CI_CACHE_DIR: cache }).passed).toBe(true);
  expect(readFileSync(join(repository, '.env.local-stack-backup'), 'utf8')).toBe(recorded);
  expect(read('calls')).toBe('');
  expect(read('env')).toBe('');
});

test('the trusted siblings step, run from outside the tested checkout, clones both beside CI_CHECKOUT', () => {
  // git as a stub that records each clone and makes its destination, so no network is used.
  const tools = join(stub, 'tools');
  mkdirSync(tools);
  writeFileSync(
    join(tools, 'git'),
    `#!/usr/bin/env bash\necho "$* config:\${GIT_CONFIG_KEY_0:-none}" >> "$STUB/git.calls"\nmkdir -p "\${@: -1}"\n`,
  );
  chmodSync(join(tools, 'git'), 0o755);
  // The step runs in the repository folder, as from the trusted copy; the checkout is another one.
  const checkout = join(stub, 'jobs', 'fast', 'checkout');
  mkdirSync(checkout, { recursive: true });
  const ran = prepare('siblings', {
    PATH: `${tools}:${stub}:${process.env.PATH}`,
    CI_CHECKOUT: checkout,
    SIBLING_REPOSITORIES_TOKEN: 'sibling-token',
  });
  expect(ran.passed, ran.output).toBe(true);
  const parent = join(stub, 'jobs', 'fast');
  expect(read('git.calls').trim().split('\n')).toEqual([
    `clone --quiet --depth 1 https://github.com/werk-flow/werkflow-website ${join(parent, 'werkflow-website')} config:none`,
    `clone --quiet --depth 1 https://github.com/werk-flow/werkflow-business ${join(parent, 'werkflow-business')} config:http.https://github.com/.extraheader`,
  ]);
  // Nothing lands beside the folder the step ran in, and the token is in no argument.
  expect(existsSync(join(stub, 'werkflow-website'))).toBe(false);
  expect(existsSync(join(stub, 'werkflow-business'))).toBe(false);
  expect(read('git.calls')).not.toContain('sibling-token');
  expect(read('env')).toBe('');
});

test('each sibling clone in place is kept and each missing one made; without the token business is marked unreadable', () => {
  // The trusted step cloned both: nothing more to do, and nothing marked.
  mkdirSync(join(stub, 'werkflow-website'));
  mkdirSync(join(stub, 'werkflow-business'));
  expect(prepare('siblings', {}).passed).toBe(true);
  expect(read('env')).toBe('');
  // Only the website is in place and no token is given: the business clone is marked, not skipped silently.
  rmSync(join(stub, 'werkflow-business'), { recursive: true });
  const marked = prepare('siblings', {});
  expect(marked.passed).toBe(true);
  expect(read('env')).toBe('WERKFLOW_UNREADABLE_SIBLINGS=werkflow-business\n');
  expect(existsSync(join(stub, 'werkflow-business'))).toBe(false);
});

test('a job part the mirror does not know fails `for` before any step runs', () => {
  const ran = spawnSync(process.execPath, [PREPARE, 'for', 'fast'], {
    cwd: repository,
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      HOME: stub,
      STUB: stub,
      CI_PART: 'everything',
    },
  });
  expect(ran.status).toBe(1);
  expect(`${ran.stdout}${ran.stderr}`).toContain('CI_PART everything is no part');
  expect(`${ran.stdout}${ran.stderr}`).not.toContain('[prepare] fast:');
});
