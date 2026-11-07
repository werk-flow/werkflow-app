import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { type ShellWord, program, readShell } from './shell-words';

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
 */
const SECRET_MENTION = /boat-api-key(?!\.expires(?![\w.*?[-]))|ascii\/boat\b|\bboat\/config\.json/;

const INSTEAD =
  'Only the process that calls Boat reads the Boat API key: `bun run test:verify` reads it itself. ' +
  'The expiry date is in ~/.config/werkflow/boat-api-key.expires ' +
  '(docs/technical/environments.md, "Credentials").';

/** Programs that read every file under a folder they are given, with the flags that make them recurse. */
const RECURSIVE_READERS: ReadonlyMap<string, RegExp | undefined> = new Map([
  ['grep', /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|--dereference-recursive|--directories=recurse|-d)$/],
  ['egrep', /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|--dereference-recursive|--directories=recurse|-d)$/],
  ['fgrep', /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|--dereference-recursive|--directories=recurse|-d)$/],
  ['ugrep', /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|--dereference-recursive)$/],
  ['cp', /^(?:-[a-zA-Z]*[rRa][a-zA-Z]*|--recursive|--archive)$/],
  ['scp', /^-[a-zA-Z]*r[a-zA-Z]*$/],
  ['rg', undefined],
  ['ag', undefined],
  ['ack', undefined],
  ['tar', undefined],
  ['zip', undefined],
  ['7z', undefined],
  ['rsync', undefined],
  ['cpio', undefined],
]);

/** `find` reads file contents only through a command it runs. */
const FIND_RUNS = new Set(['-exec', '-execdir', '-ok', '-okdir']);

/** A word's path with a leading `~`, `$HOME` or `${HOME}` expanded, or undefined when another expansion remains. */
function expandedPath(word: ShellWord, home: string): string | undefined {
  const text = word.text.replace(/^(?:~|\$HOME\b|\$\{HOME\})(?=\/|$)/, home);
  return /[$`]/.test(text) ? undefined : text;
}

/** Whether `path` is `folder` or lies inside it. */
function within(path: string, folder: string): boolean {
  const rest = relative(folder, path);
  return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest));
}

/** The folders a command line `cd`s or `pushd`s into, so relative words resolve against them too. */
function changedFolders(commands: readonly ShellWord[][], cwd: string, home: string): string[] {
  return commands.flatMap((words) => {
    const run = program(words);
    if (!run || (run.name !== 'cd' && run.name !== 'pushd')) return [];
    const target = run.args.find((arg) => !arg.text.startsWith('-'));
    if (!target) return [home];
    const path = expandedPath(target, home);
    return path === undefined ? [] : [resolve(cwd, path)];
  });
}

/**
 * Why a shell command may not run because it would read a Boat key, or
 * undefined when it may. It refuses a command that names a secret file in any
 * spelling, a glob that matches one, and a recursive read of a folder that
 * holds one. A command it cannot read refuses when it names a config folder.
 */
export function boatKeyCommandRefusal(
  command: string,
  context: { cwd: string; home: string },
): string | undefined {
  const { cwd, home } = context;
  const secrets = SECRET_FILES.map((file) => resolve(home, file));
  const refuse = (why: string) => `Refused: ${why} ${INSTEAD}`;
  if (SECRET_MENTION.test(command)) return refuse('the command names a file that holds a Boat API key.');
  const reading = readShell(command);
  if (!reading)
    return /\.config\b/.test(command)
      ? refuse('the guard cannot read this command, and it names a config folder.')
      : undefined;
  const commands = [...reading.commands];
  const folders = [cwd, ...changedFolders(commands, cwd, home)];
  const pipesToRunner = commands.some((words) => program(words)?.name === 'xargs');
  for (const words of commands) {
    const run = program(words);
    if (!run) continue;
    const paths = run.args.flatMap((arg) => {
      const path = expandedPath(arg, home);
      if (path === undefined) return [];
      return isAbsolute(path)
        ? [{ arg, path }]
        : folders.map((folder) => ({ arg, path: resolve(folder, path) }));
    });
    for (const { arg, path } of paths)
      if (arg.globs && secrets.some((secret) => new Bun.Glob(path).match(secret)))
        return refuse(`the pattern ${arg.raw} matches a file that holds a Boat API key.`);
    const flag = RECURSIVE_READERS.get(run.name);
    const recursive =
      RECURSIVE_READERS.has(run.name) && (flag === undefined || run.args.some((arg) => flag.test(arg.text)));
    const findRuns =
      run.name === 'find' && (pipesToRunner || run.args.some((arg) => FIND_RUNS.has(arg.text)));
    if (!recursive && !findRuns) continue;
    // A reader given no existing path reads its working folder.
    const operands = paths.some(({ path }) => existsSync(path))
      ? paths.map(({ path }) => path)
      : [...paths.map(({ path }) => path), ...folders];
    const ancestor = operands.find((path) => secrets.some((secret) => within(secret, path)));
    if (ancestor)
      return refuse(
        `${run.name} would read every file under ${ancestor === home ? '~' : ancestor.replace(home + sep, '~/')}, a Boat API key included.`,
      );
  }
  return undefined;
}

/**
 * Why an agent's file tool call may not run because it would read a Boat key:
 * a read of a secret file, or a content search of a folder that holds one.
 */
export function boatKeyToolRefusal(
  call: { tool_name: unknown; tool_input: unknown },
  context: { cwd: string; home: string },
): string | undefined {
  const { cwd, home } = context;
  const input = typeof call.tool_input === 'object' && call.tool_input !== null ? call.tool_input : {};
  const field = (name: string): string | undefined => {
    const value: unknown = Reflect.get(input, name);
    return typeof value === 'string' ? resolve(cwd, value.replace(/^~(?=\/|$)/, home)) : undefined;
  };
  const secrets = SECRET_FILES.map((file) => resolve(home, file));
  if (call.tool_name === 'Read' || call.tool_name === 'NotebookRead') {
    const path = field('file_path') ?? field('notebook_path');
    if (path && secrets.includes(path)) return `Refused: the file holds a Boat API key. ${INSTEAD}`;
  }
  if (call.tool_name === 'Grep') {
    const path = field('path') ?? cwd;
    if (secrets.some((secret) => within(secret, path)))
      return `Refused: the search would read a file that holds a Boat API key. ${INSTEAD}`;
  }
  return undefined;
}
