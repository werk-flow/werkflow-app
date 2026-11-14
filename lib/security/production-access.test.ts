// Rule test: an agent's MCP tool never reaches the production Supabase project, and no MCP tool
// returns production log text.
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from '../zod';

import { configuredMcpServers, productionMcpRefusal, supabaseProjectRefs } from './production-access';

const repositoryRoot = resolve(import.meta.dir, '../..');
const PROD = 'prodprodprodprodprod';
const DEV = 'devdevdevdevdevdevde';
const servers = new Map<string, unknown[]>([
  ['supabase', [{ type: 'http', url: `https://mcp.supabase.com/mcp?project_ref=${DEV}` }]],
  ['database', [{ type: 'http', url: `https://mcp.supabase.com/mcp?project_ref=${PROD}&read_only=true` }]],
  ['pg', [{ command: 'npx', args: ['@supabase/mcp-server-supabase', `--project-ref=${PROD}`] }]],
  ['team__db', [{ type: 'http', url: `https://mcp.supabase.com/mcp?project_ref=${PROD}` }]],
  ['expanded', [{ type: 'http', url: 'https://mcp.supabase.com/mcp?project_ref=${TARGET_REF}' }]],
  ['defaulted', [{ type: 'http', url: `https://mcp.supabase.com/mcp?project_ref=\${MISSING:-${PROD}}` }]],
  ['unresolved', [{ type: 'http', url: 'https://mcp.supabase.com/mcp?project_ref=${MISSING}' }]],
  ['supabase_alt', [{ type: 'http', url: '${ENDPOINT}' }]],
  ['neutral', [{ type: 'http', url: `https://mcp.supabase.com/mcp?project_ref=${DEV}` }]],
  ['supabase_local', [{ type: 'http', url: 'http://127.0.0.1:54321/mcp' }]],
  ['supabase_stdio', [{ command: 'npx', args: ['@supabase/mcp-server-supabase', '--project-ref', DEV] }]],
  ['supabase_org', [{ type: 'http', url: 'https://mcp.supabase.com/mcp' }]],
  ['supabase_unscoped', [{ command: 'npx', args: ['@supabase/mcp-server-supabase'] }]],
  ['supabase_empty', [{}]],
  ['search', [{ type: 'http', url: 'https://search.example.test/mcp?key=${MISSING}' }]],
]);
const env = { TARGET_REF: PROD };
const context = { productionRef: PROD, servers, env };
const refusal = (
  tool_name: string,
  tool_input: unknown = {},
  given: Parameters<typeof productionMcpRefusal>[1] = context,
) => productionMcpRefusal({ tool_name, tool_input }, given);

test('the cloud-backend table of the environments doc yields both Supabase refs', () => {
  const refs = supabaseProjectRefs(repositoryRoot);
  expect(refs?.production).toMatch(/^[a-z]{20}$/);
  expect(refs?.dev).toMatch(/^[a-z]{20}$/);
  // The other homes of the production ref agree with the doc the guard reads.
  for (const file of ['eslint.config.mjs', '.github/workflows/release.yml'])
    expect(readFileSync(resolve(repositoryRoot, file), 'utf8'), file).toContain(
      refs?.production ?? 'missing',
    );
});

test('DEV, local and unrelated MCP tools pass', () => {
  expect(refusal('mcp__supabase__execute_sql', { query: 'select 1' })).toBeUndefined();
  expect(refusal('mcp__supabase__list_migrations')).toBeUndefined();
  // The Vercel log-name rule leaves DEV Supabase logs alone.
  expect(refusal('mcp__supabase__get_logs', { service: 'api' })).toBeUndefined();
  expect(refusal('mcp__t3-code__task_status', { taskId: 'a' })).toBeUndefined();
  // "prod" in the tool part names no server.
  expect(refusal('mcp__shop__list_products')).toBeUndefined();
  expect(refusal('Bash', { command: `echo ${PROD}` })).toBeUndefined();
});

test('a Supabase server whose project the hook cannot establish is refused', () => {
  // No configuration entry: the org-wide connector or a server from a scope the hook does not read.
  expect(refusal('mcp__claude_ai_Supabase__list_tables', { project_id: DEV })).toContain(
    'cannot tell whether',
  );
  expect(refusal('mcp__supabase__execute_sql', {}, { ...context, servers: new Map() })).toContain(
    'cannot tell whether',
  );
  // Without the ref, the configuration still marks a neutral name as Supabase.
  expect(refusal('mcp__neutral__execute_sql', {}, { ...context, productionRef: undefined })).toContain(
    'cannot tell whether',
  );
  expect(refusal('mcp__neutral__execute_sql')).toBeUndefined();
});

test('a Supabase server passes only when its configuration names a non-production project or a local stack', () => {
  for (const tool of ['mcp__supabase_local__execute_sql', 'mcp__supabase_stdio__execute_sql'])
    expect(refusal(tool), tool).toBeUndefined();
  for (const tool of [
    'mcp__supabase_org__list_projects',
    'mcp__supabase_unscoped__list_projects',
    'mcp__supabase_empty__list_projects',
  ])
    expect(refusal(tool), tool).toContain('names no project');
});

test('a call without a tool name is refused', () => {
  for (const tool_name of [undefined, 7, null])
    expect(productionMcpRefusal({ tool_name, tool_input: {} }, context)).toContain(
      'could not read the tool name',
    );
});

test('a server named for production is refused, whatever its tool', () => {
  for (const tool of [
    'mcp__supabase-prod-readonly__execute_sql',
    'mcp__supabase-prod-readonly__list_tables',
    'mcp__PROD_db__query',
    'mcp__claude_ai_Supabase_Production__get_advisors',
  ])
    expect(refusal(tool), tool).toContain('production server by its name');
});

test('a call whose input names the production ref is refused', () => {
  expect(refusal('mcp__claude_ai_Supabase__execute_sql', { project_id: PROD, query: 'select 1' })).toContain(
    'names the production Supabase project',
  );
  expect(refusal('mcp__fetch__get', { url: `https://${PROD}.supabase.co/rest/v1/jobs` })).toContain(
    'names the production Supabase project',
  );
});

test('a server configured for the production ref is refused under any name', () => {
  expect(refusal('mcp__database__execute_sql')).toContain('configured for the production Supabase project');
  expect(refusal('mcp__pg__list_tables')).toContain('configured for the production Supabase project');
  // A server name may contain `__`.
  expect(refusal('mcp__team__db__execute_sql')).toContain('configured for the production Supabase project');
  expect(refusal('mcp__db__prod__execute_sql')).toContain('production server by its name');
});

test('a server configuration is judged as the agent expands its variables', () => {
  for (const tool of ['mcp__expanded__execute_sql', 'mcp__defaulted__execute_sql'])
    expect(refusal(tool), tool).toContain('configured for the production Supabase project');
  expect(refusal('mcp__expanded__execute_sql', {}, { ...context, env: { TARGET_REF: DEV } })).toBeUndefined();
  expect(refusal('mcp__unresolved__execute_sql')).toContain('cannot tell whether');
  // The variable hides the whole target; the server name still marks it as Supabase.
  expect(refusal('mcp__supabase_alt__execute_sql')).toContain('cannot tell whether');
  expect(refusal('mcp__search__query')).toBeUndefined();
});

test('without the ref or the server configuration, every Supabase server is refused', () => {
  for (const given of [
    { productionRef: undefined, servers, env },
    { productionRef: PROD, servers: undefined, env },
  ]) {
    expect(refusal('mcp__supabase__execute_sql', {}, given)).toContain('cannot tell whether');
    expect(refusal('mcp__t3-code__task_status', {}, given)).toBeUndefined();
  }
  // The input still names PROD when the configuration is unreadable.
  expect(
    refusal(
      'mcp__fetch__get',
      { url: `https://${PROD}.supabase.co/rest/v1/jobs` },
      { productionRef: PROD, servers: undefined, env },
    ),
  ).toContain('names the production Supabase project');
});

test('the refusal names the structure-only path and the DEV server', () => {
  const reason = refusal('mcp__supabase-prod-readonly__execute_sql');
  expect(reason).toContain('bun run prod:inspect');
  expect(reason).toContain('the DEV server `supabase`');
});

const VERCEL = 'mcp__claude_ai_Vercel__';
const scope = { projectId: 'prj_a', teamId: 'team_a' };

test('a Vercel tool that returns log text from production is refused', () => {
  for (const [tool, input] of [
    ['get_runtime_logs', scope],
    ['get_runtime_logs', { ...scope, environment: 'production' }],
    ['get_runtime_logs', { ...scope, group_by: 'level' }],
    ['get_runtime_errors', scope],
    ['list_deployment_events', { idOrUrl: 'dpl_a', builds: 1 }],
    ['get_deployment_build_logs', { idOrUrl: 'dpl_a', teamId: 'team_a' }],
    // Named for logs, traces or events on a Vercel server, including tools Vercel adds later.
    ['get_agent_run_trace', scope],
    ['get_vercel_ci_invocation_logs', scope],
    ['get_vercel_ci_task_run_logs', scope],
    ['get_session_command_logs', scope],
    ['list_user_events', scope],
    ['get_project_trace', { ...scope, requestId: 'r' }],
  ] as const) {
    const reason = refusal(`${VERCEL}${tool}`, input);
    expect(reason, tool).toContain(`"${tool}" returns log text from production`);
    expect(reason, tool).toContain('vercel.request.count');
  }
  // Any server's tool of that name.
  expect(refusal('mcp__vercel__get_runtime_errors', scope)).toContain('returns log text');
});

test('a Vercel tool that returns a decrypted environment value is refused', () => {
  for (const [tool, input] of [
    ['get_project_env', { idOrName: 'prj_a', id: 'env_a' }],
    ['get_shared_env_var', { id: 'env_a' }],
    ['filter_project_envs', { idOrName: 'prj_a', decrypt: 'true' }],
    ['filter_project_envs', { idOrName: 'prj_a', decrypt: true }],
  ] as const)
    expect(refusal(`${VERCEL}${tool}`, input), tool).toContain('returns an environment value');
  for (const decrypt of [undefined, 'false', false])
    expect(
      refusal(`${VERCEL}filter_project_envs`, { idOrName: 'prj_a', decrypt }),
      String(decrypt),
    ).toBeUndefined();
});

// The allowed dimensions in both spellings Vercel accepts: camelCase (/metrics/v1) and
// snake_case (the /v2/observability API behind the MCP tool).
const SAFE = ['route', 'httpStatus', 'errorCode', 'deploymentId', 'serverActionName'];
const SAFE_SNAKE = ['route', 'http_status', 'error_code', 'deployment_id', 'server_action_name'];

test('a metrics query may group and filter only by the allowed dimensions', () => {
  const query = (body: Record<string, unknown>) =>
    refusal(`${VERCEL}create_observability_query`, {
      requestBody: { metric: 'vercel.request.count', ...body },
    });
  for (const body of [
    { groupBy: ['request_path'] },
    { groupBy: ['requestPath'] },
    { groupBy: ['route', 'client_user_agent'] },
    // A dimension the guard has never heard of is refused too.
    { groupBy: ['someNewDimension'] },
    { groupBy: ['route', 7] },
    { filter: "request_path eq '/kunden'" },
    { filter: "environment eq 'production' and request_id eq 'x'" },
    { filter: 'environment:production AND requestPath:/kunden' },
    { filter: "contains(request_path, 'x')" },
    { aggregation: 'unique/client_ip' },
  ])
    expect(query(body), JSON.stringify(body)).toContain('Refused:');
  expect(refusal(`${VERCEL}create_observability_query`, { teamId: 't' })).toContain(
    'could not read the query',
  );
  for (const groupBy of [SAFE, SAFE_SNAKE]) expect(query({ groupBy }), groupBy.join()).toBeUndefined();
  for (const filter of [
    "environment eq 'production'",
    "environment eq 'production' and http_status ge 500",
    'environment:production AND httpStatus >= 500',
    'deploymentId:dpl_a AND httpStatus >= 500',
    '(route:"/anfragen/[requestId]" OR errorCode:FUNCTION_INVOCATION_TIMEOUT)',
  ])
    expect(query({ filter, groupBy: ['route'], aggregation: 'count' }), filter).toBeUndefined();
});

test('deployment metadata, aggregated counts and preview logs pass', () => {
  for (const [tool, input] of [
    ['list_deployments', { ...scope, target: 'production' }],
    ['get_deployment', { idOrUrl: 'dpl_a' }],
    ['list_deployment_aliases', { id: 'dpl_a' }],
    ['get_project', scope],
    ['get_observability_schema', {}],
    ['get_runtime_logs', { ...scope, environment: 'preview' }],
  ] as const)
    expect(refusal(`${VERCEL}${tool}`, input), tool).toBeUndefined();
});

test('servers come from every Claude Code and Codex scope, keyed as in tool names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-config-'));
  writeFileSync(
    join(dir, 'claude.json'),
    JSON.stringify({
      mcpServers: { supabase: { url: 'user' } },
      projects: {
        '/repo': { mcpServers: { 'claude.ai Db': { url: 'local' } } },
        // Another project's local server of the same name does not apply here.
        '/other': { mcpServers: { supabase: { url: 'other project' } } },
      },
    }),
  );
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { supabase: { url: 'project' } } }));
  writeFileSync(join(dir, 'config.toml'), '[mcp_servers.codex-db]\nurl = "codex"\n');
  const found = configuredMcpServers({
    claudeConfig: join(dir, 'claude.json'),
    projectDir: '/repo',
    projectMcp: join(dir, 'mcp.json'),
    codexConfigs: [join(dir, 'config.toml'), join(dir, 'missing.toml')],
  });
  expect(Object.fromEntries(found)).toEqual({
    supabase: [{ url: 'user' }, { url: 'project' }],
    claude_ai_Db: [{ url: 'local' }],
    'codex-db': [{ url: 'codex' }],
  });
  writeFileSync(join(dir, 'mcp.json'), '{ not json');
  expect(() =>
    configuredMcpServers({
      claudeConfig: join(dir, 'claude.json'),
      projectDir: '/repo',
      projectMcp: join(dir, 'mcp.json'),
      codexConfigs: [],
    }),
  ).toThrow();
});

test('the hook refuses PROD MCP calls with the reason and lets DEV calls through', () => {
  const production = supabaseProjectRefs(repositoryRoot)?.production ?? 'missing';
  const home = mkdtempSync(join(tmpdir(), 'mcp-hook-'));
  mkdirSync(join(home, 'project'));
  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        db: { url: `https://mcp.supabase.com/mcp?project_ref=${production}` },
        supabase: {
          url: `https://mcp.supabase.com/mcp?project_ref=${supabaseProjectRefs(repositoryRoot)?.dev}`,
        },
      },
    }),
  );
  const script = resolve(repositoryRoot, '.claude/hooks/refuse-production-mcp.ts');
  const call = (stdin: string) => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, script],
      stdin: Buffer.from(stdin),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: home,
        CODEX_HOME: home,
        CLAUDE_PROJECT_DIR: join(home, 'project'),
      },
    });
    return { exitCode: result.exitCode, output: `${result.stdout.toString()}${result.stderr.toString()}` };
  };
  const mcp = (tool_name: string, tool_input: unknown = {}) => JSON.stringify({ tool_name, tool_input });
  for (const stdin of [
    mcp('mcp__supabase-prod-readonly__execute_sql', { query: 'select 1' }),
    mcp('mcp__db__list_tables'),
    mcp('mcp__claude_ai_Supabase__execute_sql', { project_id: production }),
    mcp(`${VERCEL}get_runtime_errors`, scope),
    'not json',
    '{}',
    '[]',
  ]) {
    const refused = call(stdin);
    expect(refused.exitCode, refused.output).toBe(2);
    expect(refused.output).toContain('Refused:');
  }
  for (const stdin of [
    mcp('mcp__supabase__execute_sql', { query: 'select 1' }),
    mcp(`${VERCEL}list_deployments`, scope),
  ]) {
    const allowed = call(stdin);
    expect(allowed.exitCode, allowed.output).toBe(0);
  }
});

const hookFileSchema = z.object({
  hooks: z.object({
    PreToolUse: z.array(z.object({ hooks: z.array(z.object({ command: z.string() })) })),
  }),
});

const MCP_GUARD = 'refuse-production-mcp.ts';

/** The command an agent's hook file registers for the MCP guard. */
function registeredGuard(file: string): string {
  const { hooks } = hookFileSchema.parse(JSON.parse(readFileSync(resolve(repositoryRoot, file), 'utf8')));
  const command = hooks.PreToolUse.flatMap((entry) => entry.hooks)
    .map((hook) => hook.command)
    .find((text) => text.includes(MCP_GUARD));
  if (!command) throw new Error(`${file} registers no ${MCP_GUARD}.`);
  return command;
}

const REFUSED_CALL = { tool_name: 'mcp__supabase-prod-readonly__list_tables', tool_input: {} };

function runGuard(command: string, options: { cwd: string; path?: string }) {
  const result = Bun.spawnSync({
    cmd: ['/bin/sh', '-c', command],
    cwd: options.cwd,
    stdin: Buffer.from(JSON.stringify(REFUSED_CALL)),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repositoryRoot, PATH: options.path ?? process.env.PATH ?? '' },
  });
  return { exitCode: result.exitCode, stderr: result.stderr.toString() };
}

// Codex runs a command hook in the session's working directory. The registered command must
// find the script from a subfolder.
test('the Codex hook command refuses a PROD call from a subfolder of the repository', () => {
  const mcp = runGuard(registeredGuard('.codex/hooks.json'), {
    cwd: resolve(repositoryRoot, 'lib/security'),
  });
  expect(mcp.exitCode, mcp.stderr).toBe(2);
  expect(mcp.stderr).toContain('production server by its name');
});

// Both agents block only on exit 2; any other failure of the guard would let the call through.
test('both registered hook commands refuse when the guard itself fails', () => {
  const bin = mkdtempSync(join(tmpdir(), 'broken-bun-'));
  writeFileSync(join(bin, 'bun'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  for (const file of ['.claude/settings.json', '.codex/hooks.json']) {
    const result = runGuard(registeredGuard(file), {
      cwd: repositoryRoot,
      path: `${bin}:${process.env.PATH ?? ''}`,
    });
    expect(result.exitCode, file).toBe(2);
    expect(result.stderr, file).toContain('the MCP guard failed with exit 1');
  }
});
