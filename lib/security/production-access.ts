import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from '../zod';

// Agents never read production data: every tool result goes to the model
// provider (docs/technical/environments.md, "Work on production"). The PreToolUse
// hook .claude/hooks/refuse-production-mcp.ts refuses an MCP tool that reaches
// the production Supabase project or returns Vercel's runtime logs, for Claude
// Code and Codex alike. No agent runs the Vercel CLI at all
// (lib/security/account-sign-in.ts).

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
 * camelCase in `/metrics/v1`, snake_case in the `/v2/observability` API
 * behind the MCP tool. Every other name is refused,
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

/** Vercel MCP tools that return an environment variable's decrypted value. */
const VALUE_TOOLS = new Set(['get_project_env', 'get_shared_env_var']);

/** Why a Vercel MCP tool call would return PROD log text, request data or a secret value, or undefined. */
function vercelLogToolRefusal(server: string, connectorTool: string, input: unknown): string | undefined {
  // A connected-app server names its tools after the app: `mcp__codex_apps__vercel_get_project_env`.
  const vercel = /vercel/i.test(server) || /^vercel_/i.test(connectorTool);
  const tool = connectorTool.replace(/^vercel_/i, '');
  const refuse = (why: string) => `Refused: ${why} ${LOGS_INSTEAD}`;
  const field = (name: string): unknown =>
    typeof input === 'object' && input !== null ? Reflect.get(input, name) : undefined;
  const decrypt = field('decrypt');
  if (
    VALUE_TOOLS.has(tool) ||
    (tool === 'filter_project_envs' && decrypt !== undefined && decrypt !== false && decrypt !== 'false')
  )
    return refuse(
      `"${tool}" returns an environment value, which may be a production secret; list names only.`,
    );
  const preview = field('environment') === 'preview';
  const logTool = VERCEL_LOG_TOOLS.has(tool) || (vercel && VERCEL_LOG_TOOL_NAME.test(tool));
  if (logTool && !(tool === 'get_runtime_logs' && preview))
    return refuse(`"${tool}" returns log text from production, not metadata.`);
  const query = tool === 'create_observability_query' ? observabilityQueryRefusal(input) : undefined;
  return query && refuse(query);
}
