// Reads a workflow in .github/workflows for the tests that run its own step scripts as GitHub would.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The workflow `.github/workflows/<file>`, with readers that throw where a test expects text or a step. */
export function readWorkflow(file: string) {
  const workflow: unknown = Bun.YAML.parse(
    readFileSync(resolve(import.meta.dir, '../../.github/workflows', file), 'utf8'),
  );

  /** The value at `path`, or undefined when a step of it is missing. */
  function at(...path: (string | number)[]): unknown {
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

  /** The text at `path`; throws when it is missing or no text. */
  function text(...path: (string | number)[]): string {
    const value = at(...path);
    if (typeof value !== 'string') throw new Error(`${file} has no text at ${path.join('.')}`);
    return value;
  }

  /** The step of `job` with this name; throws when there is none. */
  function step(job: string, name: string): Record<string, unknown> {
    const steps = at('jobs', job, 'steps');
    const list: unknown[] = Array.isArray(steps) ? steps : [];
    const found = list.find((candidate) => isRecord(candidate) && candidate.name === name);
    if (!isRecord(found)) throw new Error(`${file} has no step "${name}" in job ${job}`);
    return found;
  }

  /** Runs the named step's script with GitHub's bash flags and only the given environment and PATH. */
  function runStep(
    job: string,
    name: string,
    options: { env: Record<string, string>; cwd?: string },
  ): { passed: boolean; output: string } {
    const script = step(job, name).run;
    if (typeof script !== 'string') throw new Error(`The step "${name}" in job ${job} runs no script`);
    const run = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      encoding: 'utf8',
      cwd: options.cwd,
      env: { NODE_ENV: 'test', PATH: process.env.PATH, ...options.env },
    });
    return { passed: run.status === 0, output: run.stdout + run.stderr };
  }

  return { at, text, step, runStep };
}
