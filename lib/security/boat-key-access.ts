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

/** Search tools, which read every file under a folder operand or the working folder. */
const SEARCHERS = new Set(['grep', 'egrep', 'fgrep', 'zgrep', 'ugrep', 'rg', 'ag', 'ack']);
/** Search tools that recurse without a flag. */
const ALWAYS_RECURSIVE = new Set(['rg', 'ag', 'ack']);
const RECURSE_FLAG =
  /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|--dereference-recursive|--directories=recurse)$/;
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
): { name: string; args: ShellWord[]; viaXargs: boolean; chdir: string[] } | undefined {
  let run = program(words);
  let viaXargs = false;
  const chdir: string[] = [];
  for (let depth = 0; run && depth < 4; depth++) {
    const launcher = LAUNCHERS.get(run.name);
    if (!launcher) return { ...run, viaXargs, chdir };
    viaXargs ||= run.name === 'xargs';
    let index = 0;
    let positionals = launcher.positionals;
    while (index < run.args.length) {
      const text = run.args[index]?.text ?? '';
      if (launcher.valueFlags.has(text)) {
        if (run.name === 'env' && (text === '-C' || text === '--chdir'))
          chdir.push(run.args[index + 1]?.text ?? '');
        index += 2;
      } else if (text.startsWith('-') || (run.name === 'env' && ASSIGNMENT.test(text))) {
        if (run.name === 'env' && text.startsWith('--chdir=')) chdir.push(text.slice('--chdir='.length));
        index++;
      } else if (positionals > 0) {
        positionals--;
        index++;
      } else break;
    }
    run = program(run.args.slice(index));
  }
  return run && { ...run, viaXargs, chdir };
}

/**
 * The paths a word may name: itself without a redirection operator, and the value of an attached
 * option (`--file=x`, `-ex`), against each folder the line may run in.
 */
function pathsOf(text: string, folders: readonly string[], home: string): string[] {
  const word = text.replace(/^\d*[<>]+&?/, '');
  const attached = /^--?[\w-]+=/.test(word)
    ? [word.slice(word.indexOf('=') + 1)]
    : /^-[a-zA-Z]./.test(word)
      ? [word.slice(2)]
      : [];
  return [word, ...attached].flatMap((candidate) => {
    const path = expandedPath(candidate, home);
    if (path === undefined || path === '') return [];
    return isAbsolute(path) ? [resolve(path)] : folders.map((folder) => resolve(folder, path));
  });
}

/** Whether the program reads every file under a folder it is given or runs in. */
function readsRecursively(name: string, args: readonly ShellWord[], viaXargs: boolean): boolean {
  const texts = args.map((arg) => arg.text);
  if (SEARCHERS.has(name))
    return (
      ALWAYS_RECURSIVE.has(name) ||
      texts.some(
        (text, index) =>
          RECURSE_FLAG.test(text) ||
          // `-d recurse` and `--directories recurse` name the action in the next word.
          ((text === '-d' || text === '--directories') && texts[index + 1] === 'recurse'),
      )
    );
  const flag = COPIERS.get(name);
  if (COPIERS.has(name)) return flag === undefined || texts.some((text) => flag.test(text));
  return name === 'find' && (viaXargs || texts.some((text) => FIND_RUNS.has(text)));
}

/**
 * The folders a line may run in: the working folder, and every target of `cd`, `pushd` and
 * `env -C`, each resolved against every folder before it, so chained changes are followed.
 */
function lineFolders(commands: readonly ShellWord[][], folders: readonly string[], home: string): string[] {
  const reached = [...folders];
  for (const words of commands) {
    const run = program(words);
    const targets =
      run?.name === 'cd' || run?.name === 'pushd'
        ? [run.args.find((arg) => !arg.text.startsWith('-'))?.text ?? '~']
        : (innerCommand(words)?.chdir ?? []);
    for (const target of targets) {
      const path = expandedPath(target, home);
      if (path !== undefined) reached.push(...reached.map((folder) => resolve(folder, path)));
    }
  }
  return [...new Set(reached)];
}

/** The refusal for one shell line, read with the folders it may run in; shells it starts are read too. */
function lineRefusal(
  command: string,
  start: readonly string[],
  home: string,
  depth: number,
): string | undefined {
  const secrets = SECRET_FILES.map((file) => resolve(home, file));
  const reading = readShell(command);
  if (!reading)
    return /\.config\b/.test(command)
      ? 'the guard cannot read this command, and it names a config folder.'
      : undefined;
  const commands = reading.commands;
  const folders = lineFolders(commands, start, home);
  // A `find` whose file list another command may consume: through xargs, a pipe, or a substitution.
  const viaXargs =
    /[|`]|\$\(/.test(command) ||
    commands.some((words) => innerCommand(words)?.viaXargs || program(words)?.name === 'xargs');
  for (const words of commands) {
    // Every word, redirection targets included: `cat < config.json` reads the file too.
    for (const word of words)
      for (const path of pathsOf(word.text, folders, home)) {
        if (secrets.includes(path)) return 'the command names a file that holds a Boat API key.';
        if (word.globs && secrets.some((secret) => new Bun.Glob(path).match(secret)))
          return `the pattern ${word.raw} matches a file that holds a Boat API key.`;
      }
    const run = innerCommand(words);
    if (!run) continue;
    if (SHELLS.has(run.name)) {
      const flag = run.args.findIndex((arg) => SCRIPT_FLAG.test(arg.text));
      const script = flag === -1 ? undefined : run.args[flag + 1]?.text;
      const inner =
        script !== undefined && depth < 4 ? lineRefusal(script, folders, home, depth + 1) : undefined;
      if (inner) return inner;
    }
    if (!readsRecursively(run.name, run.args, run.viaXargs || viaXargs)) continue;
    // Any word may be a folder operand, and a reader given none reads where it runs.
    const roots = [
      ...folders,
      ...run.args.flatMap((arg) =>
        pathsOf(arg.text, folders, home).map((path) => (arg.globs ? globRoot(path) : path)),
      ),
    ];
    const ancestor = roots.find((folder) => secrets.some((secret) => within(secret, folder)));
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
    : lineRefusal(command, [context.cwd], context.home, 0);
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
