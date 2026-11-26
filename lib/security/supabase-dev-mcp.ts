// The DEV Supabase MCP server agents use in Claude Code and Codex, the same on every machine
// (docs/technical/machine-setup.md, step 4). `scripts/mcp/supabase-dev.ts` starts Supabase's MCP
// server, pinned in package.json, on DEV in read-only mode with the machine's read-only agent
// token. The token reaches the server only in its environment: never in an agent's environment,
// a configuration file or a command line. The configuration names DEV's ref, so the MCP hook
// (lib/security/production-access.ts) sees the server's scope; this check makes the wrapper refuse
// any other ref.

/** How the wrapper starts the server, or why it refuses to. */
export type DevMcpLaunch =
  | { refusal: string }
  | { args: readonly string[]; env: Readonly<Record<string, string | undefined>> };

const USAGE = 'Start it as `bun scripts/mcp/supabase-dev.ts --project-ref=<DEV ref>`';

/**
 * The server's arguments and environment for one start. It refuses without both refs from the
 * environments doc, an argument list other than DEV's ref, PROD's ref, or the agent token.
 * `SUPABASE_ACCESS_TOKEN` from the agent's environment never reaches the server: the key file's
 * token replaces it.
 */
export function devMcpLaunch(input: {
  args: readonly string[];
  refs: { production: string; dev: string } | undefined;
  token: string | undefined;
  serverEntry: string;
  env: Readonly<Record<string, string | undefined>>;
}): DevMcpLaunch {
  const { args, refs, token, serverEntry, env } = input;
  if (!refs) return { refusal: 'The project refs cannot be read from docs/technical/environments.md.' };
  const ref = args.length === 1 ? /^--project-ref=([a-z]{20})$/.exec(args[0] ?? '')?.[1] : undefined;
  if (ref === undefined) return { refusal: `${USAGE}, with nothing else.` };
  if (ref === refs.production)
    return { refusal: 'The ref names PROD. The agent MCP server reaches DEV only.' };
  if (ref !== refs.dev) return { refusal: `The ref is not DEV's. ${USAGE}.` };
  if (!token)
    return {
      refusal:
        'SUPABASE_DEV_ACCESS_TOKEN is missing from the agent key file or out of its shape. Run `bun run agent-access:check`.',
    };
  return {
    args: [serverEntry, `--project-ref=${refs.dev}`, '--read-only'],
    env: { ...env, SUPABASE_ACCESS_TOKEN: token },
  };
}
