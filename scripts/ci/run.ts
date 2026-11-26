// The child processes of a CI job body (scripts/ci/job.ts): each runs with its output shown live.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { CiResult } from '../../lib/testing/ci/results';

export const repository = resolve(import.meta.dir, '../..');

type GroupOutcome = CiResult['groups'][number];
type Command = readonly [command: string, args: readonly string[], env?: Readonly<Record<string, string>>];

/** Runs a command in the repository, shows its output as it comes, and returns its exit code and output. */
export function run(...[command, args, env = {}]: Command): Promise<{ code: number; output: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: repository,
      // Every child runs in CI mode: verify.ts runs here, never on Boat, under CI's rules.
      env: { ...process.env, CI: 'true', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => resolveRun({ code: code ?? 1, output }));
  });
}

/** Runs the commands of a step that is no verification group, until one fails, and records the step as a group. */
export async function step(id: string, commands: readonly Command[]): Promise<GroupOutcome> {
  const started = Date.now();
  for (const command of commands)
    if ((await run(...command)).code !== 0)
      return { id, outcome: 'failed', durationMs: Date.now() - started };
  return { id, outcome: 'passed', durationMs: Date.now() - started };
}

const reportSchema = z.object({
  results: z.array(
    z.object({
      groupId: z.string(),
      status: z.enum(['passed', 'failed', 'blocked']),
      durationMs: z.number().nonnegative(),
    }),
  ),
});
/** verify.ts's summary line names its report. */
const REPORT_LINE = /^\[verify\] (?:passed|failed) in [\d.]+ min \(.*\): (\S+report\.json)$/m;

/**
 * Runs `groups` through scripts/verify.ts, the engine of every local run, and returns each group's
 * outcome from its report. `--fresh`: a CI job never takes a proof from an earlier run on the same
 * machine; only the reuse that scripts/ci/job.ts plan decides stands for a run. A group the report
 * does not list did not run. `exited` is false for a failed exit, even beside a passed report.
 */
export async function verify(
  groups: readonly string[],
  flags: readonly string[],
): Promise<{ groups: GroupOutcome[]; exited: boolean }> {
  if (!groups.length) return { groups: [], exited: true };
  const { code, output } = await run(process.execPath, [
    'scripts/verify.ts',
    'run',
    '--group',
    groups.join(','),
    '--fresh',
    ...flags,
  ]);
  const reportPath = REPORT_LINE.exec(output)?.[1];
  const report =
    reportPath && existsSync(reportPath)
      ? reportSchema.safeParse(JSON.parse(readFileSync(reportPath, 'utf8')))
      : undefined;
  const results = report?.success ? report.data.results : [];
  const outcomes: GroupOutcome[] = groups.map((id) => {
    const result = results.findLast((candidate) => candidate.groupId === id);
    return { id, outcome: result?.status ?? 'not-run', durationMs: result?.durationMs ?? 0 };
  });
  return { groups: outcomes, exited: code === 0 };
}
