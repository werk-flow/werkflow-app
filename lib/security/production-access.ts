import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from '../zod';

// Agents never read production data: every tool result goes to the model
// provider (docs/technical/environments.md, "Work on production"). The PreToolUse
// hook .claude/hooks/refuse-production-mcp.ts refuses an MCP tool that reaches
// the production Supabase project, for Claude Code and Codex alike.

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

/** The server part of an MCP tool name, `mcp__<server>__<tool>`. */
function mcpServerOf(toolName: string): string | undefined {
  return /^mcp__(.+?)__./.exec(toolName)?.[1];
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
 * Every MCP server configured for Claude Code (user, local and project scope)
 * and Codex (user and project), keyed by its tool-name form. A file that
 * exists but cannot be read or parsed throws, so the caller fails closed.
 */
export function configuredMcpServers(paths: {
  claudeConfig: string;
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
    for (const project of Object.values(config.projects ?? {})) add(project.mcpServers);
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
 * ref, and a server whose configuration names it. Without the ref or the
 * server configuration it refuses every Supabase server, since it cannot tell
 * DEV from PROD.
 */
export function productionMcpRefusal(
  call: { tool_name: unknown; tool_input: unknown },
  context: {
    productionRef: string | undefined;
    servers: ReadonlyMap<string, readonly unknown[]> | undefined;
  },
): string | undefined {
  if (typeof call.tool_name !== 'string') return undefined;
  const server = mcpServerOf(call.tool_name);
  if (!server) return undefined;
  const refuse = (why: string) => `Refused: ${why} ${INSTEAD}`;
  if (/prod/i.test(server)) return refuse(`MCP server "${server}" is a production server by its name.`);
  const { productionRef, servers } = context;
  if (!productionRef || !servers) {
    return /supabase/i.test(server)
      ? refuse(
          `the hook could not read ${productionRef ? 'the MCP server configuration' : `the production ref from ${ENVIRONMENTS_DOC}`}, so it cannot tell whether "${server}" reaches PROD.`,
        )
      : undefined;
  }
  if (JSON.stringify(call.tool_input ?? null).includes(productionRef))
    return refuse(`the call to "${server}" names the production Supabase project.`);
  if ((servers.get(server) ?? []).some((config) => JSON.stringify(config).includes(productionRef)))
    return refuse(`MCP server "${server}" is configured for the production Supabase project.`);
  return undefined;
}
