// Rule test: an agent's MCP tool never reaches the production Supabase project.
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
  expect(refusal('mcp__claude_ai_Supabase__list_tables', { project_id: DEV })).toBeUndefined();
  expect(refusal('mcp__t3-code__task_status', { taskId: 'a' })).toBeUndefined();
  // "prod" in the tool part names no server.
  expect(refusal('mcp__shop__list_products')).toBeUndefined();
  expect(refusal('Bash', { command: `echo ${PROD}` })).toBeUndefined();
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

test('servers come from every Claude Code and Codex scope, keyed as in tool names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-config-'));
  writeFileSync(
    join(dir, 'claude.json'),
    JSON.stringify({
      mcpServers: { supabase: { url: 'user' } },
      projects: { '/repo': { mcpServers: { 'claude.ai Db': { url: 'local' } } } },
    }),
  );
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { supabase: { url: 'project' } } }));
  writeFileSync(join(dir, 'config.toml'), '[mcp_servers.codex-db]\nurl = "codex"\n');
  const found = configuredMcpServers({
    claudeConfig: join(dir, 'claude.json'),
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
    JSON.stringify({ mcpServers: { db: { url: `https://mcp.supabase.com/mcp?project_ref=${production}` } } }),
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
    'not json',
  ]) {
    const refused = call(stdin);
    expect(refused.exitCode, refused.output).toBe(2);
    expect(refused.output).toContain('Refused:');
  }
  const dev = call(mcp('mcp__supabase__execute_sql', { query: 'select 1' }));
  expect(dev.exitCode, dev.output).toBe(0);
});
