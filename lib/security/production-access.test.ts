// Rule test: an agent's MCP tool never reaches the production Supabase project, and no MCP tool
// or Vercel CLI call returns production log text.
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from '../zod';

import {
  configuredMcpServers,
  productionLogCommandRefusal,
  productionMcpRefusal,
  supabaseProjectRefs,
} from './production-access';

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
    ['get_project_trace', { ...scope, requestId: 'r' }],
  ] as const) {
    const reason = refusal(`${VERCEL}${tool}`, input);
    expect(reason, tool).toContain(`"${tool}" returns log text from production`);
    expect(reason, tool).toContain('vercel.request.count');
  }
  // Any server's tool of that name.
  expect(refusal('mcp__vercel__get_runtime_errors', scope)).toContain('returns log text');
});

test('a metrics query that names a request dimension is refused, a count by code passes', () => {
  const query = (body: Record<string, unknown>) =>
    refusal(`${VERCEL}create_observability_query`, {
      requestBody: { metric: 'vercel.request.count', ...body },
    });
  for (const body of [
    { groupBy: ['requestPath'] },
    { groupBy: ['route', 'clientUserAgent'] },
    { filter: "requestId eq 'x'" },
    { aggregation: 'unique/clientIp' },
  ])
    expect(query(body), JSON.stringify(body)).toContain('a metric dimension that holds request data');
  expect(
    query({ groupBy: ['route', 'httpStatus', 'errorCode', 'deploymentId', 'serverActionName'] }),
  ).toBeUndefined();
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

test('a shell command that reads Vercel logs from production is refused', () => {
  for (const command of [
    'vercel logs',
    'vercel logs --deployment dpl_a --json',
    'vercel logs requests --since 1h',
    'vercel logs -e production',
    'vercel logs -e preview --environment production',
    'vercel --scope werkflows-projects logs',
    'npx --yes vercel@65 logs --project prj_a',
    'bunx vercel logs',
    'vc logs',
    'cd /x && /usr/local/bin/vercel logs | head',
    'timeout 60 vercel logs',
    'bash -c "vercel logs"',
    "bash -lc 'npx vercel@65 logs --json'",
    'eval vercel logs',
    // A command substitution runs, quoted or not, and so does one in an expanding heredoc.
    'echo "$(vercel logs --json)"',
    'report="$(npx --yes vercel@65 logs --json | jq -c .)"',
    'echo $(vercel logs)',
    'echo "`vercel logs`"',
    'echo "$(printf x; echo "$(vercel logs)")"',
    'cat <<EOF\n$(vercel logs --json)\nEOF',
    'cat <<EOF\n$(\nvercel logs\n)\nEOF',
    'cat <<EOF\nfirst\n`vercel logs`\nEOF\necho done',
    'vercel inspect dpl_a --logs',
    'vercel inspect dpl_a -l',
    'vercel api /v3/deployments/dpl_a/events',
    'vercel api "/v1/projects/prj_a/deployments/dpl_a/runtime-logs?limit=5"',
    'vercel metrics vercel.request.count --group-by requestPath',
    "vercel metrics vercel.request.count --filter 'clientIp eq 1'",
  ])
    expect(productionLogCommandRefusal(command), command).toContain('Agents never read production data');
});

test('other Vercel commands and mentions of the log command pass', () => {
  for (const command of [
    'vercel logs -e preview',
    'vercel logs --environment=preview --deployment dpl_a',
    'vercel inspect dpl_a',
    'vercel list --prod',
    'vercel metrics vercel.request.count -e production --group-by route --group-by httpStatus',
    'vercel api /v4/aliases/app.werk-flow.app',
    'git commit -m "Refuse vercel logs"',
    'gh pr create --body "The hook refuses vercel logs."',
    'grep -rn "vercel logs" docs',
    "cat > note.md <<'EOF'\nvercel logs\nEOF",
    // Single quotes and a quoted heredoc keep a substitution literal.
    "echo '$(vercel logs)'",
    "cat > note.md <<'EOF'\nThe hook refuses `vercel logs` and $(vercel logs).\nEOF",
    'git commit -m "Refuse \\`vercel logs\\`"',
    'tail ~/.local/state/ci-alert.log',
  ])
    expect(productionLogCommandRefusal(command), command).toBeUndefined();
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

test('the shell hook refuses a production log read with the reason and lets other commands through', () => {
  const script = resolve(repositoryRoot, '.claude/hooks/refuse-production-logs.ts');
  const call = (stdin: string) => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, script],
      stdin: Buffer.from(stdin),
      stderr: 'pipe',
    });
    return { exitCode: result.exitCode, output: result.stderr.toString() };
  };
  const bash = (command: string) => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  for (const stdin of [bash('npx --yes vercel@65 logs --json'), 'not json']) {
    const refused = call(stdin);
    expect(refused.exitCode, refused.output).toBe(2);
    expect(refused.output).toContain('Refused:');
  }
  expect(call(bash('npx --yes vercel@65 logs')).output).toContain('`vercel logs` returns runtime log lines');
  for (const stdin of [bash('vercel list --prod'), JSON.stringify({ tool_name: 'Edit', tool_input: {} })]) {
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
const LOG_GUARD = 'refuse-production-logs.ts';

/** The command an agent's hook file registers for this guard. */
function registeredGuard(file: string, guard = MCP_GUARD): string {
  const { hooks } = hookFileSchema.parse(JSON.parse(readFileSync(resolve(repositoryRoot, file), 'utf8')));
  const command = hooks.PreToolUse.flatMap((entry) => entry.hooks)
    .map((hook) => hook.command)
    .find((text) => text.includes(guard));
  if (!command) throw new Error(`${file} registers no ${guard}.`);
  return command;
}

/** A call each guard refuses. */
const REFUSED_CALL = {
  [MCP_GUARD]: { tool_name: 'mcp__supabase-prod-readonly__list_tables', tool_input: {} },
  [LOG_GUARD]: { tool_name: 'Bash', tool_input: { command: 'vercel logs' } },
};

function runGuard(
  command: string,
  options: { cwd: string; path?: string; guard?: keyof typeof REFUSED_CALL },
) {
  const result = Bun.spawnSync({
    cmd: ['/bin/sh', '-c', command],
    cwd: options.cwd,
    stdin: Buffer.from(JSON.stringify(REFUSED_CALL[options.guard ?? MCP_GUARD])),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repositoryRoot, PATH: options.path ?? process.env.PATH ?? '' },
  });
  return { exitCode: result.exitCode, stderr: result.stderr.toString() };
}

// Codex runs a command hook in the session's working directory. The registered command must
// find the script from a subfolder.
test('the Codex hook commands refuse a PROD call from a subfolder of the repository', () => {
  const cwd = resolve(repositoryRoot, 'lib/security');
  const mcp = runGuard(registeredGuard('.codex/hooks.json'), { cwd });
  expect(mcp.exitCode, mcp.stderr).toBe(2);
  expect(mcp.stderr).toContain('production server by its name');
  const logs = runGuard(registeredGuard('.codex/hooks.json', LOG_GUARD), { cwd, guard: LOG_GUARD });
  expect(logs.exitCode, logs.stderr).toBe(2);
  expect(logs.stderr).toContain('`vercel logs` returns runtime log lines');
});

// Both agents block only on exit 2; any other failure of the guard would let the call through.
test('both registered hook commands refuse when the guard itself fails', () => {
  const bin = mkdtempSync(join(tmpdir(), 'broken-bun-'));
  writeFileSync(join(bin, 'bun'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  for (const file of ['.claude/settings.json', '.codex/hooks.json'])
    for (const [guard, name] of [
      [MCP_GUARD, 'MCP'],
      [LOG_GUARD, 'log'],
    ] as const) {
      const result = runGuard(registeredGuard(file, guard), {
        cwd: repositoryRoot,
        path: `${bin}:${process.env.PATH ?? ''}`,
        guard,
      });
      expect(result.exitCode, `${file} ${guard}`).toBe(2);
      expect(result.stderr, `${file} ${guard}`).toContain(`the ${name} guard failed with exit 1`);
    }
});
