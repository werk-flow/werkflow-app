import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  STAGING_AGENT_KEY_FILE,
  STAGING_AGENT_KEY_NAMES,
  type StagingAgentKeyName,
  type StagingAgentKeys,
  type Verdict,
  devOnlyVerdict,
  envFileValues,
  installStagingAgentKeys,
  isStagingAgentKeyName,
  keyShapeVerdict,
  privateModeVerdict,
  protectionVerdict,
  queryErrorSqlState,
  readStagingAgentKeys,
  sandboxVerdict,
  writeRefusedVerdict,
} from '../lib/security/staging-agent-keys';
import { supabaseProjectRefs } from '../lib/security/production-access';

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
/** Both refs come from the environments doc, so PROD's never enters code. */
const refs = supabaseProjectRefs(checkout);

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

/** Whether the token reaches DEV's project and is refused PROD's; neither body is read. */
async function devOnly(token: string): Promise<Verdict> {
  if (!refs) return 'failed';
  return probe(async () => {
    const status = async (ref: string) => {
      const response = await request(`${MANAGEMENT_API}/projects/${ref}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await response.body?.cancel();
      return response.status;
    };
    const [dev, production] = await Promise.all([status(refs.dev), status(refs.production)]);
    return devOnlyVerdict(dev, production);
  });
}

/**
 * A temporary table through the query endpoint: it needs write access, vanishes with its session if
 * it ran, and Supabase refuses it to a token without Database write (writeRefusedVerdict). Only a
 * 400's SQLSTATE is read; every other body is discarded unread.
 */
async function writeRefused(token: string): Promise<Verdict> {
  if (!refs) return 'failed';
  return probe(async () => {
    const response = await request(`${MANAGEMENT_API}/projects/${refs.dev}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'create temporary table agent_access_write_probe (id int)' }),
    });
    if (response.status !== 400)
      return statusVerdict(response, (status) => writeRefusedVerdict(status, undefined));
    return writeRefusedVerdict(400, queryErrorSqlState(await response.json()));
  });
}

/** One row of DEV's Auth users; the body holds personal data, so only the status counts. */
async function readsDevAuth(secretKey: string): Promise<Verdict> {
  if (!refs) return 'failed';
  return probe(async () =>
    statusVerdict(
      await request(`https://${refs.dev}.supabase.co/auth/v1/admin/users?page=1&per_page=1`, {
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

/** A path's mode verdict; a path through a file or one the user cannot reach fails, never crashes. */
function modeVerdict(path: string, kind: 'file' | 'folder'): Verdict {
  try {
    const stat = statSync(path, { throwIfNoEntry: false });
    return stat ? privateModeVerdict(stat, kind) : 'missing';
  } catch {
    return 'failed';
  }
}

/** The key file's contents, or undefined when it is no regular file or cannot be read. */
function readKeys(): StagingAgentKeys | undefined {
  try {
    return readStagingAgentKeys(home);
  } catch {
    // The reader's error names only the file; the verdict says `failed`.
    return undefined;
  }
}

/** Runs every check, prints each verdict, and answers whether all passed. */
async function check(): Promise<boolean> {
  const lines: [string, Verdict | Promise<Verdict>][] = [];

  // The key file: present, private, in a private folder, with every key in its shape.
  const keyPath = join(home, STAGING_AGENT_KEY_FILE);
  const keys = readKeys();
  const fileMode = modeVerdict(keyPath, 'file');
  const folderMode = modeVerdict(dirname(keyPath), 'folder');
  lines.push([
    `~/${STAGING_AGENT_KEY_FILE} mode 600 in a 700 folder`,
    fileMode === 'missing' ? 'missing' : fileMode === 'ok' && folderMode === 'ok' ? 'ok' : 'failed',
  ]);
  const verdictOf = (name: StagingAgentKeyName): Verdict =>
    keys === undefined ? 'failed' : keys.file === 'missing' ? 'missing' : keys.verdicts[name];
  for (const name of STAGING_AGENT_KEY_NAMES) lines.push([`${name} shape`, verdictOf(name)]);

  /** A check that needs a key runs only when the key has its shape; otherwise it repeats the shape verdict. */
  function withKey(
    name: StagingAgentKeyName,
    check: (value: string) => Promise<Verdict>,
  ): Verdict | Promise<Verdict> {
    const value = keys?.file === 'present' ? keys.values.get(name) : undefined;
    return value === undefined ? verdictOf(name) : check(value);
  }
  lines.push([
    'SUPABASE_DEV_ACCESS_TOKEN reaches DEV and not PROD',
    withKey('SUPABASE_DEV_ACCESS_TOKEN', devOnly),
  ]);
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

  // Every Supabase token this checkout's env files hold reaches DEV and not PROD. A value without a token's
  // shape fails unsent, so another provider's key never reaches Supabase.
  const tokenVerdicts = new Map<string, Promise<Verdict>>();
  const tokenVerdict = (token: string): Verdict | Promise<Verdict> => {
    if (keyShapeVerdict('SUPABASE_DEV_ACCESS_TOKEN', token) !== 'ok') return 'failed';
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
    const tokens = envFileValues(join(checkout, name), 'SUPABASE_ACCESS_TOKEN');
    // A file the check cannot read may hold a token it cannot vouch for; the others are still checked.
    if (tokens === 'failed') {
      lines.push([`${name} readable`, 'failed']);
      continue;
    }
    tokens.forEach((token, index) => {
      const which = tokens.length > 1 ? ` #${index + 1}` : '';
      lines.push([`${name} SUPABASE_ACCESS_TOKEN${which} reaches DEV and not PROD`, tokenVerdict(token)]);
    });
  }

  // `.env.local` and its backups: private like the key file.
  lines.push(['.env.local mode 600', modeVerdict(join(checkout, '.env.local'), 'file')]);
  for (const name of envFiles.filter(
    (file) => file !== '.env.local' && /^\.env\.local|-backup$/.test(file),
  )) {
    const verdict = modeVerdict(join(checkout, name), 'file');
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
    try {
      keys.set(name, readFileSync(arg.slice(split + 1), 'utf8').trim());
    } catch {
      // The error names the path, which may be a value pasted in its place: report the key only.
      console.error(`[agent-access] ${name} file: failed. Nothing was written.`);
      return false;
    }
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
