// The CI App that posts `Check` and `Full run / Check` as check runs (werk-flow/werkflow-planning#512).
// .github/scripts/check-app.json names its id, or null until the owner creates it. The ruleset on
// `main` pins `Check` to that App, and the release and full-run gates trust it beside GitHub
// Actions (.github/scripts/check-app.sh reads the file alike). scripts/ci/publish-check.ts posts as it
// with an installation token the runner mints; the repository never reads the App's key.
// The file holds exactly {"appId": <id>} or {"appId": null}, spaces aside: both readers match the
// text with the same pattern, so no JSON parser's leniency decides which App counts. Fifteen digits
// at most keep the id a safe integer.
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { z } from 'zod';
import type { CiEvent } from './dag';
import { type CiResult, parseResult } from './results';

/** The configuration file, from the repository root. */
export const CHECK_APP_CONFIG = '.github/scripts/check-app.json';

const CONFIG =
  /^[ \t\r\n]*\{[ \t\r\n]*"appId"[ \t\r\n]*:[ \t\r\n]*(null|[1-9][0-9]{0,14})[ \t\r\n]*\}[ \t\r\n]*$/;

/** The configured App's id, null while none is configured, or why the file cannot count. */
export function readCheckApp(path: string): { appId: number | null } | { problem: string } {
  const id = existsSync(path) ? CONFIG.exec(readFileSync(path, 'utf8'))?.[1] : undefined;
  if (id === undefined)
    return { problem: `${path} must hold {"appId": <a positive integer>} or {"appId": null}` };
  return { appId: id === 'null' ? null : Number(id) };
}

/** The check run a run's Check posts: `Full run / Check` for a full run, which the release reads. */
function checkRunName(event: CiEvent): 'Check' | 'Full run / Check' {
  return event === 'full' ? 'Full run / Check' : 'Check';
}

/** The body of GitHub's "create a check run" request: queued when a run is accepted, completed at its end. */
type CheckRunRequest = {
  name: 'Check' | 'Full run / Check';
  head_sha: string;
  details_url?: string;
  /** The run's identity (runIdentityOf): which run a check run on the commit belongs to. */
  external_id: string;
  output: { title: string; summary: string };
} & (
  | { status: 'queued' }
  | { status: 'completed'; started_at: string; completed_at: string; conclusion: 'success' | 'failure' }
);

const SHA = /^[0-9a-f]{40}$/;

/** What the runner's scheduler, not a job, says the run is: a result must match it. */
type ScheduledRun = {
  /** CI_RUN_URL. */
  runUrl: string;
  /** CI_RUN_ATTEMPT: a rerun shares the run's URL, so an earlier attempt's result never counts. */
  attempt: number;
  /** CI_EVENT: only a scheduled full run posts `Full run / Check`. */
  event: CiEvent;
  /** CI_COMMIT: the commit the runner checked out. */
  commit: string;
  /** CI_PR_HEAD_SHA: a pull request's head under the merge commit the runner built, or undefined. */
  prHead: string | undefined;
};

/** The commit the run's check run goes on: the PR head of a `pr` run on a merge commit, else the run's commit. */
function headOf(scheduled: ScheduledRun): { head: string } | { problem: string } {
  const head = scheduled.prHead ?? scheduled.commit;
  if (!SHA.test(scheduled.commit) || !SHA.test(head))
    return { problem: `${scheduled.commit} or ${head} is no commit id` };
  if (head !== scheduled.commit && scheduled.event !== 'pr')
    return { problem: `a ${scheduled.event} run posts on its own commit, not on ${head}` };
  return { head };
}

const detailsOf = (runUrl: string) => (runUrl.startsWith('https://') ? { details_url: runUrl } : {});

/** A run's identity on its check runs: a rerun shares the run's URL, so the attempt belongs to it. */
const runIdentityOf = (scheduled: ScheduledRun) => `${scheduled.runUrl} attempt ${scheduled.attempt}`;

/**
 * The queued check run the scheduler posts when it accepts a run, before any job starts. GitHub
 * reads the newest check run of a name, so it withdraws every earlier result on the commit: a
 * draft's green fast tier never stands for the integration run that a ready PR waits for. A full
 * run posts none (undefined): no earlier result on main needs withdrawing, and a queued
 * `Full run / Check` that a dead run left behind would read as a full run still running and hold
 * main's next full runs back (.github/scripts/main-full-run.sh).
 */
export function queuedCheckRunOf(
  scheduled: ScheduledRun,
): { request: CheckRunRequest } | { problem: string } | undefined {
  if (scheduled.event === 'full') return undefined;
  const head = headOf(scheduled);
  if ('problem' in head) return head;
  return {
    request: {
      name: checkRunName(scheduled.event),
      head_sha: head.head,
      status: 'queued',
      ...detailsOf(scheduled.runUrl),
      external_id: runIdentityOf(scheduled),
      output: {
        title: 'Waiting',
        summary: `The ${scheduled.event} run waits or runs; until it ends, no earlier result counts.\n\nRun: ${scheduled.runUrl}`,
      },
    },
  };
}

/**
 * The check run for this run's Check result, or why none may be posted. It passes only a complete,
 * passed Check of the scheduled run and attempt from a CI runner; any other Check of that attempt
 * posts a failure. A result of another run, attempt, event or commit posts nothing.
 */
export function checkRunOf(input: {
  check: CiResult | { unreadable: string };
  /** The run's plan result: its start is the run's start. Another run's plan is ignored. */
  plan: CiResult | { unreadable: string };
  scheduled: ScheduledRun;
  now: Date;
}): { request: CheckRunRequest } | { problem: string } {
  const { check, scheduled } = input;
  const runUrl = scheduled.runUrl;
  if ('unreadable' in check) return { problem: check.unreadable };
  if (check.job !== 'check' || check.shard !== null)
    return { problem: `the result is of the ${check.job} job, not of Check` };
  if (
    check.runUrl !== runUrl ||
    check.attempt !== scheduled.attempt ||
    check.event !== scheduled.event ||
    check.commit !== scheduled.commit
  )
    return {
      problem: `the Check result is of the ${check.event} run ${check.runUrl} attempt ${check.attempt ?? 'unknown'} on ${check.commit}, not of the scheduled ${scheduled.event} run ${runUrl} attempt ${scheduled.attempt} on ${scheduled.commit}`,
    };
  const head = headOf(scheduled);
  if ('problem' in head) return head;
  const verdict = checkVerdict(check);
  const plan = input.plan;
  const ownPlan =
    !('unreadable' in plan) &&
    plan.runUrl === runUrl &&
    plan.attempt === scheduled.attempt &&
    plan.tree === check.tree &&
    plan.event === check.event;
  return {
    request: {
      name: checkRunName(check.event),
      head_sha: head.head,
      status: 'completed',
      started_at: ownPlan ? plan.startedAt : check.startedAt,
      completed_at: check.completedAt ?? input.now.toISOString(),
      conclusion: verdict.passed ? 'success' : 'failure',
      ...detailsOf(runUrl),
      external_id: runIdentityOf(scheduled),
      output: {
        title: verdict.passed ? 'Passed' : 'Failed',
        summary: `${verdict.summary}\n\nRun: ${runUrl}\nTree: ${check.tree}\nRunner: ${check.producer ?? 'none'}`,
      },
    },
  };
}

function checkVerdict(check: CiResult): { passed: boolean; summary: string } {
  if (check.status === 'running' || check.completedAt === null)
    return { passed: false, summary: 'Check did not finish.' };
  if (check.producer === null)
    return {
      passed: false,
      summary: 'Check ran outside a CI runner or on a checkout that differs from its commit.',
    };
  if (check.status === 'failed') return { passed: false, summary: 'Check failed; the run names each job.' };
  return { passed: true, summary: check.planReason || 'Every job the plan runs passed.' };
}

/** A result file is at most this large; a larger one is no result. */
const MAX_RESULT_BYTES = 1024 * 1024;

/**
 * A result a job handed over, read as the key's user: only a regular file, never through a link or
 * from a pipe, at most 1 MiB. Nothing of an unreadable file's content reaches the message.
 */
export function readHandoff(path: string): CiResult | { unreadable: string } {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(descriptor).isFile()) return { unreadable: `${path} is no regular file` };
    // One byte past the limit at most, so a file that grows while it is read is still refused.
    const buffer = Buffer.alloc(MAX_RESULT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > MAX_RESULT_BYTES) return { unreadable: `${path} is larger than 1 MiB` };
    return parseResult(buffer.toString('utf8', 0, length)) ?? { unreadable: `${path} is no valid result` };
  } catch {
    return { unreadable: `${path} cannot be opened as a regular file` };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

const postedSchema = z.object({
  id: z.number(),
  name: z.string(),
  head_sha: z.string(),
  conclusion: z.string().nullable(),
  app: z.object({ id: z.number() }),
});

/** The posted check run's id, or why GitHub's answer is not the check run asked for, from the configured App. */
function confirmPosted(
  answer: unknown,
  request: CheckRunRequest,
  appId: number,
): { id: number } | { problem: string } {
  const posted = postedSchema.safeParse(answer);
  if (!posted.success) return { problem: 'GitHub answered with no check run' };
  const { id, name, head_sha, conclusion, app } = posted.data;
  if (app.id !== appId)
    return {
      problem: `the token belongs to App ${app.id}, not the configured App ${appId}; the gates ignore its check run ${id}`,
    };
  const asked = request.status === 'completed' ? request.conclusion : null;
  if (name !== request.name || head_sha !== request.head_sha || conclusion !== asked)
    return { problem: `GitHub holds check run ${id} with another name, commit or conclusion` };
  return { id };
}

const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

const githubHeaders = (token: string) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
});

const PAGE_SIZE = 100;
/** More check runs of one name on one commit than this is no state the publisher decides on. */
const MAX_PAGES = 10;

const listedSchema = z.object({
  total_count: z.number(),
  check_runs: z.array(
    z.object({
      id: z.number(),
      status: z.string(),
      external_id: z.string().nullable(),
      app: z.object({ id: z.number() }).nullable(),
    }),
  ),
});

/**
 * Whether the scheduled run still owns its commit's `Check`, read before its verdict is posted. A
 * run owns it while its own start, the queued check run `start` posted, is the configured App's
 * newest start on the commit; GitHub numbers check runs in creation order. Once a newer run started,
 * an older run's verdict would replace the newer run's queued check, so it is refused. Only starts
 * decide: a verdict an older run posted after a newer start (it read before that start landed)
 * never takes the commit from the newer run, whose own verdict then posts last. A full run posts no
 * start and needs no read. An answer that cannot be read completely refuses.
 */
export async function checkOwnership(input: {
  scheduled: ScheduledRun;
  appId: number;
  token: string;
  repository: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<{ owned: true } | { problem: string }> {
  const { scheduled, appId } = input;
  if (scheduled.event === 'full') return { owned: true };
  const head = headOf(scheduled);
  if ('problem' in head) return head;
  if (!REPOSITORY.test(input.repository))
    return { problem: `GITHUB_REPOSITORY ${input.repository} is no owner/name` };
  const runs: z.infer<typeof listedSchema>['check_runs'] = [];
  for (let page = 1; ; page += 1) {
    if (page > MAX_PAGES) return { problem: `more than ${MAX_PAGES * PAGE_SIZE} Check runs on ${head.head}` };
    const query = `check_name=Check&app_id=${appId}&filter=all&per_page=${PAGE_SIZE}&page=${page}`;
    let response: Response;
    try {
      response = await input.fetch(
        `https://api.github.com/repos/${input.repository}/commits/${head.head}/check-runs?${query}`,
        { headers: githubHeaders(input.token), signal: AbortSignal.timeout(60_000) },
      );
    } catch (error) {
      return {
        problem: `the check runs could not be read (${error instanceof Error ? error.name : 'unknown error'})`,
      };
    }
    if (!response.ok)
      return {
        problem: `GitHub answered ${response.status} to the check run list (request ${response.headers.get('x-github-request-id') ?? 'unknown'})`,
      };
    // An unreadable body is no list, and the schema says so.
    const answer: unknown = await response.json().catch(() => null);
    const listed = listedSchema.safeParse(answer);
    if (!listed.success) return { problem: 'GitHub answered with no check run list' };
    runs.push(...listed.data.check_runs);
    if (listed.data.check_runs.length < PAGE_SIZE) {
      if (runs.length !== listed.data.total_count)
        return { problem: `GitHub listed ${runs.length} of ${listed.data.total_count} check runs` };
      break;
    }
  }
  const [newestStart] = runs
    .filter((run) => run.app?.id === appId && run.status === 'queued')
    .toSorted((one, other) => other.id - one.id);
  if (!newestStart) return { problem: `no start of this run on ${head.head}` };
  if (newestStart.external_id === runIdentityOf(scheduled)) return { owned: true };
  return {
    problem: `a newer run (${newestStart.external_id ?? 'unnamed'}) owns Check on ${head.head}; this run's verdict no longer counts`,
  };
}

/**
 * Posts the check run as the configured App and confirms GitHub holds it from that App. The token
 * goes only into the request's header; no message names it or GitHub's answer body.
 */
export async function postCheckRun(input: {
  request: CheckRunRequest;
  appId: number;
  token: string;
  repository: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<{ id: number } | { problem: string }> {
  if (!REPOSITORY.test(input.repository))
    return { problem: `GITHUB_REPOSITORY ${input.repository} is no owner/name` };
  let response: Response;
  try {
    response = await input.fetch(`https://api.github.com/repos/${input.repository}/check-runs`, {
      method: 'POST',
      headers: { ...githubHeaders(input.token), 'Content-Type': 'application/json' },
      body: JSON.stringify(input.request),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    return { problem: `the request failed (${error instanceof Error ? error.name : 'unknown error'})` };
  }
  if (!response.ok)
    return {
      problem: `GitHub answered ${response.status} (request ${response.headers.get('x-github-request-id') ?? 'unknown'})`,
    };
  // An unreadable body is no check run, and confirmPosted says so.
  const answer: unknown = await response.json().catch(() => null);
  return confirmPosted(answer, input.request, input.appId);
}
