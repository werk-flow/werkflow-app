import { type Dirent, readdirSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { type ShellWord, SCRIPT_FLAG, SHELLS, program, readShell } from './shell-words';

// Only the process that uses a workstation secret reads it
// (docs/technical/machine-setup.md, "Agent keys"): the Boat API key, the
// problem-report hand-out secret, the agents' staging keys, the Supabase CLI's
// login, the old Stripe sandbox folder, and a checkout's PROD keys in
// `.env.live-backup`. The PreToolUse hook
// .claude/hooks/refuse-boat-key-reads.ts refuses an agent's call that would
// read, print, copy or search one of these files, for Claude Code and Codex alike.
//
// Threat model: the guard stops accidental and habitual reads, and a read that
// a report's text prompts a report thread to make. Agents run as the owner's
// OS user, so deliberate evasion is a rule violation it does not claim to catch.
// A recursive read finds `.env.live-backup` anywhere in the tree it reads, up to
// a bound; a larger tree refuses.

/** A secret no agent reads, and who reads it instead. */
type GuardedSecret = {
  /** Its files and folders, relative to the home folder; a folder guards every file in it. */
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

/** The file that holds a checkout's PROD keys. It has this name in any checkout, so no home path fixes it. */
const LIVE_BACKUP = '.env.live-backup';
const LIVE_BACKUP_SECRET: GuardedSecret = {
  files: [],
  holds: 'PROD keys',
  mention: /\.env\.live-backup/,
  instead:
    "Only the owner's production session reads .env.live-backup, through `bun run env:prod` " +
    '(docs/technical/environments.md, "Work on production").',
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
  {
    files: ['.config/werkflow/staging-agents.env'],
    holds: "the agents' staging keys",
    mention: /staging-agents\.env/,
    instead:
      'Only the process that uses an agent key reads it, through lib/security/staging-agent-keys.ts, ' +
      'and never prints it: `bun run agent-access:check` checks every key and prints ok, failed or missing ' +
      '(docs/technical/machine-setup.md, "Agent keys").',
  },
  {
    files: ['.supabase/access-token'],
    holds: "the Supabase CLI's login token",
    mention: /\.supabase\/access-token/,
    instead:
      'Only the Supabase CLI reads its login: run `bunx supabase` (docs/technical/environments.md, "Which tool reaches what").',
  },
  {
    files: ['.werkflow-stripe-sandbox'],
    holds: 'a Stripe sandbox key',
    mention: /werkflow-stripe-sandbox/,
    instead:
      "Agents' Stripe sandbox key is STRIPE_SANDBOX_KEY in the agent key file; only the process that uses it reads it, " +
      'through lib/security/staging-agent-keys.ts (docs/technical/machine-setup.md, "Agent keys").',
  },
  LIVE_BACKUP_SECRET,
];

/** Each guarded file, resolved in the home folder, with its secret. */
function secretFiles(home: string): SecretFile[] {
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

type SecretFile = { path: string; secret: GuardedSecret };

/** The secrets a read of `folder` reaches: a file in it, or the guarded folder it lies in; each once. */
function secretsUnder(files: readonly SecretFile[], folder: string): GuardedSecret[] {
  return [
    ...new Set(
      files
        .filter((file) => within(file.path, folder) || within(folder, file.path))
        .map((file) => file.secret),
    ),
  ];
}

/** The guarded file or folder a path names or lies in, or any file named `.env.live-backup`. */
function secretAt(files: readonly SecretFile[], path: string): GuardedSecret | undefined {
  if (basename(path) === LIVE_BACKUP) return LIVE_BACKUP_SECRET;
  return files.find((file) => within(path, file.path))?.secret;
}

/** What the secrets hold, as one phrase: "a Boat API key and the problem-report hand-out secret". */
function held(secrets: readonly GuardedSecret[]): string {
  return secrets.map((secret) => secret.holds).join(' and ');
}

/** "a file that holds X" for one secret, "files that hold X and Y" for several. */
function holding(secrets: readonly GuardedSecret[]): string {
  return `${secrets.length > 1 ? 'files that hold' : 'a file that holds'} ${held(secrets)}`;
}

/** Search tools, which read every file under a folder operand or the working folder. */
const SEARCHERS = new Set(['grep', 'egrep', 'fgrep', 'zgrep', 'ugrep', 'rg', 'ag', 'ack']);
/** grep's and rg's flags that give a pattern or a pattern file in another form than `-e <pattern>`. */
const PATTERN_SOURCE = /^(?:-[a-zA-Z]*[ef]|--regexp|--file)/;

/** Long options grep and rg read without a value. */
const VALUELESS_LONG = new Set([
  '--recursive',
  '--line-number',
  '--ignore-case',
  '--smart-case',
  '--hidden',
  '--files-with-matches',
  '--count',
  '--fixed-strings',
  '--word-regexp',
  '--with-filename',
  '--no-heading',
]);

/** Whether an option surely takes no separate value: rg reads `-r`, `-E` and `-g` with one, grep does not. */
function valueless(name: string, text: string): boolean {
  if (text.startsWith('--')) return text.includes('=') || VALUELESS_LONG.has(text);
  const letters = name === 'rg' ? 'nNiIHhlLcqsSuvwxoFUz' : 'nNiIHhlLcqsuvwxoFUzrREPG';
  return /^-[a-zA-Z]+$/.test(text) && [...text.slice(1)].every((letter) => letters.includes(letter));
}

/**
 * The words a grep or rg reads as its pattern, never as a file: each `-e` value before `--`, else
 * its first operand when every option before it surely takes no value. A pattern file, an attached
 * pattern flag or an option that may take a value gives none, so every word stays a path.
 */
function searchPatterns(words: ShellWord[]): ShellWord[] {
  const run = innerCommand(words);
  if (!run || !['grep', 'egrep', 'fgrep', 'rg'].includes(run.name)) return [];
  const { args } = run;
  const end = args.findIndex((arg) => arg.text === '--');
  const options = end === -1 ? args : args.slice(0, end);
  if (options.some((arg) => PATTERN_SOURCE.test(arg.text) && arg.text !== '-e' && arg.text !== '--regexp'))
    return [];
  const flagged = options.flatMap((arg, index) =>
    arg.text === '-e' || arg.text === '--regexp' ? (options[index + 1] ?? []) : [],
  );
  if (flagged.length) return flagged;
  for (const [index, arg] of args.entries()) {
    // After `--`, the first word is the pattern whatever it looks like.
    if (index === end) return args.slice(index + 1, index + 2);
    if (!arg.text.startsWith('-')) return [arg];
    if (!valueless(run.name, arg.text)) return [];
  }
  return [];
}

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

type Context = {
  cwd: string;
  home: string;
  /**
   * The `.env.live-backup` files in a folder and the folders below it, at most `depth` levels down;
   * undefined when the guard cannot tell. The disk for the hook, a list in tests.
   */
  liveBackupsUnder: (folder: string, depth: number) => readonly string[] | undefined;
};

/** Real folders that hold no checkout's backup, which the walk skips; a link under these names is walked. */
const UNWALKED = new Set(['node_modules', '.git', '.next']);
/** The most folders one walk lists before the guard calls the tree too large to tell. */
const MAX_WALKED = 4000;

/** A missing path, a path through a file, or one the user cannot reach: nothing a reader would read. */
const UNREACHABLE = new Set(['ENOENT', 'ENOTDIR', 'EACCES']);

/**
 * The `.env.live-backup` files in `folder` and the folders below it, at most `depth` levels down,
 * nested checkouts included. The walk enters a symlink as `grep -R` does, so a backup behind a
 * linked folder counts; a link to a file or to nothing holds none. A file operand or an unreachable
 * path holds none. Undefined past MAX_WALKED folders, which a link back up the tree soon passes, or
 * when a folder fails to list for another reason, such as a symlink loop or an I/O error: the guard
 * then cannot tell, and refuses.
 */
export function liveBackupsOnDisk(folder: string, depth: number): string[] | undefined {
  const found: string[] = [];
  const queue = [{ dir: folder, level: 0 }];
  for (const { dir, level } of queue) {
    if (queue.length > MAX_WALKED) return undefined;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && 'code' in error && UNREACHABLE.has(String(error.code))) continue;
      return undefined;
    }
    if (entries.some((entry) => entry.name === LIVE_BACKUP)) found.push(join(dir, LIVE_BACKUP));
    if (level >= depth) continue;
    for (const entry of entries)
      if (entry.isSymbolicLink() || (entry.isDirectory() && !UNWALKED.has(entry.name)))
        queue.push({ dir: join(dir, entry.name), level: level + 1 });
  }
  return found;
}

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

/**
 * Whether a glob may name `target` or a file inside it: its literal folder lies in the target, or
 * the glob or one of its leading folders matches the target, as `~/.werkflow-*` followed by a file
 * name matches the guarded folder `~/.werkflow-stripe-sandbox`. Like the shell, a wildcard at the
 * start of a name skips a dot file: `cat *` reads no `.env.live-backup`.
 */
function globReaches(pattern: string, target: string): boolean {
  if (within(globRoot(pattern), target)) return true;
  const parts = pattern.split(sep);
  const names = target.split(sep);
  return (
    parts.length >= names.length &&
    names.every((name, index) => {
      const part = parts[index] ?? '';
      return (
        part === name || (!(name.startsWith('.') && !part.startsWith('.')) && new Bun.Glob(part).match(name))
      );
    })
  );
}

/**
 * Whether a search tool surely names a path to search beside its pattern. An option that may take
 * a value (`-A 3`, `--exclude-dir x`, `-d recurse`) hides which word is a path, so it names none.
 */
function searchNamesPath(name: string, args: readonly ShellWord[]): boolean {
  let pattern = false;
  let operands = 0;
  for (let index = 0; index < args.length; index++) {
    const text = args[index]?.text ?? '';
    if (text === '--') {
      operands += args.length - index - 1;
      break;
    }
    if (['-e', '--regexp', '-f', '--file'].includes(text)) {
      pattern = true;
      index++;
    } else if (/^--(?:regexp|file)=/.test(text)) pattern = true;
    else if (!text.startsWith('-')) operands++;
    else if (!valueless(name, text)) return false;
  }
  return operands > (pattern ? 0 : 1);
}

/**
 * Whether a recursive reader reads a folder it is given no operand for: a search tool that names
 * no path beside its pattern, or a `find` whose first word is an expression. Copy tools read only
 * operands.
 */
function readsWorkingFolder(name: string, args: readonly ShellWord[]): boolean {
  if (SEARCHERS.has(name)) return !searchNamesPath(name, args);
  const first = args[0]?.text;
  return name === 'find' && (first === undefined || /^[-(!]/.test(first));
}

/** Search tools that skip files git ignores, as `.env*` is, unless a flag turns that off. */
const IGNORE_RESPECTING = new Set(['rg', 'ag']);
const NO_IGNORE_FLAG = /^(?:-[a-zA-Z]*[uU][a-zA-Z]*|--no-ignore\S*|--unrestricted|--skip-vcs-ignores)$/;
/** rg's file globs, which override its ignore rules for the files they include. */
const GLOB_FLAG = /^(?:-g|--i?glob)(?:=(.*))?$|^-g(.+)$/;

/** Whether a glob has a slash inside a brace group, nested groups included (`{a,{b},src/x}`). */
function slashInBraces(pattern: string): boolean {
  let depth = 0;
  for (const char of pattern) {
    if (char === '{') depth++;
    else if (char === '}') depth = Math.max(depth - 1, 0);
    else if (char === '/' && depth > 0) return true;
  }
  return false;
}

/**
 * Whether an rg include glob brings back the git-ignored `.env.live-backup`, as `-g '.env*'` and
 * `-g 'app/.env*'` do: only its final path segment can name the file it selects. A brace group
 * with a slash in it (`{src/x,.env*}`) has no final segment to split off, so it counts.
 */
function globIncludesLiveBackup(glob: string, caseless = false): boolean {
  const pattern = caseless ? glob.toLowerCase() : glob;
  if (pattern.startsWith('!')) return false;
  if (slashInBraces(pattern)) return true;
  return new Bun.Glob(pattern.slice(pattern.lastIndexOf('/') + 1)).match(LIVE_BACKUP);
}

/** Whether a search tool's arguments skip git-ignored files for `.env.live-backup`. */
function skipsLiveBackup(name: string, args: readonly ShellWord[]): boolean {
  if (!IGNORE_RESPECTING.has(name) || args.some((arg) => NO_IGNORE_FLAG.test(arg.text))) return false;
  return !args.some((arg, index) => {
    const match = GLOB_FLAG.exec(arg.text);
    const glob = match?.[1] ?? match?.[2] ?? args[index + 1]?.text ?? '';
    return match !== null && globIncludesLiveBackup(glob, arg.text.startsWith('--iglob'));
  });
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
  context: Context,
  depth: number,
): Refusal | undefined {
  const { home } = context;
  const secrets = secretFiles(home);
  // Refusals for trees too large to tell whether they hold `.env.live-backup`.
  const untold: Refusal[] = [];
  const liveBackups = (folder: string, depth: number) => liveBackupFiles(context, folder, depth, untold);
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
  // Every read the line would make, so the refusal names each secret, not only the first.
  const refusals: Refusal[] = [];
  for (const words of commands) {
    // Every word, redirection targets included: `cat < config.json` reads the file too. A search
    // pattern is text, not a path.
    const patterns = searchPatterns(words);
    for (const word of words) {
      if (patterns.includes(word)) continue;
      for (const path of pathsOf(word.text, folders, home)) {
        const named = secretAt(secrets, path);
        if (named)
          refusals.push({ why: `the command names a file that holds ${named.holds}.`, secrets: [named] });
        const matched = word.globs
          ? [
              ...new Set(
                [...secrets, ...liveBackups(globRoot(path), globDepth(path))]
                  .filter((file) => globReaches(path, file.path))
                  .map((file) => file.secret),
              ),
            ]
          : [];
        if (matched.length)
          refusals.push({ why: `the pattern ${word.raw} matches ${holding(matched)}.`, secrets: matched });
      }
    }
    const run = innerCommand(words);
    if (!run) continue;
    if (SHELLS.has(run.name)) {
      const flag = run.args.findIndex((arg) => SCRIPT_FLAG.test(arg.text));
      const script = flag === -1 ? undefined : run.args[flag + 1]?.text;
      const inner =
        script !== undefined && depth < 4 ? lineRefusal(script, folders, context, depth + 1) : undefined;
      if (inner) refusals.push(inner);
    }
    if (!readsRecursively(run.name, run.args, run.viaXargs || viaXargs)) continue;
    // Any word may be a folder operand, and a reader given none reads where it runs.
    const operands = run.args.flatMap((arg) =>
      pathsOf(arg.text, folders, home).map((path) => (arg.globs ? globRoot(path) : path)),
    );
    const roots = [...folders, ...operands];
    const liveRoots = liveBackupRoots(run, operands, folders);
    for (const folder of roots) {
      const inside = secretsUnder(
        [...secrets, ...(liveRoots.includes(folder) ? liveBackups(folder, Infinity) : [])],
        folder,
      );
      if (inside.length)
        refusals.push({
          why: `${run.name} would read every file under ${folder === home ? '~' : folder.replace(home + sep, '~/')}, ${held(inside)} included.`,
          secrets: inside,
        });
    }
  }
  return merged([...refusals, ...untold]);
}

/** The live backups `folder` holds as guarded files; a tree the guard cannot tell adds a refusal to `untold`. */
function liveBackupFiles(context: Context, folder: string, depth: number, untold: Refusal[]): SecretFile[] {
  const found = context.liveBackupsUnder(folder, depth);
  if (!found)
    untold.push({
      why: `the guard cannot tell whether ${folder} holds .env.live-backup: the tree is too large or fails to list.`,
      secrets: [LIVE_BACKUP_SECRET],
    });
  return (found ?? []).map((path) => ({ path, secret: LIVE_BACKUP_SECRET }));
}

/**
 * The folders where a recursive reader's `.env.live-backup` counts. A checkout is where agents
 * work, so only a folder the reader surely reads: an operand, or the working folder when it has
 * none. rg and ag skip the file, since git ignores `.env*`, unless a flag or a glob brings it back.
 */
function liveBackupRoots(
  run: { name: string; args: readonly ShellWord[] },
  operands: readonly string[],
  folders: readonly string[],
): string[] {
  if (skipsLiveBackup(run.name, run.args)) return [];
  // rg and ag with a flag or glob that brings the file back count where they run too: an option's
  // value would look like a folder operand to readsWorkingFolder.
  const working = IGNORE_RESPECTING.has(run.name) || readsWorkingFolder(run.name, run.args);
  return [...operands, ...(working ? folders : [])];
}

/** How many folder levels below its literal folder a glob reaches: one for `~/code/<wildcard>/.env*`. */
function globDepth(path: string): number {
  return relative(globRoot(path), path).split(sep).length - 1;
}

/** One refusal for several, naming every secret once; undefined for none. */
function merged(refusals: readonly Refusal[]): Refusal | undefined {
  const [first] = refusals;
  if (!first) return undefined;
  const secrets = [...new Set(refusals.flatMap((refusal) => refusal.secrets))];
  const also = secrets.filter((secret) => !first.secrets.includes(secret));
  return {
    why: also.length ? `${first.why} It would also read ${holding(also)}.` : first.why,
    secrets,
  };
}

/**
 * Why a shell command may not run because it would read a guarded secret, or
 * undefined when it may. It refuses a command whose text names a secret file in
 * any spelling, an operand or glob that resolves to one, and a recursive read
 * of a folder that holds one, through launchers and `bash -c` scripts. A
 * command it cannot read refuses when it names a config folder.
 */
export function boatKeyCommandRefusal(command: string, context: Context): string | undefined {
  // A search pattern that names a secret file reads nothing; it leaves the text only when it occurs
  // once, so the same spelling elsewhere in the line still counts.
  const patterns = (readShell(command)?.commands ?? []).flatMap(searchPatterns).map((word) => word.raw);
  const text = patterns.reduce(
    (rest, raw) => (rest.split(raw).length === 2 ? rest.replace(raw, '') : rest),
    command,
  );
  const mentioned = GUARDED_SECRETS.filter((secret) => secret.mention.test(text));
  const line = lineRefusal(command, [context.cwd], context, 0);
  const refusal = merged([
    ...(mentioned.length ? [{ why: `the command names ${holding(mentioned)}.`, secrets: mentioned }] : []),
    ...(line ? [line] : []),
  ]);
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
    const read = path === undefined ? undefined : secretAt(secrets, path);
    if (read) return refusalText({ why: `the file holds ${read.holds}.`, secrets: [read] });
  }
  if (call.tool_name === 'Grep') {
    // The Grep tool runs ripgrep, which skips files git ignores, `.env.live-backup` among them,
    // unless the search names the file itself or its glob brings the file back.
    const path = field('path') ?? cwd;
    const glob: unknown = Reflect.get(input, 'glob');
    const untold: Refusal[] = [];
    const live =
      typeof glob === 'string' && globIncludesLiveBackup(glob)
        ? liveBackupFiles(context, path, Infinity, untold)
        : [];
    const [cannotTell] = untold;
    if (cannotTell) return refusalText(cannotTell);
    const searched =
      basename(path) === LIVE_BACKUP ? [LIVE_BACKUP_SECRET] : secretsUnder([...secrets, ...live], path);
    if (searched.length)
      return refusalText({
        why: `the search would read files that hold ${held(searched)}.`,
        secrets: searched,
      });
  }
  return undefined;
}
