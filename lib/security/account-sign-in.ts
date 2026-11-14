import {
  ANSI_C_QUOTE,
  INERT_PROGRAMS,
  SCRIPT_FLAG,
  SHELLS,
  type ShellWord,
  program,
  readShell,
  withoutRedirections,
  wordWithoutSubstitutions,
} from './shell-words';

// Agents never start a sign-in or use an account-wide CLI (docs/technical/security.md, "Never"):
// a device sign-in an agent starts asks the owner to approve it, and the owner cannot tell who
// asked. Approved, it leaves an account token on the machine that reaches production. The
// PreToolUse hook .claude/hooks/refuse-account-sign-in.ts refuses such a shell call, for Claude
// Code and Codex alike.
//
// Threat model: the guard stops accidental and habitual calls. Agents run as the owner's OS user,
// so deliberate evasion is a rule violation it does not claim to catch.

/** A CLI the guard refuses, entirely or for the subcommands that sign in or hand out a token. */
type AccountCli = {
  /** Its program names: the last part of a path, or a package a runner such as `npx` fetches. */
  names: readonly string[];
  /** Each level of the subcommand that signs in, as the words it may be; none refuses every call. */
  verbs: readonly (readonly string[])[];
};

const CLIS: readonly AccountCli[] = [
  // Every call: the Vercel CLI acts for the owner's whole account. Agents use the Vercel MCP connector.
  { names: ['vercel', 'vc'], verbs: [] },
  { names: ['gh'], verbs: [['auth'], ['login', 'refresh', 'switch', 'token', 'setup-git']] },
  { names: ['supabase'], verbs: [['login']] },
  { names: ['stripe'], verbs: [['login']] },
  { names: ['wrangler'], verbs: [['login']] },
  { names: ['railway', '@railway/cli'], verbs: [['login']] },
  { names: ['firebase', 'firebase-tools'], verbs: [['login']] },
  { names: ['az'], verbs: [['login']] },
  { names: ['gcloud'], verbs: [['auth']] },
  { names: ['doctl'], verbs: [['auth']] },
  { names: ['codex'], verbs: [['login']] },
  { names: ['claude'], verbs: [['login', 'setup-token', 'auth']] },
  // Other CLIs whose sign-in leaves an account token on the machine.
  { names: ['coderabbit'], verbs: [['auth'], ['login']] },
  { names: ['glab'], verbs: [['auth'], ['login']] },
  { names: ['npm'], verbs: [['login', 'adduser']] },
  { names: ['docker'], verbs: [['login']] },
  { names: ['aws'], verbs: [['login', 'sso']] },
  { names: ['fly', 'flyctl'], verbs: [['auth']] },
  { names: ['netlify'], verbs: [['login']] },
  { names: ['heroku'], verbs: [['login']] },
];

const INSTEAD = [
  'A sign-in is an owner step: put it under "Owner queue" on your epic or issue with exact steps,',
  'ask the owner through the question tool, and keep working (docs/technical/security.md, "Never").',
  'For Vercel metadata and counts use the Vercel MCP connector.',
].join(' ');

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Raw text that names a refused call: the program, with an optional `@version`, and its sign-in
 * words, apart by spaces, quotes, commas or an opening bracket, so `['gh', 'auth', 'login']` and
 * `execFileSync('gh', ['auth', 'login'])` in a script count too.
 * Not `vercel.json`, `.vercel/`, `@vercel/functions` or `node_modules/vercel/`.
 */
function mentionPattern(cli: AccountCli): RegExp {
  const verbs = cli.verbs.map((level) => `['",\\s[(]+(?:${level.map(escaped).join('|')})`).join('');
  return new RegExp(
    `(?<![\\w@.$-])(?:${cli.names.map(escaped).join('|')})(?:@[\\w.^~-]*)?${verbs}(?![\\w.\\-/])`,
    'g',
  );
}
const MENTIONS = CLIS.map(mentionPattern);

function mentions(text: string): number {
  return MENTIONS.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0);
}

/** A word as a program name: without a package runner's `@version`; the path's last part counts too. */
function cliOf(text: string): AccountCli | undefined {
  const name = text.replace(/(?<=.)@[^/@]*$/, '');
  const base = name.slice(name.lastIndexOf('/') + 1);
  return CLIS.find((cli) => cli.names.includes(name) || cli.names.includes(base));
}

/**
 * Whether the arguments start with the sign-in subcommand: each level's word is the first
 * positional argument, past flags and the words that may be a flag's value. A word the shell
 * expands there may be the subcommand, so it counts as one.
 */
function startsWith(args: readonly ShellWord[], verbs: AccountCli['verbs']): boolean {
  const [level, ...rest] = verbs;
  if (!level) return true;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) break;
    if (arg.expands) return true;
    if (level.some((verb) => arg.text === verb || arg.text.startsWith(`${verb}:`)))
      return startsWith(args.slice(index + 1), rest);
    if (arg.text.startsWith('-')) continue;
    const previous = args[index - 1]?.text ?? '';
    if (previous.startsWith('-') && !previous.includes('=')) continue;
    return false;
  }
  return false;
}

/**
 * Flags of `git` and `gh` whose value is only a message: `git commit -m` and `-am`, `gh pr create
 * --body`, `-b` and `-t`.
 */
const MESSAGE_FLAG = /^(?:-[a-zA-Z]*m|-t|-b|--message|--body|--title)$/;
const MESSAGE_FLAG_VALUE = /^(?:--message|--body|--title)=/;

/**
 * The words of a `git` or `gh` call that are message values. Any other word may be run: a `!`
 * alias, `--exec`, a pager or an extension.
 */
function messageValues(args: readonly ShellWord[]): ShellWord[] {
  return args.filter(
    (arg, index) => MESSAGE_FLAG_VALUE.test(arg.text) || MESSAGE_FLAG.test(args[index - 1]?.text ?? ''),
  );
}

/** Programs whose arguments are data: the inert programs, and lookups that name a program without running it. */
const DATA_PROGRAMS = new Set([...INERT_PROGRAMS, 'which', 'type']);

/**
 * Whether a command may run its input as commands, so a data program's words piped into it are no
 * data: a shell without a `-c` script, `xargs` or `source`, also behind a wrapper (`env bash`).
 */
function runsInput(words: ShellWord[]): boolean {
  if (program(words)?.name === '.') return true;
  const names = words.map((word) => word.text.slice(word.text.lastIndexOf('/') + 1));
  if (names.some((name) => name === 'xargs' || name === 'source')) return true;
  const shell = names.findIndex((name) => SHELLS.has(name));
  return shell !== -1 && !words.slice(shell + 1).some((word) => SCRIPT_FLAG.test(word.text));
}

/** Mentions in raw words, without their substitutions, whose commands are read on their own. */
function wordMentions(words: readonly ShellWord[]): number {
  return mentions(words.map((word) => wordWithoutSubstitutions(word.raw)).join(' '));
}

type Scan = { refused: string[]; accounted: number };

/**
 * The refused calls in a shell command, run directly or through a package runner or wrapper
 * (`npx --yes vercel@65`, `timeout 60 gh auth login`), in a substitution, in a heredoc a shell
 * reads, or in a nested shell or `eval`, with the number of mentions the scan accounts for as
 * data: the arguments of a data program, `git` and `gh` message values, and data-only heredoc
 * bodies. Undefined when the shell reader cannot tell which lines run.
 */
function scan(command: string, depth = 0): Scan | undefined {
  const reading = readShell(command);
  if (!reading) return undefined;
  const refused: string[] = [];
  let accounted = reading.dataBodies.reduce((sum, body) => sum + mentions(body), 0);
  const piped = reading.commands.some(runsInput);
  for (const words of reading.commands) {
    const call = program(words);
    const script =
      call && SHELLS.has(call.name) ? call.args.findIndex((arg) => SCRIPT_FLAG.test(arg.text)) : -1;
    if (call && (call.name === 'eval' || script !== -1)) {
      // The script is read on its own; its mentions count at most as often as its raw words hold them.
      const source = call.name === 'eval' ? call.args : call.args.slice(script + 1, script + 2);
      const nested = depth < 4 ? scan(source.map((word) => word.text).join(' '), depth + 1) : undefined;
      if (!nested) return undefined;
      refused.push(...nested.refused);
      accounted += Math.min(nested.accounted, wordMentions(source));
      continue;
    }
    if (call && DATA_PROGRAMS.has(call.name)) {
      if (!piped) accounted += wordMentions(words);
      continue;
    }
    const messages = call && (call.name === 'git' || call.name === 'gh') ? messageValues(call.args) : [];
    accounted += wordMentions(messages);
    const runnable = withoutRedirections(words).filter((word) => !messages.includes(word));
    for (const [index, word] of runnable.entries()) {
      const cli = cliOf(word.text);
      if (cli && startsWith(runnable.slice(index + 1), cli.verbs)) {
        refused.push(
          runnable
            .slice(index)
            .map((each) => each.text)
            .join(' '),
        );
        break;
      }
    }
  }
  return { refused, accounted };
}

/**
 * Why a shell command may not run because it starts a sign-in, hands out an account token or uses
 * the Vercel CLI, or undefined. Every such call refuses, and every mention of one in the raw
 * command must be data the scan accounts for: a mention it cannot place (a comment, an
 * interpreter's script, a heredoc an unknown program reads) refuses too.
 */
export function accountSignInRefusal(command: string): string | undefined {
  const named = mentions(command);
  // The reader does not parse ANSI-C or locale quoting; with one anywhere, a mention cannot be verified.
  if (named > 0 && ANSI_C_QUOTE.test(command))
    return `Refused: the command uses $'...' or $"..." quoting, which the sign-in guard does not read, and names an account CLI. Write the quoting plainly. ${INSTEAD}`;
  const result = scan(command);
  if (!result)
    return named > 0
      ? `Refused: the sign-in guard cannot tell where a heredoc delimiter in this command ends, and the command names an account CLI. Write the delimiter plainly: <<EOF or <<'EOF'. ${INSTEAD}`
      : undefined;
  const [first] = result.refused;
  if (first) {
    const call = first.length > 80 ? `${first.slice(0, 77)}...` : first;
    return `Refused: \`${call}\` starts a sign-in, hands out an account token, or runs the Vercel CLI. ${INSTEAD}`;
  }
  if (named <= result.accounted) return undefined;
  const lines = command
    .split('\n')
    .filter((line) => mentions(line) > 0)
    .slice(0, 3)
    .map((line) => `\`${line.trim().slice(0, 80)}\``);
  return [
    `Refused: the command names an account CLI ${named} times, and the guard could verify only ${result.accounted} of them as data.`,
    `It could not place ${lines.join(', ')}: an interpreter, a comment or a program that may run its input can hide a call.`,
    INSTEAD,
  ].join(' ');
}
