import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  STAGING_AGENT_KEY_FILE,
  STAGING_AGENT_KEY_NAMES,
  type StagingAgentKeyName,
  type Verdict,
  devOnlyVerdict,
  installStagingAgentKeys,
  isStagingAgentKeyName,
  keyShapeVerdict,
  privateModeVerdict,
  protectionVerdict,
  readStagingAgentKeys,
  sandboxVerdict,
  writeRefusedVerdict,
} from '../lib/security/staging-agent-keys';
import { parseEnvironmentFile } from '../lib/testing/evidence/proof-environment';
import { DEV_PROJECT_REF } from '../lib/testing/local-stack/dev-migration-history';

/**
 * `bun run agent-access:check` proves that this machine's agent keys reach DEV, staging and the
 * Stripe sandbox, and nothing more (docs/technical/machine-setup.md, "Agent keys"). It prints each
 * check's name and `ok`, `failed` or `missing`, never a value or a response body, and exits 1 on
 * anything but `ok`. A request that fails or times out fails its check. It sends a key only when the
 * key has its shape, so a live Stripe key never leaves the machine.
 */
const MANAGEMENT_API = 'https://api.supabase.com/v1';
const STAGING_ORIGIN = 'https://werkflow-app-git-main-werkflows-projects.vercel.app';
const TIMEOUT_MS = 20_000;
const checkout = resolve(import.meta.dir, '..');
const home = homedir();

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { redirect: 'manual', ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

/** A check's verdict from a response's status alone; the body is discarded unread. */
async function statusVerdict(response: Response, verdict: (status: number) => Verdict): Promise<Verdict> {
  await response.body?.cancel();
  return verdict(response.status);
}

/** A check that cannot complete fails, and says nothing about why: the error may carry a URL or a body. */
async function probe(check: () => Promise<Verdict>): Promise<Verdict> {
  try {
    return await check();
  } catch {
    return 'failed';
  }
}

async function devOnly(token: string): Promise<Verdict> {
  return probe(async () => {
    const response = await request(`${MANAGEMENT_API}/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return statusVerdict(response, () => 'failed');
    return devOnlyVerdict(await response.json());
  });
}

/** `select 1` through the write endpoint: harmless if it ran, and a read-only token is refused it. */
async function writeRefused(token: string): Promise<Verdict> {
  return probe(async () =>
    statusVerdict(
      await request(`${MANAGEMENT_API}/projects/${DEV_PROJECT_REF}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'select 1' }),
      }),
      writeRefusedVerdict,
    ),
  );
}

/** One row of DEV's Auth users; the body holds personal data, so only the status counts. */
async function readsDevAuth(secretKey: string): Promise<Verdict> {
  return probe(async () =>
    statusVerdict(
      await request(`https://${DEV_PROJECT_REF}.supabase.co/auth/v1/admin/users?page=1&per_page=1`, {
        headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
      }),
      (status) => (status === 200 ? 'ok' : 'failed'),
    ),
  );
}

/** Stripe's balance always carries `livemode`, which a list's items carry only when there are any. */
async function sandboxOnly(key: string): Promise<Verdict> {
  return probe(async () => {
    const response = await request('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) return statusVerdict(response, () => 'failed');
    return sandboxVerdict(await response.json());
  });
}

async function staging(bypass: string | undefined): Promise<Verdict> {
  return probe(async () => {
    const response = await request(`${STAGING_ORIGIN}/login`, {
      headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {},
    });
    const location = response.headers.get('location');
    return statusVerdict(response, (status) => protectionVerdict(status, location, bypass !== undefined));
  });
}

function modeVerdict(path: string): Verdict {
  const stat = statSync(path, { throwIfNoEntry: false });
  return stat ? privateModeVerdict(stat.mode) : 'missing';
}

/** Runs every check, prints each verdict, and answers whether all passed. */
async function check(): Promise<boolean> {
  const lines: [string, Verdict | Promise<Verdict>][] = [];

  // The key file: present, private, in a private folder, with every key in its shape.
  const keyPath = join(home, STAGING_AGENT_KEY_FILE);
  const keys = readStagingAgentKeys(home);
  const fileMode = modeVerdict(keyPath);
  const folderMode = modeVerdict(dirname(keyPath));
  lines.push([
    `~/${STAGING_AGENT_KEY_FILE} mode 600 in a 700 folder`,
    fileMode === 'missing' ? 'missing' : fileMode === 'ok' && folderMode === 'ok' ? 'ok' : 'failed',
  ]);
  const verdictOf = (name: StagingAgentKeyName): Verdict =>
    keys.file === 'missing' ? 'missing' : keys.verdicts[name];
  for (const name of STAGING_AGENT_KEY_NAMES) lines.push([`${name} shape`, verdictOf(name)]);

  /** A check that needs a key runs only when the key has its shape; otherwise it repeats the shape verdict. */
  function withKey(
    name: StagingAgentKeyName,
    check: (value: string) => Promise<Verdict>,
  ): Verdict | Promise<Verdict> {
    const value = keys.file === 'present' ? keys.values.get(name) : undefined;
    return value === undefined ? verdictOf(name) : check(value);
  }
  lines.push(['SUPABASE_DEV_ACCESS_TOKEN sees DEV only', withKey('SUPABASE_DEV_ACCESS_TOKEN', devOnly)]);
  lines.push([
    'SUPABASE_DEV_ACCESS_TOKEN is refused a write',
    withKey('SUPABASE_DEV_ACCESS_TOKEN', writeRefused),
  ]);
  lines.push(['SUPABASE_DEV_SECRET_KEY reads DEV Auth', withKey('SUPABASE_DEV_SECRET_KEY', readsDevAuth)]);
  lines.push(['STRIPE_SANDBOX_KEY answers livemode false', withKey('STRIPE_SANDBOX_KEY', sandboxOnly)]);
  lines.push(['staging refuses a request without the bypass', staging(undefined)]);
  lines.push([
    'VERCEL_STAGING_BYPASS_SECRET passes staging protection',
    withKey('VERCEL_STAGING_BYPASS_SECRET', (bypass) => staging(bypass)),
  ]);

  // Every Supabase token this checkout's env files and the Supabase CLI's login hold sees DEV only.
  const tokenVerdicts = new Map<string, Promise<Verdict>>();
  const tokenVerdict = (token: string): Promise<Verdict> => {
    const known = tokenVerdicts.get(token);
    if (known) return known;
    const verdict = devOnly(token);
    tokenVerdicts.set(token, verdict);
    return verdict;
  };
  const envFiles = readdirSync(checkout)
    .filter((name) => name.startsWith('.env'))
    .sort();
  for (const name of envFiles) {
    const path = join(checkout, name);
    if (!statSync(path, { throwIfNoEntry: false })?.isFile()) continue;
    const token = parseEnvironmentFile(readFileSync(path, 'utf8')).SUPABASE_ACCESS_TOKEN;
    if (token) lines.push([`${name} SUPABASE_ACCESS_TOKEN sees DEV only`, tokenVerdict(token)]);
  }
  const cliLogin = join(home, '.supabase', 'access-token');
  const cliToken = statSync(cliLogin, { throwIfNoEntry: false }) && readFileSync(cliLogin, 'utf8').trim();
  if (cliToken) lines.push(["the Supabase CLI's login sees DEV only", tokenVerdict(cliToken)]);

  // `.env.local` and its backups: private like the key file.
  lines.push(['.env.local mode 600', modeVerdict(join(checkout, '.env.local'))]);
  for (const name of envFiles.filter(
    (file) => file !== '.env.local' && /^\.env\.local|-backup$/.test(file),
  )) {
    const verdict = modeVerdict(join(checkout, name));
    if (verdict !== 'missing') lines.push([`${name} mode 600`, verdict]);
  }

  let passed = true;
  for (const [name, pending] of lines) {
    const verdict = await pending;
    passed &&= verdict === 'ok';
    console.log(`[agent-access] ${name}: ${verdict}`);
  }
  return passed;
}

/**
 * `bun run agent-keys:install -- NAME=<file> ...` writes the keys a T3 secret card delivered as files
 * into the key file, so no value passes through an agent's context or a command line. It prints
 * names and verdicts only, and writes nothing when a key is out of its shape.
 */
function install(args: readonly string[]): boolean {
  const keys = new Map<StagingAgentKeyName, string>();
  for (const arg of args) {
    const split = arg.indexOf('=');
    const name = arg.slice(0, split);
    // Never echo the argument: a value pasted in place of a file name would land in the log.
    if (split < 1 || !isStagingAgentKeyName(name) || keys.has(name)) {
      console.error(
        `[agent-access] An argument is not NAME=<file> with a new agent key name. Names: ${STAGING_AGENT_KEY_NAMES.join(', ')}.`,
      );
      return false;
    }
    keys.set(name, readFileSync(arg.slice(split + 1), 'utf8').trim());
  }
  if (keys.size === 0) {
    console.error('[agent-access] Name at least one key: NAME=<file>.');
    return false;
  }
  const verdicts = [...keys].map(([name, value]) => [name, keyShapeVerdict(name, value)] as const);
  for (const [name, verdict] of verdicts) console.log(`[agent-access] ${name} shape: ${verdict}`);
  if (verdicts.some(([, verdict]) => verdict !== 'ok')) {
    console.error('[agent-access] Nothing was written.');
    return false;
  }
  installStagingAgentKeys(keys, home);
  console.log(`[agent-access] ~/${STAGING_AGENT_KEY_FILE} written: ok. Run bun run agent-access:check.`);
  return true;
}

const [mode, ...args] = process.argv.slice(2);
process.exitCode = (mode === 'install' ? install(args) : await check()) ? 0 : 1;
