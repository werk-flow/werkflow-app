import { resolve } from 'node:path';

import {
  configuredMcpServers,
  mcpConfigPaths,
  productionMcpRefusal,
  supabaseProjectRefs,
} from '../../lib/security/production-access';

/**
 * PreToolUse hook for MCP calls, wired in .claude/settings.json and
 * .codex/hooks.json (pinned by lib/testing/runner/guard-wiring.test.ts): exits 2
 * with the reason when the tool reaches the production Supabase project
 * (lib/security/production-access.ts). A call it cannot read is refused, and
 * so is a Supabase call when the ref or the server configuration is unreadable.
 */
const repositoryRoot = resolve(import.meta.dir, '../..');

function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

let call: unknown;
try {
  call = JSON.parse(await Bun.stdin.text());
} catch {
  console.error('Refused: the MCP guard could not read the tool call, so it cannot rule out PROD.');
  process.exit(2);
}
const reason =
  call && typeof call === 'object'
    ? productionMcpRefusal(
        { tool_name: Reflect.get(call, 'tool_name'), tool_input: Reflect.get(call, 'tool_input') },
        {
          productionRef: attempt(() => supabaseProjectRefs(repositoryRoot)?.production),
          servers: attempt(() =>
            configuredMcpServers(mcpConfigPaths(process.env.CLAUDE_PROJECT_DIR ?? repositoryRoot)),
          ),
        },
      )
    : 'Refused: the MCP guard could not read the tool call, so it cannot rule out PROD.';
if (reason) {
  console.error(reason);
  process.exit(2);
}
process.exit(0);
