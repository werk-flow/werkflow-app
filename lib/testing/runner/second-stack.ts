import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { operands, type StartedProgram, startedProgramRefusal } from './heavy-command';

/**
 * The rule of the second-stack guard (.claude/hooks/refuse-second-stack.ts):
 * a machine runs one local Supabase stack, the shared one every worktree uses
 * (docs/technical/environments.md, "Work in a worktree"). The Supabase CLI
 * names a stack's containers after the `project_id` of its config, so a
 * `supabase start` from a folder with another id starts a whole second stack:
 * about 2 GiB that no gate had measured when the PC overloaded on 2026-11-11
 * (werk-flow/werkflow-planning#294). The guard refuses that start and passes
 * one that reaches the shared stack.
 *
 * Threat model: the guard stops habit, as the heavy command guard does. A
 * script that starts a stack itself, or a command the reader cannot read, passes.
 */

type Environment = Readonly<Record<string, string | undefined>>;
const WORKDIR_VARIABLE = 'SUPABASE_WORKDIR';

/** The stack a Supabase CLI call in `workdir` belongs to: the nearest config's `project_id`, by default its folder's name. */
export function stackProjectId(workdir: string): string | undefined {
  for (let folder = resolve(workdir); ; folder = dirname(folder)) {
    const config = join(folder, 'supabase', 'config.toml');
    if (existsSync(config)) {
      const id = /^project_id\s*=\s*"([^"]*)"/m.exec(readFileSync(config, 'utf8'))?.[1];
      return id || basename(folder);
    }
    if (dirname(folder) === folder) return undefined;
  }
}

/** The Supabase CLI's global flags that take the next word as their value (`supabase --help`). */
const GLOBAL_VALUE_FLAGS = new Set([
  '--workdir',
  '--output',
  '-o',
  '--profile',
  '--network-id',
  '--dns-resolver',
]);

/** The value of the global `--workdir` flag, or undefined. */
function workdirFlag(args: readonly string[]): string | undefined {
  for (const [index, arg] of args.entries()) {
    if (arg === '--workdir') return args[index + 1];
    if (arg.startsWith('--workdir=')) return arg.slice('--workdir='.length);
  }
  return undefined;
}

/** Whether a Supabase CLI call starts a stack: `supabase start` or `supabase db start`, past any global flag. */
function startsStack(args: readonly string[]): boolean {
  const [first, second] = operands(args, GLOBAL_VALUE_FLAGS);
  return first === 'start' || (first === 'db' && second === 'start');
}

/**
 * The refusal of a shell command, started in `cwd`, that starts a local
 * Supabase stack other than `sharedProjectId`'s, or undefined. The stack is
 * the one of `--workdir`, else of `SUPABASE_WORKDIR` (set on the command, on a
 * shell around it, by an earlier `export`, or in the environment), else of the
 * folder the command runs in.
 */
export function secondStackRefusal(
  command: string,
  cwd: string,
  sharedProjectId: string,
  environment: Environment = process.env,
): string | undefined {
  return startedProgramRefusal(command, cwd, (started: StartedProgram) => {
    if (started.name.replace(/@.*$/, '') !== 'supabase' || !startsStack(started.args)) return undefined;
    const assigned = started.assignments
      .findLast((word) => word.startsWith(`${WORKDIR_VARIABLE}=`))
      ?.slice(WORKDIR_VARIABLE.length + 1);
    const workdir = workdirFlag(started.args) ?? assigned ?? environment[WORKDIR_VARIABLE] ?? '.';
    const projectId = stackProjectId(resolve(started.folder, workdir));
    // Without a config the CLI starts nothing.
    if (projectId === undefined || projectId === sharedProjectId) return undefined;
    return [
      `Refused: this would start a second local Supabase stack, \`${projectId}\`, beside the shared \`${sharedProjectId}\` stack: about 2 GiB of memory that every other thread on this machine then lacks.`,
      'Every worktree uses the shared stack (docs/technical/environments.md, "Work in a worktree").',
      'For a database of your own, run the group on Boat: `bun run test:verify --group <id>` (docs/technical/boat-verification.md).',
    ].join(' ');
  });
}
