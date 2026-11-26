import { devAccessToken } from './staging-agent-keys';

// The DEV scripts' one way into Supabase's Management API for DEV: `auth:check`, `advisors:check`,
// `migrations:check` and the canary's security query. Each only reads. SQL goes through the
// read-only endpoint, which a read-only agent token and CI's tokens both pass
// (docs/technical/machine-setup.md, "Agent keys"). An error names the path and status, never a
// token or a response body.

const DEV_PROJECT_REF = 'mbkkzuqjbdvzelqvuzcn';
const DEV_API = `https://api.supabase.com/v1/projects/${DEV_PROJECT_REF}`;
const TIMEOUT_MS = 30_000;

function bearer(): string {
  const token = devAccessToken();
  if (!token)
    throw new Error(
      'No DEV token: set SUPABASE_ACCESS_TOKEN, or install SUPABASE_DEV_ACCESS_TOKEN in the agent key file (bun run agent-access:check).',
    );
  return `Bearer ${token}`;
}

/** A GET below DEV's project, such as `config/auth`; any status but 200 throws. */
export async function readDevProject(path: string, request: typeof fetch = fetch): Promise<unknown> {
  const response = await request(`${DEV_API}/${path}`, {
    headers: { Authorization: bearer() },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
    // BUN_CONFIG_VERBOSE_FETCH in the environment would print the Authorization header.
    verbose: false,
  });
  if (response.status !== 200) throw new Error(`GET ${path} returned HTTP ${response.status}.`);
  return response.json();
}

/** The rows of one SQL query on DEV in a read-only transaction; any status but 201 throws. */
export async function queryDevReadOnly(
  label: string,
  query: string,
  request: typeof fetch = fetch,
): Promise<unknown> {
  const response = await request(`${DEV_API}/database/query/read-only`, {
    method: 'POST',
    headers: { Authorization: bearer(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
    verbose: false,
  });
  if (response.status !== 201) throw new Error(`DEV ${label} query returned HTTP ${response.status}.`);
  return response.json();
}
