import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { program, simpleCommands, withoutHeredocBodies } from '../testing/runner/shell-words';
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
  const logs = vercelLogToolRefusal(toolName.slice(toolName.lastIndexOf('__') + 2), call.tool_input);
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
  'get_project_trace',
]);

/** Metric dimensions that hold a raw path, a request, a client or a referrer rather than a code. */
const REQUEST_DIMENSIONS =
  /\b(?:requestPath|requestId|clientIp|clientUserAgent|clientJa4Digest|referrerUrl|redirectLocation|cacheTags)\b/;

/** An API path that returns log lines, build events or traces. */
const LOG_ENDPOINT = /\/(?:logs|runtime-logs|events|traces?)(?:[/?]|$)/;

/** Why a Vercel MCP tool call would return PROD log text or request data, or undefined. */
function vercelLogToolRefusal(tool: string, input: unknown): string | undefined {
  const refuse = (why: string) => `Refused: ${why} ${LOGS_INSTEAD}`;
  const preview =
    typeof input === 'object' && input !== null && Reflect.get(input, 'environment') === 'preview';
  if (VERCEL_LOG_TOOLS.has(tool) && !(tool === 'get_runtime_logs' && preview))
    return refuse(`"${tool}" returns log text from production, not metadata.`);
  if (tool === 'create_observability_query' && REQUEST_DIMENSIONS.test(JSON.stringify(input ?? null)))
    return refuse('the query names a metric dimension that holds request data.');
  return undefined;
}

/** Whether every environment a `vercel logs` call names is preview, and it names one. */
function previewOnly(args: readonly string[]): boolean {
  const environments = args.flatMap((arg, index) => {
    if (arg === '-e' || arg === '--environment') return [args[index + 1] ?? ''];
    const inline = /^(?:-e|--environment)=(.*)$/.exec(arg);
    return inline ? [inline[1] ?? ''] : [];
  });
  return environments.length > 0 && environments.every((environment) => environment === 'preview');
}

/** Why one Vercel CLI call, given its arguments, would return PROD log text or request data. */
function vercelCliRefusal(args: readonly string[]): string | undefined {
  if (args.includes('logs') && !previewOnly(args))
    return '`vercel logs` returns runtime log lines or request records from production.';
  if (args.includes('inspect') && args.some((arg) => arg === '-l' || /^--logs(?:=|$)/.test(arg)))
    return "`vercel inspect --logs` returns a build's output.";
  if (args.includes('api') && args.some((arg) => LOG_ENDPOINT.test(arg)))
    return '`vercel api` on a log, event or trace endpoint returns log text.';
  if (args.includes('metrics') && args.some((arg) => REQUEST_DIMENSIONS.test(arg)))
    return 'the metrics query names a dimension that holds request data.';
  return undefined;
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
const VERCEL_CLI = /^(?:vercel|vc)(?:@\S*)?$/;

/**
 * The argument lists of every Vercel CLI call in a shell command: run
 * directly, through a package runner or wrapper (`npx --yes vercel@65 logs`,
 * `timeout 60 vercel logs`), or in a nested shell or `eval`.
 */
function vercelCliCalls(command: string, depth = 0): string[][] {
  const calls: string[][] = [];
  for (const words of simpleCommands(withoutHeredocBodies(command))) {
    const texts = words.map((word) => word.text);
    const at = texts.findIndex((text) => VERCEL_CLI.test(text.slice(text.lastIndexOf('/') + 1)));
    if (at !== -1) calls.push(texts.slice(at + 1));
    const call = program(words);
    if (!call || depth > 2) continue;
    const args = call.args.map((arg) => arg.text);
    if (call.name === 'eval') calls.push(...vercelCliCalls(args.join(' '), depth + 1));
    const script = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg));
    if (SHELLS.has(call.name) && script !== -1)
      calls.push(...vercelCliCalls(args[script + 1] ?? '', depth + 1));
  }
  return calls;
}

/**
 * Why a shell command may not run because it reads Vercel's production logs,
 * or undefined. Mentions inside a quoted message or a heredoc body do not
 * count; a script or `curl` that calls the API itself is the backlog's.
 */
export function productionLogCommandRefusal(command: string): string | undefined {
  for (const args of vercelCliCalls(command)) {
    const why = vercelCliRefusal(args);
    if (why) return `Refused: ${why} ${LOGS_INSTEAD}`;
  }
  return undefined;
}
