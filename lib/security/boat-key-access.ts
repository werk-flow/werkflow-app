import { isAbsolute, relative, resolve, sep } from 'node:path';

import { type ShellWord, SCRIPT_FLAG, SHELLS, program, readShell } from './shell-words';

// Only the process that calls Boat reads the workstation's Boat API key
// (docs/technical/environments.md, "Credentials"). The PreToolUse hook
// .claude/hooks/refuse-boat-key-reads.ts refuses an agent's call that would
// read, print or search the key file or the Boat CLI's config, whose `token`
// holds a key in plain text after `boat login`, for Claude Code and Codex alike.
//
// Threat model: the guard stops accidental and habitual reads. Agents run as
// the owner's OS user, so deliberate evasion is a rule violation it does not
// claim to catch.

/** The files that hold a Boat key, relative to the home folder. */
const SECRET_FILES = ['.config/werkflow/boat-api-key', '.config/ascii/boat/config.json'] as const;

/**
 * Text that names a secret file however a command spells its folder: the key
 * file under any name but its expiry file, and the Boat CLI's config folder.
 * It is matched on the raw text, so a variable, a nested quote or a heredoc
 * the reader cannot follow still refuses.
 */
const SECRET_MENTION = /boat-api-key(?!\.expires(?![\w.*?[-]))|ascii\/boat\b|\bboat\/config\.json/;

const INSTEAD =
  'Only the process that calls Boat reads the Boat API key: `bun run test:verify` reads it itself. ' +
  'The expiry date is in ~/.config/werkflow/boat-api-key.expires ' +
  '(docs/technical/environments.md, "Credentials").';

/** Search tools: the first operand is the pattern unless a flag gives it, the rest are paths, none means the working folder. */
const SEARCHERS = new Set(['grep', 'egrep', 'fgrep', 'zgrep', 'ugrep', 'rg', 'ag', 'ack']);
/** Search tools that recurse without a flag. */
const ALWAYS_RECURSIVE = new Set(['rg', 'ag', 'ack']);
const RECURSE_FLAG =
  /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|--dereference-recursive|--directories=recurse)$/;
/** Flags that give the pattern, so every operand is a path. */
const PATTERN_FLAGS = new Set(['-e', '-f', '--regexp', '--file']);
/** Search flags whose value is the next word, not an operand. */
const SEARCH_VALUE_FLAGS = new Set([
  ...PATTERN_FLAGS,
  ...[
    '-g',
    '--glob',
    '--iglob',
    '-t',
    '--type',
    '-T',
    '--type-not',
    '-A',
    '-B',
    '-C',
    '-m',
    '-j',
    '-d',
    '-D',
  ],
  ...['--max-count', '--max-depth', '--context', '--include', '--exclude', '--exclude-dir', '--threads'],
]);
/** Copy and archive tools that read every file under a folder operand. */
const COPIERS: ReadonlyMap<string, RegExp | undefined> = new Map([
  ['cp', /^(?:-[a-zA-Z]*[rRa][a-zA-Z]*|--recursive|--archive)$/],
  ['scp', /^-[a-zA-Z]*r[a-zA-Z]*$/],
  ['tar', undefined],
  ['zip', undefined],
  ['7z', undefined],
  ['rsync', undefined],
  ['cpio', undefined],
]);
/** `find` reads file contents only through a command it runs. */
const FIND_RUNS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
/** Programs that run the command in their arguments, with the options to skip before it. */
const LAUNCHERS: ReadonlyMap<string, { valueFlags: ReadonlySet<string>; positionals: number }> = new Map([
  [
    'env',
    { valueFlags: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']), positionals: 0 },
  ],
  ['nice', { valueFlags: new Set(['-n', '--adjustment']), positionals: 0 }],
  ['nohup', { valueFlags: new Set(), positionals: 0 }],
  ['timeout', { valueFlags: new Set(['-s', '--signal', '-k', '--kill-after']), positionals: 1 }],
  ['command', { valueFlags: new Set(), positionals: 0 }],
  ['exec', { valueFlags: new Set(['-a']), positionals: 0 }],
  ['stdbuf', { valueFlags: new Set(['-i', '-o', '-e']), positionals: 0 }],
  ['ionice', { valueFlags: new Set(['-c', '-n', '-t']), positionals: 0 }],
  ['xargs', { valueFlags: new Set(['-n', '-I', '-P', '-d', '-L', '-s', '-E', '-a']), positionals: 0 }],
]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;

type Context = { cwd: string; home: string };

/** A word's path with a leading `~`, `$HOME` or `${HOME}` expanded, or undefined when another expansion remains. */
function expandedPath(text: string, home: string): string | undefined {
  const path = text.replace(/^(?:~|\$HOME\b|\$\{HOME\})(?=\/|$)/, home);
  return /[$`]/.test(path) ? undefined : path;
}

/** Whether `path` is `folder` or lies inside it. */
function within(path: string, folder: string): boolean {
  const rest = relative(folder, path);
  return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest));
}

/** The folder a glob's literal prefix names: `~/.config/*` reads under `~/.config`. */
function globRoot(path: string): string {
  const literal = path.slice(0, path.search(/[*?[]/));
  return literal.endsWith(sep) ? literal.slice(0, -1) || sep : resolve(literal, '..');
}

/** The program a simple command runs and its arguments, through launchers such as `env` and `timeout`. */
function innerCommand(
  words: ShellWord[],
): { name: string; args: ShellWord[]; viaXargs: boolean } | undefined {
  let run = program(words);
  let viaXargs = false;
  for (let depth = 0; run && depth < 4; depth++) {
    const launcher = LAUNCHERS.get(run.name);
    if (!launcher) return { ...run, viaXargs };
    viaXargs ||= run.name === 'xargs';
    let index = 0;
    let positionals = launcher.positionals;
    while (index < run.args.length) {
      const text = run.args[index]?.text ?? '';
      if (launcher.valueFlags.has(text)) index += 2;
      else if (text.startsWith('-') || (run.name === 'env' && ASSIGNMENT.test(text))) index++;
      else if (positionals > 0) {
        positionals--;
        index++;
      } else break;
    }
    run = program(run.args.slice(index));
  }
  return run && { ...run, viaXargs };
}

/** The paths a word may name: itself and the value of `--flag=value`, against each folder it may be relative to. */
function pathsOf(word: ShellWord, folders: readonly string[], home: string): string[] {
  const texts = [
    word.text,
    ...(/^--?[\w-]+=/.test(word.text) ? [word.text.slice(word.text.indexOf('=') + 1)] : []),
  ];
  return texts.flatMap((text) => {
    const path = expandedPath(text, home);
    if (path === undefined || path === '') return [];
    return isAbsolute(path) ? [resolve(path)] : folders.map((folder) => resolve(folder, path));
  });
}

/** The folders a recursive reader reads, as its operands name them; undefined when it reads none recursively. */
function recursiveOperands(
  name: string,
  args: readonly ShellWord[],
  viaXargs: boolean,
): ShellWord[] | 'cwd' | undefined {
  const texts = args.map((arg) => arg.text);
  if (SEARCHERS.has(name)) {
    if (!ALWAYS_RECURSIVE.has(name) && !texts.some((text) => RECURSE_FLAG.test(text))) return undefined;
    const operands: ShellWord[] = [];
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (!arg) continue;
      if (SEARCH_VALUE_FLAGS.has(arg.text)) index++;
      else if (!arg.text.startsWith('-')) operands.push(arg);
    }
    const paths = texts.some((text) => PATTERN_FLAGS.has(text) || /^--(?:regexp|file)=/.test(text))
      ? operands
      : operands.slice(1);
    return paths.length ? paths : 'cwd';
  }
  if (COPIERS.has(name)) {
    const flag = COPIERS.get(name);
    return flag === undefined || texts.some((text) => flag.test(text)) ? [...args] : undefined;
  }
  if (name === 'find' && (viaXargs || texts.some((text) => FIND_RUNS.has(text)))) {
    const end = args.findIndex((arg) => /^[-(!]/.test(arg.text));
    const paths = args.slice(0, end === -1 ? args.length : end);
    return paths.length ? paths : 'cwd';
  }
  return undefined;
}

/** The refusal for one shell line, read with the folders it may run in; shells it starts are read too. */
function lineRefusal(command: string, context: Context, depth: number): string | undefined {
  const { cwd, home } = context;
  const secrets = SECRET_FILES.map((file) => resolve(home, file));
  const reading = readShell(command);
  if (!reading)
    return /\.config\b/.test(command)
      ? 'the guard cannot read this command, and it names a config folder.'
      : undefined;
  const commands = reading.commands;
  const folders = [cwd];
  for (const words of commands) {
    const run = program(words);
    if (run?.name !== 'cd' && run?.name !== 'pushd') continue;
    const target = run.args.find((arg) => !arg.text.startsWith('-'));
    const path = target ? expandedPath(target.text, home) : home;
    if (path !== undefined) folders.push(resolve(cwd, path));
  }
  const viaXargs = commands.some(
    (words) => innerCommand(words)?.viaXargs || program(words)?.name === 'xargs',
  );
  for (const words of commands) {
    const run = innerCommand(words);
    if (!run) continue;
    if (SHELLS.has(run.name)) {
      const flag = run.args.findIndex((arg) => SCRIPT_FLAG.test(arg.text));
      const script = flag === -1 ? undefined : run.args[flag + 1]?.text;
      const inner = script !== undefined && depth < 4 ? lineRefusal(script, context, depth + 1) : undefined;
      if (inner) return inner;
    }
    for (const arg of run.args)
      for (const path of pathsOf(arg, folders, home)) {
        if (secrets.includes(path)) return 'the command names a file that holds a Boat API key.';
        if (arg.globs && secrets.some((secret) => new Bun.Glob(path).match(secret)))
          return `the pattern ${arg.raw} matches a file that holds a Boat API key.`;
      }
    const operands = recursiveOperands(run.name, run.args, run.viaXargs || viaXargs);
    if (!operands) continue;
    const roots =
      operands === 'cwd'
        ? folders
        : operands.flatMap((arg) =>
            pathsOf(arg, folders, home).map((path) => (arg.globs ? globRoot(path) : path)),
          );
    const ancestor = roots.find((root) => secrets.some((secret) => within(secret, root)));
    if (ancestor)
      return `${run.name} would read every file under ${ancestor === home ? '~' : ancestor.replace(home + sep, '~/')}, a Boat API key included.`;
  }
  return undefined;
}

/**
 * Why a shell command may not run because it would read a Boat key, or
 * undefined when it may. It refuses a command whose text names a secret file in
 * any spelling, an operand or glob that resolves to one, and a recursive read
 * of a folder that holds one, through launchers and `bash -c` scripts. A
 * command it cannot read refuses when it names a config folder.
 */
export function boatKeyCommandRefusal(command: string, context: Context): string | undefined {
  const why = SECRET_MENTION.test(command)
    ? 'the command names a file that holds a Boat API key.'
    : lineRefusal(command, context, 0);
  return why && `Refused: ${why} ${INSTEAD}`;
}

/**
 * Why an agent's file tool call may not run because it would read a Boat key:
 * a read of a secret file, or a content search of a folder that holds one.
 */
export function boatKeyToolRefusal(
  call: { tool_name: unknown; tool_input: unknown },
  context: Context,
): string | undefined {
  const { cwd, home } = context;
  const input = typeof call.tool_input === 'object' && call.tool_input !== null ? call.tool_input : {};
  const field = (name: string): string | undefined => {
    const value: unknown = Reflect.get(input, name);
    return typeof value === 'string' ? resolve(cwd, value.replace(/^~(?=\/|$)/, home)) : undefined;
  };
  const secrets = SECRET_FILES.map((file) => resolve(home, file));
  if (call.tool_name === 'Read') {
    const path = field('file_path');
    if (path && secrets.includes(path)) return `Refused: the file holds a Boat API key. ${INSTEAD}`;
  }
  if (call.tool_name === 'Grep') {
    const path = field('path') ?? cwd;
    if (secrets.some((secret) => within(secret, path)))
      return `Refused: the search would read a file that holds a Boat API key. ${INSTEAD}`;
  }
  return undefined;
}
