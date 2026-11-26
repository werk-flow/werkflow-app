// The production watcher's reads and writes in .github/workflows/prod-watch.yml. The repository is
// public, so is the job's log: a failure names its call and HTTP status, never a response body, a
// header or the token, and the alert script's own output stays out of the log.
import { spawnSync } from 'node:child_process';

import { type AlertAction, type Title, WatchError, type WatchIo } from './watch';

/** The variable that holds the watcher's Vercel token, a secret of the GitHub environment `production`. */
export const TOKEN_VARIABLE = 'PROD_WATCH_VERCEL_TOKEN';
const ALERT_SCRIPT = '.github/scripts/alert-issue.sh';

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
/** Runs a program; it prints nothing to the job's log, and its output is read only when asked for. */
type Runner = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; output: boolean },
) => { status: number | null; stdout: string };

export const runProgram: Runner = (command, args, { env, output }) => {
  const run = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    stdio: ['ignore', output ? 'pipe' : 'ignore', 'ignore'],
  });
  return { status: run.status, stdout: run.stdout ?? '' };
};

/** The watcher's reads and writes, on Vercel's API with the token and on GitHub with `gh`. */
export function liveIo(env: NodeJS.ProcessEnv, fetcher: Fetcher, runner: Runner): WatchIo {
  // No child process gets the Vercel token: gh and the alert script need GitHub's token only. A
  // spawn leaves out a variable whose value is undefined.
  const childEnv: NodeJS.ProcessEnv = { ...env, [TOKEN_VARIABLE]: undefined };
  const repository = env.GH_REPO ?? '';

  async function vercel(path: string, body?: unknown): Promise<unknown> {
    const call = path.split('?')[0] ?? path;
    const token = env[TOKEN_VARIABLE] ?? '';
    if (!token)
      throw new WatchError(`${TOKEN_VARIABLE} is not set; the GitHub environment production holds it`);
    let answer: Response;
    try {
      answer = await fetcher(`https://api.vercel.com${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new WatchError(
        `Vercel did not answer ${call}: ${error instanceof Error ? error.name : 'unknown failure'}`,
      );
    }
    if (!answer.ok) throw new WatchError(`Vercel answered ${answer.status} to ${call}`);
    try {
      const parsed: unknown = await answer.json();
      return parsed;
    } catch {
      throw new WatchError(`Vercel's answer to ${call} is no JSON`);
    }
  }

  function gh(args: string[], what: string): string {
    const run = runner('gh', args, { env: childEnv, output: true });
    if (run.status !== 0) throw new WatchError(`gh failed to read ${what} (exit ${run.status ?? 'none'})`);
    return run.stdout;
  }

  return {
    vercel,
    productionHead: async () =>
      gh(
        ['api', `repos/${repository}/branches/production`, '--jq', '.commit.sha'],
        'the head of production',
      ).trim(),
    openTitles: async () =>
      new Set(
        gh(
          [
            'api',
            '--paginate',
            `repos/${repository}/issues?state=open&labels=ci-alert&per_page=100`,
            '--jq',
            '.[].title',
          ],
          'the open alerts',
        )
          .split('\n')
          .filter(Boolean),
      ),
    act: async (title: Title, action: AlertAction, note: string) => {
      const run = runner('bash', [ALERT_SCRIPT, action, title, note], {
        env: { ...childEnv, AFFECTS_PRODUCTION: 'true' },
        output: false,
      });
      if (run.status !== 0)
        throw new WatchError(`${ALERT_SCRIPT} ${action} "${title}" failed (exit ${run.status ?? 'none'})`);
    },
  };
}
