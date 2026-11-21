// The variables a job's environment steps pass on to its body off GitHub Actions: each step appends
// `KEY=value` lines to GITHUB_ENV (scripts/ci/prepare.ts), as on Actions. The process executor
// (scripts/ci/process-executor.ts) never launches the body with them: it names the file in
// CI_PASSED_ENV, and the body takes them in as the job user (scripts/ci/job.ts).
import { existsSync, readFileSync } from 'node:fs';

/** The `KEY=value` lines at `path`; none when it is missing. */
export function passedVariables(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line) => {
        const index = line.indexOf('=');
        return index > 0 ? [[line.slice(0, index), line.slice(index + 1)]] : [];
      }),
  );
}

/**
 * Sets the variables of the file CI_PASSED_ENV names in `env`, over what it held; nothing without
 * one. CI_STACK_STARTED tells the executor which stack to stop, never the body.
 */
export function applyPassedVariables(env: Record<string, string | undefined>): void {
  if (!env.CI_PASSED_ENV) return;
  const passed = passedVariables(env.CI_PASSED_ENV);
  delete passed.CI_STACK_STARTED;
  Object.assign(env, passed);
}
