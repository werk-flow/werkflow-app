import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import { parseEnvironmentFile } from '../testing/evidence/proof-environment';
import { errorCode } from '../testing/runner/error-code';

// The one owner of the keys agents hold for DEV, staging and the Stripe sandbox
// (docs/technical/machine-setup.md, "Agent keys"). Each machine keeps its own
// copy of each key in one file. Only the processes that use the keys read it,
// through `readStagingAgentKeys`; the hook .claude/hooks/refuse-boat-key-reads.ts
// refuses an agent's read of it. Nothing here prints, logs or returns a value in
// a message.

/** The key file, relative to the home folder. */
export const STAGING_AGENT_KEY_FILE = '.config/werkflow/staging-agents.env';

/** Each key's name and the shape its value has. A live Stripe key never has the sandbox shape. */
const KEY_SHAPES = {
  SUPABASE_DEV_ACCESS_TOKEN: /^sbp_[A-Za-z0-9_]{20,}$/,
  SUPABASE_DEV_SECRET_KEY: /^sb_secret_[A-Za-z0-9_-]{20,}$/,
  STRIPE_SANDBOX_KEY: /^rk_test_[A-Za-z0-9]{20,}$/,
  VERCEL_STAGING_BYPASS_SECRET: /^[A-Za-z0-9]{32}$/,
} as const;

export type StagingAgentKeyName = keyof typeof KEY_SHAPES;

export const STAGING_AGENT_KEY_NAMES: readonly StagingAgentKeyName[] = [
  'SUPABASE_DEV_ACCESS_TOKEN',
  'SUPABASE_DEV_SECRET_KEY',
  'STRIPE_SANDBOX_KEY',
  'VERCEL_STAGING_BYPASS_SECRET',
];

/** What a check found: never a value. */
export type Verdict = 'ok' | 'failed' | 'missing';

/**
 * Every value a file assigns to `name`, `export NAME=` included as Bun reads it: a loader may take
 * the first or the last, so each counts.
 */
export function assignedValues(text: string, name: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => parseEnvironmentFile(line.replace(/^\s*export\s+/, ''))[name] ?? []);
}

/** Whether a value has its key's shape: `missing` when empty or absent. */
export function keyShapeVerdict(name: StagingAgentKeyName, value: string | undefined): Verdict {
  if (!value) return 'missing';
  return KEY_SHAPES[name].test(value) ? 'ok' : 'failed';
}

/** What the key file holds: each key with its shape verdict, and the values only of keys in shape. */
export type StagingAgentKeys =
  | { file: 'missing' }
  | {
      file: 'present';
      verdicts: Readonly<Record<StagingAgentKeyName, Verdict>>;
      values: ReadonlyMap<StagingAgentKeyName, string>;
    };

/** Parses the key file's text; a value out of shape is left out, so no caller sends it anywhere. */
function stagingAgentKeysFrom(text: string): StagingAgentKeys {
  const assignments = parseEnvironmentFile(text);
  const values = new Map<StagingAgentKeyName, string>();
  const verdict = (name: StagingAgentKeyName): Verdict => {
    const value = assignments[name];
    const found = keyShapeVerdict(name, value);
    if (found === 'ok' && value) values.set(name, value);
    return found;
  };
  return {
    file: 'present',
    verdicts: {
      SUPABASE_DEV_ACCESS_TOKEN: verdict('SUPABASE_DEV_ACCESS_TOKEN'),
      SUPABASE_DEV_SECRET_KEY: verdict('SUPABASE_DEV_SECRET_KEY'),
      STRIPE_SANDBOX_KEY: verdict('STRIPE_SANDBOX_KEY'),
      VERCEL_STAGING_BYPASS_SECRET: verdict('VERCEL_STAGING_BYPASS_SECRET'),
    },
    values,
  };
}

/**
 * Reads the machine's key file for the process that uses the keys. It never prints a value, and
 * refuses a path that is no regular file, which could block or fail the read.
 */
export function readStagingAgentKeys(home = homedir()): StagingAgentKeys {
  const path = join(home, STAGING_AGENT_KEY_FILE);
  const unreadable = new Error(
    `The agent key file ~/${STAGING_AGENT_KEY_FILE} cannot be read as a regular file.`,
  );
  try {
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) return { file: 'missing' };
    if (stat.isFile()) return stagingAgentKeysFrom(readFileSync(path, 'utf8'));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { file: 'missing' };
    throw unreadable;
  }
  throw unreadable;
}

export function isStagingAgentKeyName(name: string): name is StagingAgentKeyName {
  return Object.hasOwn(KEY_SHAPES, name);
}

/** The key file's text with each of `keys` on one line of its own; every other line stays. */
function withStagingAgentKeys(text: string, keys: ReadonlyMap<StagingAgentKeyName, string>): string {
  const kept = text.split(/\r?\n/).filter((line) => {
    const name = /^\s*([A-Za-z_]\w*)\s*=/.exec(line)?.[1];
    return !(name !== undefined && isStagingAgentKeyName(name) && keys.has(name));
  });
  while (kept.at(-1) === '') kept.pop();
  return `${[...kept, ...[...keys].map(([name, value]) => `${name}=${value}`)].join('\n')}\n`;
}

/**
 * Writes keys into the machine's key file, mode 600 in a 700 folder, through a rename so a reader
 * never sees half a file. A key out of its shape refuses the whole write, so a live Stripe key never
 * lands there. The error names the key, never its value.
 */
export function installStagingAgentKeys(
  keys: ReadonlyMap<StagingAgentKeyName, string>,
  home = homedir(),
): void {
  for (const [name, value] of keys)
    if (keyShapeVerdict(name, value) !== 'ok')
      throw new Error(`${name} does not have its shape, so nothing was written.`);
  const path = join(home, STAGING_AGENT_KEY_FILE);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const next = `${path}.${process.pid}.tmp`;
  writeFileSync(next, withStagingAgentKeys(current, keys), { mode: 0o600 });
  renameSync(next, path);
}

/** What `statSync` tells about a path: its permission bits and its type. */
type PathStat = { mode: number; isFile(): boolean; isDirectory(): boolean };

/** Whether a key file is a regular file with mode 600, or its folder a folder with mode 700. */
export function privateModeVerdict(stat: PathStat, kind: 'file' | 'folder'): Verdict {
  const typed = kind === 'file' ? stat.isFile() : stat.isDirectory();
  return typed && (stat.mode & 0o777) === (kind === 'file' ? 0o600 : 0o700) ? 'ok' : 'failed';
}

/**
 * Whether a Supabase token reaches DEV and not PROD, from `GET /v1/projects/{ref}` for each: a
 * project-scoped token can make both calls, unlike the account-wide project list. DEV must answer
 * 200, PROD a refusal (401, 403 or 404). An account-wide token sees PROD and fails; an answer that
 * proves nothing (a rate limit, a server error) fails too.
 */
export function devOnlyVerdict(devStatus: number, productionStatus: number): Verdict {
  return devStatus === 200 && [401, 403, 404].includes(productionStatus) ? 'ok' : 'failed';
}

/**
 * A write the token must be refused: only Supabase's permission denial (403) proves it. A refused
 * sign-in (401), a write that ran, or any other answer fails.
 */
export function writeRefusedVerdict(status: number): Verdict {
  return status === 403 ? 'ok' : 'failed';
}

const livemodeSchema = z.object({ livemode: z.boolean() });

/** Whether a Stripe answer says it came from a sandbox: `livemode: false`, nothing else. */
export function sandboxVerdict(body: unknown): Verdict {
  const parsed = livemodeSchema.safeParse(body);
  return parsed.success && !parsed.data.livemode ? 'ok' : 'failed';
}

/**
 * Whether staging's protection holds for a request to the app's sign-in page. Without the bypass,
 * Vercel answers 401, or a browser's request with a redirect to its sign-in on vercel.com. With the
 * bypass, only the app's sign-in page itself (200) proves the request reached the app.
 */
export function protectionVerdict(status: number, location: string | null, bypass: boolean): Verdict {
  if (bypass) return status === 200 ? 'ok' : 'failed';
  const vercelSignIn =
    status === 401 ||
    (status >= 300 && status < 400 && location !== null && URL.parse(location)?.hostname === 'vercel.com');
  return vercelSignIn ? 'ok' : 'failed';
}
