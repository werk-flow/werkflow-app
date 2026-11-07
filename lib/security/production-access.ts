import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

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
import { z } from '../zod';

// Agents never read production data: every tool result goes to the model
// provider (docs/technical/environments.md, "Work on production"). The PreToolUse
// hook .claude/hooks/refuse-production-mcp.ts refuses an MCP tool that reaches
// the production Supabase project or returns Vercel's runtime logs, and
// .claude/hooks/refuse-production-logs.ts refuses the same logs through the
// Vercel CLI, for Claude Code and Codex alike.

const ENVIRONMENTS_DOC = 'docs/technical/environments.md';

/**
 * The production and DEV Supabase project refs, read from the one place the
 * repository records them: the first row of the cloud-backend table in
 * docs/technical/environments.md. The production ref stays out of app code
 * (the prodRefSelectors lint rule), so code reads it from there.
 */
export function supabaseProjectRefs(repositoryRoot: string): { production: string; dev: string } | undefined {
  const doc = readFileSync(resolve(repositoryRoot, ENVIRONMENTS_DOC), 'utf8');
  const match = /^\| Supabase project \| `([a-z]{20})` \| `([a-z]{20})`/m.exec(doc);
  const [, production, dev] = match ?? [];
  return production && dev ? { production, dev } : undefined;
}

/**
 * The widest server part of an MCP tool name, `mcp__<server>__<tool>`. A server
 * name may itself contain `__`, so everything before the last `__` counts.
 */
function mcpServerOf(toolName: string): string | undefined {
  return /^mcp__(.+)__[^_]/.exec(toolName)?.[1];
}

/**
 * A server configuration as the agent resolves it: Claude Code expands
 * `${VAR}` and `${VAR:-default}`. `unresolved` reports a variable the hook
 * cannot resolve.
 */
function expandedConfig(
  config: unknown,
  env: Readonly<Record<string, string | undefined>>,
): { raw: string; text: string; unresolved: boolean } {
  let unresolved = false;
  const raw = JSON.stringify(config ?? null);
  const text = raw.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
    (_, name: string, fallback: string | undefined) => {
      const value = env[name] ?? fallback;
      if (value === undefined) unresolved = true;
      return value ?? '';
    },
  );
  return { raw, text, unresolved };
}

/** A configured server name as it appears in tool names. */
function toolNameServer(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

const serverMapSchema = z.record(z.string(), z.unknown());
const claudeConfigSchema = z.object({
  mcpServers: serverMapSchema.optional(),
  projects: z.record(z.string(), z.object({ mcpServers: serverMapSchema.optional() })).optional(),
});
const projectConfigSchema = z.object({ mcpServers: serverMapSchema.optional() });
const codexConfigSchema = z.object({ mcp_servers: serverMapSchema.optional() });

/** A config file's text, or undefined when it does not exist. */
function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Every MCP server configured for Claude Code (user scope, and local and
 * project scope of this project) and Codex (user and project), keyed by its
 * tool-name form. A file that
 * exists but cannot be read or parsed throws, so the caller fails closed.
 */
export function configuredMcpServers(paths: {
  claudeConfig: string;
  projectDir: string;
  projectMcp: string;
  codexConfigs: readonly string[];
}): Map<string, unknown[]> {
  const servers = new Map<string, unknown[]>();
  const add = (map: Record<string, unknown> | undefined) => {
    for (const [name, config] of Object.entries(map ?? {})) {
      const key = toolNameServer(name);
      servers.set(key, [...(servers.get(key) ?? []), config]);
    }
  };
  const claude = readOptional(paths.claudeConfig);
  if (claude !== undefined) {
    const config = claudeConfigSchema.parse(JSON.parse(claude));
    add(config.mcpServers);
    add(config.projects?.[paths.projectDir]?.mcpServers);
  }
  const project = readOptional(paths.projectMcp);
  if (project !== undefined) add(projectConfigSchema.parse(JSON.parse(project)).mcpServers);
  for (const path of paths.codexConfigs) {
    const codex = readOptional(path);
    if (codex !== undefined) add(codexConfigSchema.parse(Bun.TOML.parse(codex)).mcp_servers);
  }
  return servers;
}

/** Where Claude Code and Codex keep their MCP server configuration on this machine. */
export function mcpConfigPaths(projectDir: string): Parameters<typeof configuredMcpServers>[0] {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR;
  return {
    claudeConfig: claudeDir ? join(claudeDir, '.claude.json') : join(homedir(), '.claude.json'),
    projectDir,
    projectMcp: join(projectDir, '.mcp.json'),
    codexConfigs: [
      join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml'),
      join(projectDir, '.codex', 'config.toml'),
    ],
  };
}

const INSTEAD = [
  'Agents never read production data: every tool result goes to the model provider.',
  'For PROD structure (migration ledger, schema drift against DEV, advisor findings) run `bun run prod:inspect`.',
  'For data and schema work use the DEV server `supabase` or the local stack',
  '(docs/technical/environments.md, "Which tool reaches what").',
].join(' ');

/**
 * Why an MCP tool call may not run, or undefined when it may. It refuses a
 * server whose name contains "prod", a call whose input names the production
 * ref, and a server whose expanded configuration names it. A Supabase server,
 * by name or configuration, passes only when every configuration names a
 * non-production project or a local stack; no ref, no configuration, a
 * variable it cannot resolve or an unscoped server refuses it.
 */
export function productionMcpRefusal(
  call: { tool_name: unknown; tool_input: unknown },
  context: {
    productionRef: string | undefined;
    servers: ReadonlyMap<string, readonly unknown[]> | undefined;
    env: Readonly<Record<string, string | undefined>>;
  },
): string | undefined {
  const refuse = (why: string) => `Refused: ${why} ${INSTEAD}`;
  if (typeof call.tool_name !== 'string')
    return refuse('the MCP guard could not read the tool name, so it cannot rule out PROD.');
  const toolName = call.tool_name;
  const server = mcpServerOf(toolName);
  if (!server) return undefined;
  const logs = vercelLogToolRefusal(server, toolName.slice(toolName.lastIndexOf('__') + 2), call.tool_input);
  if (logs) return logs;
  const unknown = (what: string) =>
    refuse(`the hook could not read ${what}, so it cannot tell whether "${server}" reaches PROD.`);
  if (/prod/i.test(server)) return refuse(`MCP server "${server}" is a production server by its name.`);
  const { productionRef, servers, env } = context;
  const configs = [...(servers ?? [])]
    .filter(([name]) => toolName.startsWith(`mcp__${name}__`))
    .flatMap(([, entries]) => entries.map((entry) => expandedConfig(entry, env)));
  const supabase =
    /supabase/i.test(server) || configs.some((config) => /supabase/i.test(`${config.raw} ${config.text}`));
  if (!productionRef) return supabase ? unknown(`the production ref from ${ENVIRONMENTS_DOC}`) : undefined;
  if (JSON.stringify(call.tool_input ?? null).includes(productionRef))
    return refuse(`the call to "${server}" names the production Supabase project.`);
  if (configs.some((config) => config.text.includes(productionRef)))
    return refuse(`MCP server "${server}" is configured for the production Supabase project.`);
  if (!supabase) return undefined;
  if (!servers) return unknown('the MCP server configuration');
  if (configs.length === 0) return unknown('a configuration for it');
  if (configs.some((config) => config.unresolved)) return unknown('every variable in its configuration');
  if (!configs.every((config) => scopedOutsideProduction(config.text, productionRef)))
    return refuse(
      `MCP server "${server}" names no project, so it reaches every project of the organization, PROD included. Scope it with project_ref.`,
    );
  return undefined;
}

/** Whether an expanded Supabase server configuration names only non-production projects, or a local stack. */
function scopedOutsideProduction(text: string, productionRef: string): boolean {
  const local = /\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\b/.test(text);
  if (local && !/supabase\.(?:com|co)\b/.test(text)) return true;
  const refs = [...text.matchAll(/project[_-]?ref\W{1,3}([a-z]{20})\b/gi)].map((match) => match[1]);
  return refs.length > 0 && refs.every((ref) => ref !== productionRef);
}

const LOGS_INSTEAD = [
  'Agents never read production data: every tool result goes to the model provider.',
  'For a production failure read deployment metadata (state, SHA, errorCode, errorStep, alias) and the counts of',
  'the metric vercel.request.count, grouped only by route, httpStatus, errorCode, deploymentId or serverActionName.',
  'Reproduce a build failure on staging or with `bun run build`',
  '(docs/technical/environments.md, "Which tool reaches what").',
].join(' ');

/**
 * Vercel MCP tools whose result is text the app or its build wrote: runtime
 * log lines, error clusters with sample messages, build events, request traces
 * with exception messages. No input narrows them to metadata, except runtime
 * logs filtered to preview deployments, which serve DEV data.
 */
const VERCEL_LOG_TOOLS = new Set([
  'get_runtime_logs',
  'get_runtime_errors',
  'list_deployment_events',
  'get_deployment_build_logs',
  'get_project_trace',
]);

/**
 * On a Vercel server, any tool named for logs, traces or events, so a tool Vercel
 * adds later (CI logs, agent run traces) is refused too. Only Vercel servers:
 * Supabase's `get_logs` on DEV stays allowed.
 */
const VERCEL_LOG_TOOL_NAME = /(?:^|_)(?:logs?|traces?|events)(?:_|$)/;

/**
 * The metric dimensions a query may group or filter by: codes and ids, never a
 * path, a request, a client or a referrer. Vercel spells them two ways:
 * camelCase in `/metrics/v1` and `vercel metrics`, snake_case in the
 * `/v2/observability` API behind the MCP tool. Every other name is refused,
 * including ones Vercel adds later.
 */
const SAFE_DIMENSIONS = new Set([
  'route',
  'httpStatus',
  'http_status',
  'errorCode',
  'error_code',
  'deploymentId',
  'deployment_id',
  'serverActionName',
  'server_action_name',
]);
/** A filter may also narrow the query to one environment. */
const FILTER_FIELDS = new Set([...SAFE_DIMENSIONS, 'environment']);

/** One filter clause: KQL (`environment:production`, `httpStatus >= 500`) or OData (`http_status ge 500`). */
const FILTER_CLAUSES = [
  /^(\w+)\s*(?::|>=|<=|>|<)\s*(?:"[^"]*"|'[^']*'|[\w.*/[\]-]+)$/,
  /^(\w+)\s+(?:eq|ne|gt|ge|lt|le)\s+(?:'(?:[^']|'')*'|"[^"]*"|[\w.-]+)$/i,
];

/** Whether a metrics filter names only FILTER_FIELDS. A clause it cannot read counts as unsafe. */
function safeFilter(filter: string): boolean {
  return filter.split(/\s+(?:and|or)\s+/i).every((part) => {
    const clause = part
      .trim()
      .replace(/^(?:not\s+|\(\s*)+/i, '')
      .replace(/(?:\s*\))+$/, '');
    const field = FILTER_CLAUSES.map((pattern) => pattern.exec(clause)?.[1]).find(Boolean);
    return field !== undefined && FILTER_FIELDS.has(field);
  });
}

/** Whether an aggregation such as `count` or `unique/<dimension>` names only a safe dimension. */
function safeAggregation(aggregation: string): boolean {
  const slash = aggregation.indexOf('/');
  return slash === -1 || SAFE_DIMENSIONS.has(aggregation.slice(slash + 1));
}

const observabilityQuerySchema = z.object({
  requestBody: z.object({
    groupBy: z.array(z.string()).optional(),
    filter: z.string().optional(),
    aggregation: z.string().optional(),
  }),
});

/** Why an MCP observability query could return request data: a dimension, filter or aggregation outside the allowlist. */
function observabilityQueryRefusal(input: unknown): string | undefined {
  const query = observabilityQuerySchema.safeParse(input);
  if (!query.success) return 'the guard could not read the query, so it cannot rule out request data.';
  const { groupBy = [], filter, aggregation } = query.data.requestBody;
  if (!groupBy.every((dimension) => SAFE_DIMENSIONS.has(dimension)))
    return `the query groups by a dimension outside ${[...SAFE_DIMENSIONS].join(', ')}.`;
  if (filter !== undefined && filter.trim() !== '' && !safeFilter(filter))
    return 'the query filters on a dimension outside the allowed ones, or in a form the guard cannot read.';
  if (aggregation !== undefined && !safeAggregation(aggregation))
    return 'the query aggregates over a dimension outside the allowed ones.';
  return undefined;
}

/** An API path that returns log lines, build events or traces. */
const LOG_ENDPOINT = /\/(?:logs|runtime-logs|events|traces?)(?:[/?]|$)/;
/** An API path that runs a metrics query, whose body the guard cannot see from the command line. */
const QUERY_ENDPOINT = /\/(?:metrics\/v\d|v\d\/observability\/query)\b/;

/** Why a Vercel MCP tool call would return PROD log text or request data, or undefined. */
function vercelLogToolRefusal(server: string, tool: string, input: unknown): string | undefined {
  const refuse = (why: string) => `Refused: ${why} ${LOGS_INSTEAD}`;
  const preview =
    typeof input === 'object' && input !== null && Reflect.get(input, 'environment') === 'preview';
  const logTool = VERCEL_LOG_TOOLS.has(tool) || (/vercel/i.test(server) && VERCEL_LOG_TOOL_NAME.test(tool));
  if (logTool && !(tool === 'get_runtime_logs' && preview))
    return refuse(`"${tool}" returns log text from production, not metadata.`);
  const query = tool === 'create_observability_query' ? observabilityQueryRefusal(input) : undefined;
  return query && refuse(query);
}

/** The values a CLI call gives a flag: `--flag value` and `--flag=value`, for each of its names. */
function flagValues(args: readonly string[], names: readonly string[]): string[] {
  return args.flatMap((arg, index) => {
    if (names.includes(arg)) return [args[index + 1] ?? ''];
    const name = names.find((candidate) => arg.startsWith(`${candidate}=`));
    return name ? [arg.slice(name.length + 1)] : [];
  });
}

/** Whether every environment a `vercel logs` call names is preview, and it names one. */
function previewOnly(args: readonly string[]): boolean {
  const environments = flagValues(args, ['-e', '--environment']);
  return environments.length > 0 && environments.every((environment) => environment === 'preview');
}

const anyValue = (value: string) => value !== '' && !value.startsWith('-');

/**
 * The `vercel metrics` options the guard has verified, from the CLI's own
 * option list (vercel@65), each with the values it accepts. The dimension
 * options take only the allowlist; the rest only pick time, scope, order or
 * output. Every other option is refused, the deprecated shorthands `-a`, `-f`,
 * `-l` and `-g` and an unknown one such as `--query` included.
 */
const METRICS_OPTIONS = new Map<string, (value: string) => boolean>([
  ['--group-by', (value) => SAFE_DIMENSIONS.has(value)],
  ['--filter', safeFilter],
  ['--aggregation', safeAggregation],
  ['--limit', (value) => /^\d+$/.test(value)],
  ['--order-by', (value) => value === 'value' || value === 'count'],
  ['--order', (value) => value === 'asc' || value === 'desc'],
  ['--environment', anyValue],
  ['-e', anyValue],
  ['--since', anyValue],
  ['-s', anyValue],
  ['--until', anyValue],
  ['-u', anyValue],
  ['--granularity', anyValue],
  ['--bucket-timezone', anyValue],
  ['--project', anyValue],
  ['-p', anyValue],
  ['--format', anyValue],
  ['--scope', anyValue],
  ['-S', anyValue],
  ['--token', anyValue],
  ['-t', anyValue],
  ['--cwd', anyValue],
]);
const METRICS_SWITCHES = new Set([
  '--prod',
  '--all',
  '--json',
  '--debug',
  '-d',
  '--no-color',
  '--non-interactive',
]);

/**
 * Why a `vercel metrics` query could return request data, or undefined when
 * every option is verified and its value allowed. `vercel metrics schema`
 * lists names only. Positional words: an optional `query`, then a metric id.
 */
function metricsCliRefusal(args: readonly string[]): string | undefined {
  const rest = args.slice(args.indexOf('metrics') + 1);
  if (rest[0] === 'schema') return undefined;
  const positional: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index] ?? '';
    const equals = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const accepts = METRICS_OPTIONS.get(name);
    if (accepts) {
      const value = equals === -1 ? rest[++index] : arg.slice(equals + 1);
      if (value === undefined || !accepts(value))
        return `the metrics option ${name} ${value ?? '(no value)'} is outside what the guard verified: dimensions ${[...SAFE_DIMENSIONS].join(', ')}.`;
    } else if (METRICS_SWITCHES.has(arg)) continue;
    else if (arg.startsWith('-')) return `the metrics option ${arg} is not one the guard verified.`;
    else positional.push(arg);
  }
  const [first, second, ...more] = positional;
  const shaped =
    more.length === 0 &&
    (second === undefined || first === 'query') &&
    [first, second].every((word) => word === undefined || /^[\w.-]+$/.test(word));
  return shaped
    ? undefined
    : `the metrics call has arguments the guard cannot place: ${positional.join(' ')}.`;
}

/**
 * Flags whose value only picks the team, project or folder, so a variable there
 * hides no command, as long as double quotes keep it one argument: unquoted,
 * `--scope $ARGS` splits into further flags.
 */
const SCOPE_FLAG = /^(?:--scope|-S|--project|-p|--team|-T|--cwd)$/;
const QUOTED_SCOPE_VALUE = /^"[^"\\]*"$/;
const QUOTED_SCOPE_FLAG_VALUE = /^--(?:scope|project|team|cwd)="[^"\\]*"$/;

/** Why one Vercel CLI call, given its argument words, would return PROD log text or request data. */
function vercelCliRefusal(words: readonly ShellWord[]): string | undefined {
  const expanding = withoutRedirections(words).filter(
    (word, index, kept) =>
      word.expands &&
      !QUOTED_SCOPE_FLAG_VALUE.test(word.raw) &&
      !(SCOPE_FLAG.test(kept[index - 1]?.text ?? '') && QUOTED_SCOPE_VALUE.test(word.raw)),
  );
  if (expanding.length > 0)
    return `the shell expands ${expanding.map((word) => word.text).join(' ')} in a Vercel call, so the guard cannot see which command, flag or dimension it runs. Write the arguments out.`;
  const args = withoutRedirections(words).map((word) => word.text);
  // Help prints the CLI's own text, never data.
  if (args.includes('--help') || args.includes('-h')) return undefined;
  if (args.includes('logs') && !previewOnly(args))
    return '`vercel logs` returns runtime log lines or request records from production.';
  if (args.includes('inspect') && args.some((arg) => arg === '-l' || /^--logs(?:=|$)/.test(arg)))
    return "`vercel inspect --logs` returns a build's output.";
  if (args.includes('api') && args.some((arg) => LOG_ENDPOINT.test(arg)))
    return '`vercel api` on a log, event or trace endpoint returns log text.';
  if (args.includes('api') && args.some((arg) => QUERY_ENDPOINT.test(arg)))
    return '`vercel api` runs a metrics query the guard cannot read; use `vercel metrics`, which it checks.';
  return args.includes('metrics') ? metricsCliRefusal(args) : undefined;
}

const VERCEL_CLI = /^(?:vercel|vc)(?:@\S*)?$/;
/**
 * A mention of the Vercel CLI in raw command text: `vercel`, `vc` or
 * `vercel@<version>` as a word, also as the last part of a path. Not
 * `vercel.json`, `.vercel/`, `@vercel/functions`, `node_modules/vercel/` or `Vercel`.
 */
const VERCEL_MENTION = /(?<![\w@.$-])(?:vercel|vc)(?:@[\w.^~-]*)?(?![\w.\-/])/g;

function mentions(text: string): number {
  return text.match(VERCEL_MENTION)?.length ?? 0;
}

/** Mentions in raw words, without their substitutions, whose commands are read on their own. */
function wordMentions(words: readonly ShellWord[]): number {
  return words.reduce((sum, word) => sum + mentions(wordWithoutSubstitutions(word.raw)), 0);
}

/**
 * Every Vercel CLI call in a shell command, run directly, through a package
 * runner or wrapper (`npx --yes vercel@65 logs`, `timeout 60 vercel logs`), in
 * a substitution, quoted or in an expanding heredoc, in a heredoc a shell
 * reads, or in a nested shell or `eval`, with the number of CLI mentions the
 * scan accounts for: each call's program word, the arguments of a program that
 * never runs them, and data-only heredoc bodies. Undefined when the shell
 * reader cannot tell which lines run.
 */
function scanVercel(command: string, depth = 0): { calls: ShellWord[][]; accounted: number } | undefined {
  const reading = readShell(command);
  if (!reading) return undefined;
  const calls: ShellWord[][] = [];
  let accounted = reading.dataBodies.reduce((sum, body) => sum + mentions(body), 0);
  for (const words of reading.commands) {
    const call = program(words);
    const script =
      call && SHELLS.has(call.name) ? call.args.findIndex((arg) => SCRIPT_FLAG.test(arg.text)) : -1;
    if (call && (call.name === 'eval' || script !== -1)) {
      // The script is read on its own; its mentions count at most as often as its raw words hold them.
      const source = call.name === 'eval' ? call.args : call.args.slice(script + 1, script + 2);
      const nested = depth < 4 ? scanVercel(source.map((word) => word.text).join(' '), depth + 1) : undefined;
      if (!nested) return undefined;
      calls.push(...nested.calls);
      accounted += Math.min(nested.accounted, wordMentions(source));
      continue;
    }
    const at = words.findIndex((word) => VERCEL_CLI.test(word.text.slice(word.text.lastIndexOf('/') + 1)));
    const head = words[at];
    if (head) {
      calls.push(words.slice(at + 1));
      accounted += wordMentions([head]);
    } else if (call && INERT_PROGRAMS.has(call.name)) accounted += wordMentions(words);
    else if (call && (call.name === 'git' || call.name === 'gh'))
      accounted += wordMentions(messageValues(call.args));
  }
  return { calls, accounted };
}

/** Flags of `git` and `gh` whose value is only a message: `git commit -m`, `gh pr create --body`. */
const MESSAGE_FLAG = /^(?:-m|--message|--body|--title)$/;
const MESSAGE_FLAG_VALUE = /^(?:--message|--body|--title)=/;

/**
 * The words of a `git` or `gh` call that are message values. Any other word
 * may be run: a `!` alias, `--exec`, a pager or an extension.
 */
function messageValues(args: readonly ShellWord[]): ShellWord[] {
  return args.filter(
    (arg, index) => MESSAGE_FLAG_VALUE.test(arg.text) || MESSAGE_FLAG.test(args[index - 1]?.text ?? ''),
  );
}

/**
 * Why a shell command may not run because it reads Vercel's production logs,
 * or undefined. Every Vercel CLI call must pass `vercelCliRefusal`, and every
 * mention of the CLI in the raw command must be one the scan accounts for: a
 * mention it cannot place (a comment, an interpreter's script, a heredoc an
 * unknown program reads) is refused. A script or `curl` that calls the API
 * itself without naming the CLI is the backlog's.
 */
export function productionLogCommandRefusal(command: string): string | undefined {
  // The reader does not parse ANSI-C or locale quoting; with one anywhere, a mention cannot be verified.
  if (ANSI_C_QUOTE.test(command) && mentions(command) > 0)
    return `Refused: the command uses $'...' or $"..." quoting, which the log guard does not read, and names the Vercel CLI. Write the quoting plainly. ${LOGS_INSTEAD}`;
  const scan = scanVercel(command);
  if (!scan)
    return `Refused: the log guard cannot tell where a heredoc delimiter in this command ends, so it cannot rule out a log read after it. Write the delimiter plainly: <<EOF or <<'EOF'. ${LOGS_INSTEAD}`;
  for (const words of scan.calls) {
    const why = vercelCliRefusal(words);
    if (why) return `Refused: ${why} ${LOGS_INSTEAD}`;
  }
  const named = mentions(command);
  if (named <= scan.accounted) return undefined;
  const lines = command
    .split('\n')
    .filter((line) => mentions(line) > 0)
    .slice(0, 3)
    .map((line) => `\`${line.trim().slice(0, 80)}\``);
  return [
    `Refused: the command names the Vercel CLI ${named} times, and the guard could verify only ${scan.accounted} of them`,
    `as a checked call or as data. It could not verify the Vercel call in ${lines.join(', ')}:`,
    'an interpreter, a comment or a program that may run its input can hide one.',
    'Run the Vercel CLI as a plain command; for counts use `vercel metrics vercel.request.count` grouped by',
    `${[...SAFE_DIMENSIONS].join(', ')}. ${LOGS_INSTEAD}`,
  ].join(' ');
}
