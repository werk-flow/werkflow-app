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

/**
 * The only variables the server inherits: what it needs to run and reach the Management API
 * through a proxy or a private CA. Nothing else, so neither another credential nor a Bun setting
 * that logs request headers (`BUN_CONFIG_VERBOSE_FETCH`) reaches it.
 */
const INHERITED = [
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'TZ',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
] as const;

const USAGE = 'Start it as `bun scripts/mcp/supabase-dev.ts --project-ref=<DEV ref>`';

/**
 * Bun's arguments and the server's environment for one start. It refuses without both refs from
 * the environments doc, an argument list other than DEV's ref, PROD's ref, or the agent token.
 * Bun loads no `.env` file from the working directory, and the server gets only INHERITED and the
 * key file's token, never the agent's `SUPABASE_ACCESS_TOKEN`.
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
  const inherited = INHERITED.flatMap((name) => (env[name] === undefined ? [] : [[name, env[name]]]));
  return {
    args: ['--no-env-file', serverEntry, `--project-ref=${refs.dev}`, '--read-only'],
    env: { ...Object.fromEntries(inherited), SUPABASE_ACCESS_TOKEN: token },
  };
}
