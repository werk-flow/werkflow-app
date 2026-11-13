// Reads .github/workflows/ci.yml for the tests that run its own step scripts as GitHub would.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const workflow: unknown = Bun.YAML.parse(
  await Bun.file(resolve(import.meta.dir, '../../.github/workflows/ci.yml')).text(),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value at `path` in ci.yml, or undefined when a step of it is missing. */
export function ciWorkflowAt(...path: (string | number)[]): unknown {
  let value = workflow;
  for (const key of path)
    value =
      Array.isArray(value) && typeof key === 'number'
        ? value[key]
        : isRecord(value)
          ? value[String(key)]
          : undefined;
  return value;
}

/** The text at `path` in ci.yml; throws when it is missing or no text. */
export function ciWorkflowText(...path: (string | number)[]): string {
  const value = ciWorkflowAt(...path);
  if (typeof value !== 'string') throw new Error(`ci.yml has no text at ${path.join('.')}`);
  return value;
}

/** The step of `job` with this name; throws when there is none. */
export function ciStep(job: string, name: string): Record<string, unknown> {
  const steps = ciWorkflowAt('jobs', job, 'steps');
  const list: unknown[] = Array.isArray(steps) ? steps : [];
  const step = list.find((candidate) => isRecord(candidate) && candidate.name === name);
  if (!isRecord(step)) throw new Error(`ci.yml has no step "${name}" in job ${job}`);
  return step;
}

/** Runs the named step's script with GitHub's bash flags and only the given environment and PATH. */
export function runCiStep(
  job: string,
  name: string,
  options: { env: Record<string, string>; cwd?: string },
): { passed: boolean; output: string } {
  const script = ciStep(job, name).run;
  if (typeof script !== 'string') throw new Error(`The step "${name}" in job ${job} runs no script`);
  const run = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    encoding: 'utf8',
    cwd: options.cwd,
    env: { NODE_ENV: 'test', PATH: process.env.PATH, ...options.env },
  });
  return { passed: run.status === 0, output: run.stdout + run.stderr };
}
