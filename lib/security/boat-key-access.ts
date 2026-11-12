import { isAbsolute, relative, resolve, sep } from 'node:path';

import { type ShellWord, SCRIPT_FLAG, SHELLS, program, readShell } from './shell-words';

// Only the process that uses a workstation secret reads it
// (docs/technical/environments.md, "Credentials"): the Boat API key, and the
// problem-report hand-out secret that report threads reach the hand-out with.
// The PreToolUse hook .claude/hooks/refuse-boat-key-reads.ts refuses an
// agent's call that would read, print, copy or search one of these files, for
// Claude Code and Codex alike.
//
// Threat model: the guard stops accidental and habitual reads, and a read that
// a report's text prompts a report thread to make. Agents run as the owner's
// OS user, so deliberate evasion is a rule violation it does not claim to catch.

/** A secret no agent reads, and who reads it instead. */
type GuardedSecret = {
  /** Its files, relative to the home folder. */
  files: readonly string[];
  /** What the files hold, as a refusal names it. */
  holds: string;
  /**
   * Text that names a file however a command spells its folder. It is matched
   * on the raw text, so a variable, a nested quote or a heredoc the reader
   * cannot follow still refuses.
   */
  mention: RegExp;
  instead: string;
};

const GUARDED_SECRETS: readonly GuardedSecret[] = [
  {
    // The key file, and the Boat CLI's config, whose `token` holds a key in plain text after `boat login`.
    files: ['.config/werkflow/boat-api-key', '.config/ascii/boat/config.json'],
    holds: 'a Boat API key',
    // The key file under any name but its expiry file, and the CLI's config folder.
    mention: /boat-api-key(?!\.expires(?![\w.*?[-]))|ascii\/boat\b|\bboat\/config\.json/,
    instead:
      'Only the process that calls Boat reads the Boat API key: `bun run test:verify` reads it itself. ' +
      'The expiry date is in ~/.config/werkflow/boat-api-key.expires ' +
      '(docs/technical/environments.md, "Credentials").',
  },
  {
    // Read by scripts/report-thread.ts and werkflow-planning's ops/report-dispatch.py.
    files: ['.config/werkflow/problem-report-handout.env'],
    holds: 'the problem-report hand-out secret',
    mention: /problem-report-handout\.env/,
    instead:
      'Only `bun scripts/report-thread.ts` and the report dispatcher read the hand-out secret: ' +
      'run the helper for the hand-out, the screenshot or the write-back ' +
      '(.claude/skills/report-thread/SKILL.md).',
  },
];

/** Each guarded file, resolved in the home folder, with its secret. */
function secretFiles(home: string): { path: string; secret: GuardedSecret }[] {
  return GUARDED_SECRETS.flatMap((secret) =>
    secret.files.map((file) => ({ path: resolve(home, file), secret })),
  );
}

/** Why a call is refused, and the secrets it would read; none when the guard cannot tell. */
type Refusal = { why: string; secrets: readonly GuardedSecret[] };

/** The refusal's text: what to do instead for its secrets, or for every secret when the guard cannot tell. */
function refusalText({ why, secrets }: Refusal): string {
  const instead = (secrets.length ? secrets : GUARDED_SECRETS).map((secret) => secret.instead);
  return `Refused: ${why} ${instead.join(' ')}`;
}

/** The secrets with a file in `folder`, each once. */
function secretsUnder(
  files: readonly { path: string; secret: GuardedSecret }[],
  folder: string,
): GuardedSecret[] {
  return [...new Set(files.filter((file) => within(file.path, folder)).map((file) => file.secret))];
}

/** What the secrets hold, as one phrase: "a Boat API key and the problem-report hand-out secret". */
function held(secrets: readonly GuardedSecret[]): string {
  return secrets.map((secret) => secret.holds).join(' and ');
}

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
/** The most folders one line may run in that the guard follows. */
const MAX_FOLDERS = 256;

/**
 * The folder a shell call runs in, when its payload names one in `workdir`, resolved from the
 * session's folder; else the session's folder. Codex 0.164 to 0.167 run a call in its `workdir`
 * but send the hook only `{ command }` (codex-rs exec_command.rs, `pre_tool_use_payload`), so
 * there the guard sees the session's folder. Choosing a key folder as a call's working folder
 * names the target: deliberate evasion, which the threat model leaves out (docs/technical/security.md).
 */
export function shellFolder(input: unknown, context: Context): string {
  const workdir: unknown =
    typeof input === 'object' && input !== null ? Reflect.get(input, 'workdir') : undefined;
  if (typeof workdir !== 'string' || !workdir) return context.cwd;
  return resolve(context.cwd, expandedPath(workdir, context.home) ?? workdir);
}

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
function lineFolders(
  commands: readonly ShellWord[][],
  folders: readonly string[],
  home: string,
): string[] | undefined {
  const reached = new Set(folders);
  for (const words of commands) {
    const run = program(words);
    const targets =
      run?.name === 'cd' || run?.name === 'pushd'
        ? [run.args.find((arg) => !arg.text.startsWith('-'))?.text ?? '~']
        : (innerCommand(words)?.chdir ?? []);
    for (const target of targets) {
      const path = expandedPath(target, home);
      if (path === undefined) continue;
      for (const folder of [...reached]) reached.add(resolve(folder, path));
      // A line with more folders than the guard follows is one it cannot read.
      if (reached.size > MAX_FOLDERS) return undefined;
    }
  }
  return [...reached];
}

/** The refusal for one shell line, read with the folders it may run in; shells it starts are read too. */
function lineRefusal(
  command: string,
  start: readonly string[],
  home: string,
  depth: number,
): Refusal | undefined {
  const secrets = secretFiles(home);
  const reading = readShell(command);
  if (!reading)
    return /\.config\b/.test(command)
      ? { why: 'the guard cannot read this command, and it names a config folder.', secrets: [] }
      : undefined;
  const commands = reading.commands;
  const folders = lineFolders(commands, start, home);
  if (!folders)
    return { why: 'the guard cannot follow this many folder changes in one command.', secrets: [] };
  // A `find` whose file list another command may consume: through xargs, a pipe, or a command
  // or process substitution.
  const viaXargs =
    /[|`]|[$<>]\(/.test(command) ||
    commands.some((words) => innerCommand(words)?.viaXargs || program(words)?.name === 'xargs');
  for (const words of commands) {
    // Every word, redirection targets included: `cat < config.json` reads the file too.
    for (const word of words) {
      for (const path of pathsOf(word.text, folders, home)) {
        const named = secrets.find((file) => file.path === path);
        if (named)
          return {
            why: `the command names a file that holds ${named.secret.holds}.`,
            secrets: [named.secret],
          };
        const matched = word.globs ? secrets.find((file) => new Bun.Glob(path).match(file.path)) : undefined;
        if (matched)
          return {
            why: `the pattern ${word.raw} matches a file that holds ${matched.secret.holds}.`,
            secrets: [matched.secret],
          };
      }
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
    for (const folder of roots) {
      const inside = secretsUnder(secrets, folder);
      if (inside.length)
        return {
          why: `${run.name} would read every file under ${folder === home ? '~' : folder.replace(home + sep, '~/')}, ${held(inside)} included.`,
          secrets: inside,
        };
    }
  }
  return undefined;
}

/**
 * Why a shell command may not run because it would read a guarded secret, or
 * undefined when it may. It refuses a command whose text names a secret file in
 * any spelling, an operand or glob that resolves to one, and a recursive read
 * of a folder that holds one, through launchers and `bash -c` scripts. A
 * command it cannot read refuses when it names a config folder.
 */
export function boatKeyCommandRefusal(command: string, context: Context): string | undefined {
  const mentioned = GUARDED_SECRETS.find((secret) => secret.mention.test(command));
  const refusal = mentioned
    ? { why: `the command names a file that holds ${mentioned.holds}.`, secrets: [mentioned] }
    : lineRefusal(command, [context.cwd], context.home, 0);
  return refusal && refusalText(refusal);
}

/**
 * Why an agent's file tool call may not run because it would read a guarded secret:
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
  const secrets = secretFiles(home);
  if (call.tool_name === 'Read') {
    const path = field('file_path');
    const read = secrets.find((file) => file.path === path);
    if (read) return refusalText({ why: `the file holds ${read.secret.holds}.`, secrets: [read.secret] });
  }
  if (call.tool_name === 'Grep') {
    const searched = secretsUnder(secrets, field('path') ?? cwd);
    if (searched.length)
      return refusalText({
        why: `the search would read files that hold ${held(searched)}.`,
        secrets: searched,
      });
  }
  return undefined;
}
