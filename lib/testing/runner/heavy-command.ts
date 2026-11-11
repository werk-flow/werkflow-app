import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { type ShellWord, SCRIPT_FLAG, SHELLS, program, readShell } from '../../security/shell-words';

/**
 * The rule of the heavy command guard (.claude/hooks/refuse-heavy-commands.ts):
 * a whole-repository type check, a broad type-aware lint and a Next build each
 * take gigabytes, so they run inside a machine-wide heavy slot
 * (lib/testing/runner/heavy-slot.ts) or on Boat. Run directly, several overlap
 * and stall the shared PC. The guard refuses the direct form and names the
 * sanctioned one; a targeted run stays allowed.
 */

/**
 * Type-aware eslint's peak memory on the 16 GB PC (werk-flow/werkflow-planning#94):
 * 1.23 GiB for 1 file, 1.42 for 52, 1.80 for 148, 2.58 for 316, and 3.3 to 4.1
 * for the repository's 2,800 (heavy-slot.ts). The lints agents run most name a
 * few files or one feature folder (12 to 65 files). Above this many files, a
 * lint takes a heavy slot.
 */
export const BROAD_LINT_FILES = 150;
const LINTED = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** Runners that start their first operand as the program: `bunx tsc`, `node .../tsc`, `timeout 600 tsc`. */
const LAUNCHERS = new Set([
  'bunx',
  'npx',
  'node',
  'env',
  'nice',
  'ionice',
  'nohup',
  'timeout',
  'exec',
  'command',
  'time',
]);
/** Launcher flags that take the next word as their value. */
const VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  nice: new Set(['-n', '--adjustment']),
  ionice: new Set(['-c', '-n', '-p']),
  timeout: new Set(['-s', '--signal', '-k', '--kill-after']),
  env: new Set(['-u', '--unset', '-C', '--chdir']),
  npx: new Set(['-p', '--package']),
  bunx: new Set(['-p', '--package']),
  node: new Set(['-r', '--require', '--import']),
};
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
/** tsc flags that print and exit without building the program. */
const TSC_INFO = new Set(['-v', '--version', '-h', '--help', '--all', '--init', '--showConfig']);

/** The programs a simple command starts, through launchers and nested `sh -c` scripts. */
function startedPrograms(words: ShellWord[], depth = 0): { name: string; args: string[] }[] {
  const call = program(words);
  if (!call) return [];
  let name = call.name;
  let args = call.args.map((arg) => arg.text);
  for (;;) {
    if (SHELLS.has(name)) {
      const flag = args.findIndex((arg) => SCRIPT_FLAG.test(arg));
      const script = flag === -1 ? undefined : args[flag + 1];
      const reading = script && depth < 4 ? readShell(script) : undefined;
      return reading ? reading.commands.flatMap((inner) => startedPrograms(inner, depth + 1)) : [];
    }
    // `bun run tsc` and `bun x tsc` start the binary. `bun run typecheck` starts a package
    // script, whose wrapper takes the slot itself, so its name passes as a program.
    if (name === 'bun' && (args[0] === 'run' || args[0] === 'x' || args[0] === 'exec')) args = args.slice(1);
    else if (
      (name === 'pnpm' || name === 'npm' || name === 'yarn') &&
      (args[0] === 'exec' || args[0] === 'dlx')
    )
      args = args.slice(1);
    else if (!LAUNCHERS.has(name) && name !== 'bun') return [{ name, args }];
    const values = VALUE_FLAGS[name];
    let index = 0;
    while (index < args.length) {
      const arg = args[index] ?? '';
      if (values?.has(arg)) index += 2;
      else if (arg.startsWith('-') || ASSIGNMENT.test(arg) || (name === 'timeout' && /^\d/.test(arg)))
        index += 1;
      else break;
    }
    const head = args[index];
    if (!head) return [{ name, args: [] }];
    name = basename(head).replace(/\.[cm]?js$/, '');
    args = args.slice(index + 1);
  }
}

/** The value of `-p`/`--project`/`-b`/`--build` (the `--build` default is the folder's tsconfig). */
function tscProject(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    const inline = /^--project=(.+)$/.exec(arg);
    if (inline?.[1]) return inline[1];
    if (arg === '-p' || arg === '--project') return args[index + 1] ?? '.';
    if (arg === '-b' || arg === '--build') {
      const next = args[index + 1];
      return next && !next.startsWith('-') ? next : '.';
    }
  }
  return undefined;
}

/** Operands of an argument list: words that are no flags and no flag values the guard knows. */
function operands(args: readonly string[], valueFlags: ReadonlySet<string>): string[] {
  const found: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    if (arg === '--') {
      found.push(...args.slice(index + 1));
      break;
    }
    if (valueFlags.has(arg)) index++;
    else if (!arg.startsWith('-')) found.push(arg);
  }
  return found;
}

const ESLINT_VALUE_FLAGS = new Set([
  '-c',
  '--config',
  '-f',
  '--format',
  '-o',
  '--output-file',
  '--rule',
  '--max-warnings',
  '--ext',
  '--parser',
  '--parser-options',
  '--plugin',
  '--resolve-plugins-relative-to',
  '--rulesdir',
  '--ignore-path',
  '--ignore-pattern',
  '--cache-location',
  '--cache-strategy',
  '--env',
  '--global',
  '--stdin-filename',
  '--concurrency',
]);
/** The paths an eslint call lints: its operands, or its working folder when it names none. */
export function eslintTargets(args: readonly string[]): string[] {
  const targets = operands(args, ESLINT_VALUE_FLAGS);
  return targets.length ? targets : ['.'];
}

const TSC_VALUE_FLAGS = new Set([
  '-p',
  '--project',
  '--target',
  '--module',
  '--lib',
  '--outDir',
  '--rootDir',
  '--jsx',
]);

const SLOT = 'outside the machine-wide heavy slots (lib/testing/runner/heavy-slot.ts)';
const DELIBERATE =
  'For other deliberate heavy work, wrap the command: `bun scripts/heavy.ts -- <command>` waits for a slot.';

/** The refusal of one started program, or undefined when it is light or sanctioned. */
function programRefusal(started: { name: string; args: string[] }, cwd: string): string | undefined {
  const { name, args } = started;
  const shown = [name, ...args].join(' ').slice(0, 100);
  if (name === 'tsc' || name === 'tsgo') {
    if (args.some((arg) => TSC_INFO.has(arg))) return undefined;
    const project = tscProject(args);
    // Files named on the command line replace the project; `--incremental false` names no file.
    if (!project && operands(args, TSC_VALUE_FLAGS).some((operand) => LINTED.test(operand))) return undefined;
    if (!checksCheckout(project, cwd)) return undefined;
    return [
      `Refused: \`${shown}\` type-checks the whole repository ${SLOT}.`,
      'Type-check through `bun run check:changed` while you work, `bun run typecheck` (TypeScript 7 in a heavy slot),',
      'or `bun run test:verify --group static:typecheck` (Boat or a heavy slot).',
      DELIBERATE,
    ].join(' ');
  }
  if (name === 'eslint') {
    if (args.some((arg) => arg === '--version' || arg === '-v' || arg === '--help' || arg === '-h'))
      return undefined;
    if (args.includes('--stdin')) return undefined;
    const files = lintedFileCount(eslintTargets(args), cwd);
    if (files <= BROAD_LINT_FILES) return undefined;
    return [
      `Refused: \`${shown}\` lints ${files} files with type-aware rules ${SLOT}; above ${BROAD_LINT_FILES} files a lint takes several GiB.`,
      'Lint your changes with `bun run check:changed`, or name the files (`bunx eslint path/to/file.ts`).',
      'Lint the whole repository with `bun run test:verify --group static:lint` (Boat or a heavy slot) or `bun run lint` (a heavy slot).',
      DELIBERATE,
    ].join(' ');
  }
  if (name === 'next' && args[0] === 'build')
    return [
      `Refused: \`${shown}\` runs a Next production build ${SLOT}, and its output is not the recorded build the test server serves.`,
      'Run `bun run test:server` to build and serve, or `bun run build` to build alone; both take a heavy slot.',
    ].join(' ');
  return undefined;
}

/**
 * The refusal of a shell command, started in `cwd`, that runs a whole-repository
 * `tsc`, a type-aware eslint over more than {@link BROAD_LINT_FILES} files, or
 * `next build` directly, through any launcher, env prefix, chain or `sh -c`
 * script; or undefined. A `cd` moves the folder for the commands after it.
 * Package scripts and `bun scripts/heavy.ts` take a heavy slot and pass.
 *
 * Threat model: the guard stops habit, an agent typing the heavy command it
 * knows. Deliberate evasion (an alias, a script file, an interpreter) is a rule
 * violation it does not claim to catch, and a command it cannot read passes.
 */
export function heavyCommandRefusal(command: string, cwd: string): string | undefined {
  const reading = readShell(command);
  if (!reading) return undefined;
  let folder = cwd;
  for (const words of reading.commands) {
    const call = program(words);
    if (call?.name === 'cd') {
      const [target] = call.args;
      if (!target) folder = homedir();
      else if (!target.expands && target.text !== '-') folder = resolve(folder, expandHome(target.text));
      continue;
    }
    for (const started of startedPrograms(words)) {
      const reason = programRefusal(started, folder);
      if (reason) return reason;
    }
  }
  return undefined;
}

const expandHome = (path: string): string =>
  path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;

/** Whether a folder is the root of a WerkFlow app checkout, where any tsconfig spans the repository. */
function isCheckoutRoot(folder: string): boolean {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    return (
      typeof manifest === 'object' && manifest !== null && Reflect.get(manifest, 'name') === 'werkflow-app'
    );
  } catch {
    return false;
  }
}

/**
 * Whether tsc, run in `cwd`, checks a checkout's root project: the named project
 * (a tsconfig or its folder), or without one the nearest tsconfig.json at or
 * above `cwd`, as TypeScript searches.
 */
function checksCheckout(project: string | undefined, cwd: string): boolean {
  if (project !== undefined) {
    const absolute = resolve(cwd, expandHome(project));
    return isCheckoutRoot(
      existsSync(absolute) && statSync(absolute).isDirectory() ? absolute : dirname(absolute),
    );
  }
  for (let folder = cwd; ; folder = dirname(folder)) {
    if (existsSync(join(folder, 'tsconfig.json'))) return isCheckoutRoot(folder);
    if (dirname(folder) === folder) return false;
  }
}

const GLOB = /[*?[{]/;

/**
 * How many lintable files the eslint operands name from `cwd`, read from git's
 * tracked and unignored files. A glob is matched as eslint matches it, braces
 * included; outside a repository git lists nothing, and such a lint is no WerkFlow lint.
 */
export function lintedFileCount(targets: readonly string[], cwd: string): number {
  const list = (pathspecs: readonly string[]): string[] => {
    const listed = spawnSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...pathspecs],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return listed.status === 0 ? listed.stdout.split('\0').filter((file) => LINTED.test(file)) : [];
  };
  const paths = targets.map(expandHome);
  const plain = paths.filter((path) => !GLOB.test(path));
  const globs = paths
    .filter((path) => GLOB.test(path))
    .map((glob) => new Bun.Glob(glob.replace(/^\.\//, '')));
  const files = new Set(plain.length ? list(plain) : []);
  if (globs.length)
    for (const file of list(['.']))
      if (globs.some((glob) => glob.match(file) || glob.match(join(cwd, file)))) files.add(file);
  return files.size;
}
