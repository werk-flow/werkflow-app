import { type ShellWord, SCRIPT_FLAG, SHELLS, program, readShell } from '../../security/shell-words';

// Every worktree of a workstation tests against one local Supabase stack. It holds main's
// migrations and nothing else: `bun run stack:sync` applies them, and no branch applies its own
// (docs/technical/environments.md, "The migration rule"). The PreToolUse hook
// .claude/hooks/refuse-shared-stack-migration.ts refuses an agent's shell call that would put a
// tree's migration into that stack, for Claude Code and Codex alike, and names the sanctioned
// command. Below the hook, the stack's own ledger trigger (stack-sync.ts) refuses the same write
// from any shell.
//
// Threat model: the hook stops habit, not deliberate evasion. A call it cannot read passes: it
// guards a test database, not a secret, and the ledger trigger still refuses the write.

const RULE = '(docs/technical/environments.md, "The migration rule")';
const INSTEAD = [
  'For the types of a migration run `bun run types:generate -- --local`; to test it run `bun run test:verify`.',
  'Neither changes the shared database.',
  "`bun run stack:sync` applies main's merged migrations to the shared stack.",
].join(' ');

/** Programs that start their first operand as the program, with the flags that take a value. */
const LAUNCHERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['bunx', new Set(['-p', '--package'])],
  ['npx', new Set(['-p', '--package'])],
  ['env', new Set(['-u', '--unset', '-C', '--chdir'])],
  ['nice', new Set(['-n', '--adjustment'])],
  ['nohup', new Set()],
  ['timeout', new Set(['-s', '--signal', '-k', '--kill-after'])],
  ['command', new Set()],
  ['exec', new Set()],
  ['time', new Set()],
]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
/** Supabase CLI flags whose next word is their value, so it is no subcommand. */
const SUPABASE_VALUE_FLAGS = new Set([
  '--workdir',
  '--db-url',
  '--password',
  '-p',
  '--schema',
  '-s',
  '--status',
  '--version',
  '--last',
  '--network-id',
  '--dns-resolver',
  '--output',
  '-o',
  '--profile',
]);
/** A database host on this machine, in a connection URL or a `-h` value. */
const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|\[?::1\]?|host\.docker\.internal)$/;
/** A committed migration file, however the command spells its folder. */
const MIGRATION_FILE = /supabase\/migrations\/[^\s'"]*\.sql\b/;
/** A `cat` of a migration file whose output a pipe carries into `psql`, within one pipeline. */
const CAT_INTO_PSQL =
  /\bcat\b[^|;&\n]*?(supabase\/migrations\/[^\s'"|;&]*\.sql)\b[^|;&\n]*\|[^;&\n]*\bpsql\b/;

/** `docker exec` flags whose next word is their value, so it is no container. */
const DOCKER_EXEC_VALUE_FLAGS = new Set([
  '-e',
  '--env',
  '--env-file',
  '-u',
  '--user',
  '-w',
  '--workdir',
  '--detach-keys',
]);

type Started = { name: string; args: string[]; words: ShellWord[] };
/** A nested shell's script, with the outer call's other words, whose redirections feed that script's commands. */
type NestedScript = { script: string; words: ShellWord[]; inContainer: boolean };

/** The command a `docker exec` runs in its container, after the options and the container's name. */
function dockerExecCommand(args: readonly string[]): string[] | undefined {
  const exec = args[0] === 'exec' ? 1 : args[0] === 'container' && args[1] === 'exec' ? 2 : undefined;
  if (exec === undefined) return undefined;
  let index = exec;
  while (args[index]?.startsWith('-')) index += DOCKER_EXEC_VALUE_FLAGS.has(args[index] ?? '') ? 2 : 1;
  return args.slice(index + 1);
}

/**
 * The programs a simple command starts, through launchers and `bun x`, and the scripts of nested
 * shells, a shell that `docker exec` starts in a container among them.
 */
function started(words: ShellWord[]): (Started | NestedScript)[] {
  const call = program(words);
  if (!call) return [];
  let name = call.name;
  let args = call.args.map((arg) => arg.text);
  let viaDocker = false;
  for (let depth = 0; depth < 4; depth++) {
    if (SHELLS.has(name)) {
      const flag = args.findIndex((arg) => SCRIPT_FLAG.test(arg));
      const script = flag === -1 ? undefined : args[flag + 1];
      return script
        ? [{ script, words: words.filter((word) => word.text !== script), inContainer: viaDocker }]
        : [];
    }
    // `docker exec <container> sh -c '<script>'`: the script's psql runs in the container. Any other
    // `docker exec` stays a docker call, which the psql check below reads as a whole.
    const inContainer = name === 'docker' ? dockerExecCommand(args) : undefined;
    if (inContainer?.[0] && SHELLS.has(inContainer[0])) {
      name = inContainer[0];
      args = inContainer.slice(1);
      viaDocker = true;
      continue;
    }
    const runsBinary =
      (name === 'bun' && (args[0] === 'x' || args[0] === 'run' || args[0] === 'exec')) ||
      ((name === 'pnpm' || name === 'npm' || name === 'yarn') && (args[0] === 'exec' || args[0] === 'dlx'));
    const values = LAUNCHERS.get(name);
    if (!runsBinary && !values) break;
    let index = runsBinary ? 1 : 0;
    while (index < args.length) {
      const arg = args[index] ?? '';
      if (values?.has(arg)) index += 2;
      else if (arg.startsWith('-') || ASSIGNMENT.test(arg) || (name === 'timeout' && /^\d/.test(arg)))
        index += 1;
      else break;
    }
    const head = args[index];
    if (!head) break;
    // `bunx supabase@2.116.0` names the package with its version.
    name = head.slice(head.lastIndexOf('/') + 1).replace(/@[^/]*$/, '');
    args = args.slice(index + 1);
  }
  return [{ name, args, words }];
}

/** The values a call gives a flag: `--flag value` and `--flag=value`. */
function flagValues(args: readonly string[], flag: string): string[] {
  return args.flatMap((arg, index) =>
    arg === flag ? [args[index + 1] ?? ''] : arg.startsWith(`${flag}=`) ? [arg.slice(flag.length + 1)] : [],
  );
}

/** The host of a Postgres connection URL, or undefined when the text is none. */
function urlHost(text: string): string | undefined {
  return /^postgres(?:ql)?:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/?]+)/.exec(text)?.[1];
}

/** The refusal of one Supabase CLI call, or undefined when it leaves the shared stack's schema alone. */
function supabaseRefusal(args: readonly string[]): string | undefined {
  const operands: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    if (SUPABASE_VALUE_FLAGS.has(arg)) index++;
    else if (!arg.startsWith('-')) operands.push(arg);
  }
  const command = operands.slice(0, 2).join(' ');
  const urls = flagValues(args, '--db-url');
  const remoteUrl = urls.some((url) => !LOCAL_HOST.test(urlHost(url) ?? ''));
  const local = args.includes('--local') || (urls.length > 0 && !remoteUrl);
  const linked = args.includes('--linked') || remoteUrl;
  const shown = `supabase ${command}`;
  if (command === 'db reset' && !linked)
    return `Refused: \`${shown}\` would rebuild the local stack, which every worktree shares, from this tree's migrations, a branch's included ${RULE}. \`bun run stack:reset\` rebuilds it from main's migrations under the stack lock.`;
  // `migration up` and `migration down` reach the local stack unless told otherwise; `db push` and
  // `migration repair` reach the linked project unless told `--local`.
  const reachesLocal =
    command === 'migration up' || command === 'migration down'
      ? !linked
      : command === 'db push' || command === 'migration repair'
        ? local && !args.includes('--dry-run')
        : false;
  return reachesLocal
    ? `Refused: \`${shown}\` would write this tree's migrations into the local stack, which every worktree shares and which holds only main's ${RULE}. ${INSTEAD}`
    : undefined;
}

/** Whether a `psql` call, direct or through `docker exec`, reaches a database on this machine. */
function reachesLocalDatabase(call: Started): boolean {
  if (call.name === 'docker') return true;
  const hosts = [
    ...flagValues(call.args, '-h'),
    ...flagValues(call.args, '--host'),
    ...call.args.flatMap((arg) => urlHost(arg) ?? []),
    ...call.args.flatMap((arg) => /(?:^|\s)host=(\S+)/.exec(arg)?.[1] ?? []),
  ];
  return hosts.every((host) => LOCAL_HOST.test(host));
}

/**
 * Why a shell call may not run, or undefined when it may: it would apply this tree's migrations to
 * the shared local stack through the Supabase CLI (`migration up`, `migration down`, `db push
 * --local`, `migration repair --local`, `db reset`), or feed a migration file to `psql` on this
 * machine. A mention inside a search, a message or a string is no call.
 */
export function sharedStackMigrationRefusal(command: string): string | undefined {
  return readCommand(command, 0, false).refusal;
}

/**
 * The refusal of a command line, and whether it starts a psql on this machine, itself or in a
 * nested `sh -c` script: a heredoc on the outer line is that psql's input too. A script that
 * `docker exec` starts runs in a container on this machine, so each psql in it is local, as a
 * direct `docker exec <container> psql` is.
 */
function readCommand(
  command: string,
  depth: number,
  inContainer: boolean,
): { refusal?: string; localPsql: boolean } {
  const reading = readShell(command);
  if (!reading) return { localPsql: false };
  const calls: Started[] = [];
  /** The outer words of each nested shell whose script starts a local psql: their redirections are its input. */
  const nestedPsqlWords: ShellWord[] = [];
  let nestedPsql = false;
  for (const words of reading.commands)
    for (const entry of started(words)) {
      if ('script' in entry) {
        const nested =
          depth < 4
            ? readCommand(entry.script, depth + 1, inContainer || entry.inContainer)
            : { localPsql: false };
        if (nested.refusal) return nested;
        if (nested.localPsql) nestedPsqlWords.push(...entry.words);
        nestedPsql ||= nested.localPsql;
      } else calls.push(entry);
    }
  for (const call of calls) {
    const refusal = call.name === 'supabase' ? supabaseRefusal(call.args) : undefined;
    if (refusal) return { refusal, localPsql: false };
  }
  const psql = calls.filter(
    (call) =>
      call.name === 'psql' ||
      (call.name === 'docker' && call.args.includes('exec') && call.args.includes('psql')),
  );
  const local = psql.filter((call) => inContainer || reachesLocalDatabase(call));
  const localPsql = local.length > 0 || nestedPsql;
  // The file reaches psql as `-f` or as its input (a redirection of the psql call or of the shell
  // that starts it), through a `cat` piped into it, or as an include
  // (`\i`, `\ir`) in a heredoc psql reads, its own or one a nested shell's psql inherits. A `cat`
  // that only prints the file beside a psql call feeds nothing. A heredoc on a line with a local
  // psql counts as its input whoever reads it: the reader cannot tell a heredoc's reader in every
  // pipeline, and a false refusal costs one retry.
  const piped = localPsql ? CAT_INTO_PSQL.exec(command)?.[1] : undefined;
  const bodies = localPsql ? [...reading.dataBodies, ...reading.unknownBodies] : [];
  const fed = [
    ...[...local.flatMap((call) => call.words), ...nestedPsqlWords].flatMap(
      (word) => MIGRATION_FILE.exec(word.text)?.[0] ?? [],
    ),
    ...(piped ? [piped] : []),
    ...bodies.flatMap((body) => MIGRATION_FILE.exec(body)?.[0] ?? []),
  ];
  return fed[0]
    ? {
        refusal: `Refused: \`psql\` with ${fed[0]} would run this tree's migration in the local stack, which every worktree shares and which holds only main's ${RULE}. ${INSTEAD}`,
        localPsql,
      }
    : { localPsql };
}
