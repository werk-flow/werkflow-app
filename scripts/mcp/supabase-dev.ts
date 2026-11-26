import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { supabaseProjectRefs } from '../../lib/security/production-access';
import { readStagingAgentKeys } from '../../lib/security/staging-agent-keys';
import { devMcpLaunch } from '../../lib/security/supabase-dev-mcp';

/**
 * The stdio MCP server `supabase` of Claude Code and Codex: Supabase's MCP server on DEV, read-only,
 * on this machine's agent token (lib/security/supabase-dev-mcp.ts). Standard output belongs to the
 * MCP protocol, so a refusal goes to standard error and names no value.
 */
const checkout = resolve(import.meta.dir, '../..');

function refuse(why: string): never {
  console.error(`[supabase-dev] Refused: ${why}`);
  process.exit(1);
}

function agentToken(): string | undefined {
  try {
    const keys = readStagingAgentKeys();
    return keys.file === 'present' ? keys.values.get('SUPABASE_DEV_ACCESS_TOKEN') : undefined;
  } catch {
    // The reader's error names only the file; the refusal says what to run.
    return undefined;
  }
}

function projectRefs(): ReturnType<typeof supabaseProjectRefs> {
  try {
    return supabaseProjectRefs(checkout);
  } catch {
    return undefined;
  }
}

function serverEntry(): string {
  try {
    // The package exports no path to its command, which sits beside its main module.
    return join(dirname(fileURLToPath(import.meta.resolve('@supabase/mcp-server-supabase'))), 'cli.js');
  } catch {
    return refuse(
      `the pinned server is not installed. Run \`bun install --frozen-lockfile\` in ${checkout}.`,
    );
  }
}

const launch = devMcpLaunch({
  args: process.argv.slice(2),
  refs: projectRefs(),
  token: agentToken(),
  serverEntry: serverEntry(),
  env: process.env,
});
if ('refusal' in launch) refuse(launch.refusal);

let server: ReturnType<typeof Bun.spawn>;
try {
  server = Bun.spawn({
    cmd: [process.execPath, ...launch.args],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: launch.env,
  });
} catch {
  refuse('the server could not start.');
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => server.kill(signal));
process.exit(await server.exited);
