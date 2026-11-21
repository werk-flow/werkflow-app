// The CI App that posts `Check` and `Full run / Check` as check runs (werk-flow/werkflow-planning#512).
// .github/scripts/check-app.json names its id, or null until the owner creates it. The ruleset on
// `main` pins `Check` to that App, and the release and full-run gates trust it beside GitHub
// Actions (.github/scripts/check-app.sh reads the file alike). scripts/ci/publish-check.ts posts as it
// with an installation token the runner mints; the repository never reads the App's key.
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { CiEvent } from './dag';
import type { CiResult } from './results';

/** The configuration file, from the repository root. */
export const CHECK_APP_CONFIG = '.github/scripts/check-app.json';

const configSchema = z.strictObject({ appId: z.number().int().positive().nullable() });

/** The configured App's id, null while none is configured, or why the file cannot count. */
export function readCheckApp(path: string): { appId: number | null } | { problem: string } {
  if (!existsSync(path)) return { problem: `${path} is missing` };
  try {
    const parsed = configSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (parsed.success) return { appId: parsed.data.appId };
  } catch {
    // Unreadable or no JSON: the same answer as a malformed value.
  }
  return { problem: `${path} must hold {"appId": <a positive integer>} or {"appId": null}` };
}

/** The check run a run's Check posts: `Full run / Check` for a full run, which the release reads. */
function checkRunName(event: CiEvent): 'Check' | 'Full run / Check' {
  return event === 'full' ? 'Full run / Check' : 'Check';
}

/** The body of GitHub's "create a check run" request. */
type CheckRunRequest = {
  name: 'Check' | 'Full run / Check';
  head_sha: string;
  status: 'completed';
  started_at: string;
  completed_at: string;
  conclusion: 'success' | 'failure';
  details_url?: string;
  output: { title: string; summary: string };
};

const SHA = /^[0-9a-f]{40}$/;

/**
 * The check run for this run's Check result, or why none may be posted. It passes only a complete,
 * passed Check of this run from a CI runner; any other Check of this run posts a failure. A result
 * of another run, or a head the run did not test, posts nothing: its commit is not this run's.
 */
export function checkRunOf(input: {
  check: CiResult | { unreadable: string };
  /** The run's plan result: its start is the run's start. Another run's plan is ignored. */
  plan: CiResult | { unreadable: string };
  /** The run's identity, CI_RUN_URL. */
  runUrl: string;
  /** A pull request's head under a merge-commit checkout (CI_PR_HEAD_SHA), or undefined. */
  prHead: string | undefined;
  /** The parents of a commit in the checkout. */
  parents: (commit: string) => readonly string[];
  now: Date;
}): { request: CheckRunRequest } | { problem: string } {
  const { check, runUrl, prHead } = input;
  if ('unreadable' in check) return { problem: check.unreadable };
  if (check.job !== 'check' || check.shard !== null)
    return { problem: `the result is of the ${check.job} job, not of Check` };
  if (check.runUrl !== runUrl)
    return { problem: `the Check result is of run ${check.runUrl}, not ${runUrl}` };
  let head = check.commit;
  if (prHead !== undefined && prHead !== check.commit) {
    if (check.event !== 'pr') return { problem: `a ${check.event} run tests its own commit, not ${prHead}` };
    if (!SHA.test(prHead) || !input.parents(check.commit).includes(prHead))
      return { problem: `${prHead} is no parent of the tested merge commit ${check.commit}` };
    head = prHead;
  }
  const verdict = checkVerdict(check);
  const plan = input.plan;
  const ownPlan =
    !('unreadable' in plan) &&
    plan.runUrl === runUrl &&
    plan.tree === check.tree &&
    plan.event === check.event;
  return {
    request: {
      name: checkRunName(check.event),
      head_sha: head,
      status: 'completed',
      started_at: ownPlan ? plan.startedAt : check.startedAt,
      completed_at: check.completedAt ?? input.now.toISOString(),
      conclusion: verdict.passed ? 'success' : 'failure',
      ...(runUrl.startsWith('https://') ? { details_url: runUrl } : {}),
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
  if (name !== request.name || head_sha !== request.head_sha || conclusion !== request.conclusion)
    return { problem: `GitHub holds check run ${id} with another name, commit or conclusion` };
  return { id };
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
  apiUrl: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<{ id: number } | { problem: string }> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(input.repository))
    return { problem: `GITHUB_REPOSITORY ${input.repository} is no owner/name` };
  let response: Response;
  try {
    response = await input.fetch(`${input.apiUrl}/repos/${input.repository}/check-runs`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${input.token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
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
