import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import {
  BROWSERBASE_API,
  type CallKind,
  MACHINE_CALL_SHARE,
  type SearchRequest,
  apiFailure,
  browseEnvironment,
  callsLeft,
  parseLedger,
  planBrowserbase,
  redirectNote,
  withCall,
} from '../lib/security/browserbase';
import { readStagingAgentKeys } from '../lib/security/staging-agent-keys';
import { z } from '../lib/zod';

/**
 * `bun run browserbase -- <command>`: the one way agents reach Browserbase
 * (.claude/skills/browserbase-research/SKILL.md). It sends every keyed call itself, so the key never
 * enters a subprocess, a redirect or a log, and runs the CLI pinned in package.json only as the
 * local browser driver, without the key. lib/security/browserbase.ts decides what a call may do.
 */
const checkout = resolve(import.meta.dir, '..');
const STATE = join(homedir(), '.local/state/werkflow');
const LEDGER_FILE = join(STATE, 'browserbase-calls.json');
const LEDGER_LOCK = `${LEDGER_FILE}.lock`;
/**
 * The driver's sessions live here, apart from any other tool's. The driver makes it mode 700 and
 * accepts only a folder whose parents others cannot write, such as the system's sticky temp folder.
 */
const DRIVER_DIR = join(tmpdir(), `werkflow-browserbase-${process.getuid?.() ?? 'user'}`);
const TIMEOUT_MS = 30_000;

function refuse(why: string): never {
  console.error(`[browserbase] Refused: ${why}`);
  process.exit(1);
}

function apiKey(): string {
  try {
    const keys = readStagingAgentKeys();
    const key = keys.file === 'present' ? keys.values.get('BROWSERBASE_API_KEY') : undefined;
    if (key) return key;
  } catch {
    // The reader's error names only the file; the refusal says what to run.
  }
  return refuse('no BROWSERBASE_API_KEY in shape in the agent key file. Run `bun run agent-access:check`.');
}

/**
 * A Browserbase API call. The key goes in a header to Browserbase only: a redirect fails the call
 * instead of carrying the header elsewhere, nothing retries it, and no body is printed.
 */
async function api(key: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${BROWSERBASE_API}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    redirect: 'error',
    headers: { 'X-BB-API-Key': key, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // BUN_CONFIG_VERBOSE_FETCH in the environment would print the key's header.
    verbose: false,
  });
}

/** A call's parsed JSON answer, or a refusal with fixed text: a parse error may quote the body. */
async function apiJson<T>(what: string, response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) {
    await response.body?.cancel();
    refuse(apiFailure(what, response.status));
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return refuse(`${what} answered no JSON.`);
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : refuse(`${what} answered in an unknown shape.`);
}

/** Writes a state file through a rename, so a reader never sees half of it. */
function writeState(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const next = `${path}.${process.pid}.tmp`;
  writeFileSync(next, JSON.stringify(value));
  renameSync(next, path);
}

/** How long a call waits for the ledger: the lock is held for one small read and write. */
const LOCK_WAIT_MS = 10_000;

/**
 * Runs `reserve` while this machine's other agents wait, so two of them never both spend the last
 * call. The lock is a file created exclusively, held only for the read and write, never the request.
 * `reserve` returns its refusal instead of exiting, so the lock is always released. A lock left by a
 * run that died is never taken over, since two waiters could both take it: the call fails closed.
 */
async function withLedgerLock(reserve: () => string | undefined): Promise<string | undefined> {
  mkdirSync(STATE, { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      closeSync(openSync(LEDGER_LOCK, 'wx'));
    } catch {
      await Bun.sleep(25);
      continue;
    }
    try {
      return reserve();
    } finally {
      unlinkSync(LEDGER_LOCK);
    }
  }
  return `${LEDGER_LOCK} stayed locked. If no browserbase call runs on this machine, a call died holding it: delete it by its absolute path.`;
}

function readLedger(): ReturnType<typeof parseLedger> {
  return parseLedger(existsSync(LEDGER_FILE) ? readFileSync(LEDGER_FILE, 'utf8') : undefined);
}

/** Counts one call before it is sent: refused once this machine's share of the window is spent. */
async function reserveCall(call: CallKind): Promise<void> {
  const refusal = await withLedgerLock(() => {
    const ledger = readLedger();
    if (!ledger)
      return `${LEDGER_FILE} is no call ledger. Look at it; delete it only if you know this month's calls.`;
    const now = Date.now();
    if (callsLeft(ledger, call, now) === 0)
      return `this machine spent its ${MACHINE_CALL_SHARE} ${call} calls of the last 31 days. Stop the run here.`;
    writeState(LEDGER_FILE, withCall(ledger, call, now));
    return undefined;
  });
  if (refusal) refuse(refusal);
}

/** This machine's calls left. The API reports no call counts, so the ledger is the only source. */
function quota(): number {
  const ledger = readLedger();
  if (!ledger) return refuse(`${LEDGER_FILE} is no call ledger.`);
  const now = Date.now();
  for (const kind of ['search', 'fetch'] as const)
    console.log(
      `[browserbase] ${kind} calls left on this machine, last 31 days: ${callsLeft(ledger, kind, now)} of ${MACHINE_CALL_SHARE}`,
    );
  return 0;
}

const searchSchema = z.object({
  results: z.array(z.object({ title: z.string(), url: z.string(), publishedDate: z.string().optional() })),
});

async function search(request: SearchRequest, output: string | undefined): Promise<number> {
  const key = apiKey();
  await reserveCall('search');
  const answer = await apiJson('Search', await api(key, '/search', request), searchSchema);
  const results = answer.results.map(({ title, url, publishedDate }) => ({
    title: title.trim(),
    url,
    publishedDate,
  }));
  const text = `${JSON.stringify(results, null, 2)}\n`;
  if (output) {
    writeFileSync(output, text);
    console.log(`[browserbase] ${results.length} results written to ${output}`);
  } else process.stdout.write(text);
  return 0;
}

const fetchSchema = z.object({
  statusCode: z.number(),
  content: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

async function fetchPage(url: string, output: string | undefined): Promise<number> {
  const key = apiKey();
  await reserveCall('fetch');
  // `raw`: the free plan answers 402 to markdown and JSON. No redirect: it could lead past the URL guard.
  const page = await apiJson(
    'Fetch',
    await api(key, '/fetch', { url, format: 'raw', allowRedirects: false }),
    fetchSchema,
  );
  if (output) {
    writeFileSync(output, page.content);
    console.log(
      `[browserbase] HTTP ${page.statusCode}${redirectNote(url, page.statusCode, page.headers)}, ${Buffer.byteLength(page.content)} bytes written to ${output}`,
    );
  } else {
    console.error(`[browserbase] HTTP ${page.statusCode}${redirectNote(url, page.statusCode, page.headers)}`);
    process.stdout.write(page.content);
  }
  return 0;
}

/** Playwright's Chromium, which every machine installs, unless CHROME_PATH names another browser. */
function chromePath(): string | undefined {
  try {
    const path = chromium.executablePath();
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

/** The pinned CLI as the local browser driver. It never gets the key. */
async function runDriver(args: readonly string[]): Promise<number> {
  let cli: string;
  try {
    cli = fileURLToPath(import.meta.resolve('browse/bin/run.js'));
  } catch {
    return refuse(`the pinned CLI is not installed. Run \`bun install --frozen-lockfile\` in ${checkout}.`);
  }
  const child = Bun.spawn({
    cmd: ['node', cli, ...args],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: browseEnvironment(process.env, { daemonDir: DRIVER_DIR, chromePath: chromePath() }),
  });
  return child.exited;
}

const plan = planBrowserbase(process.argv.slice(2));
switch (plan.kind) {
  case 'refused':
    refuse(plan.reason);
    break;
  case 'quota':
    process.exitCode = quota();
    break;
  case 'search':
    process.exitCode = await search(plan.request, plan.output);
    break;
  case 'fetch':
    process.exitCode = await fetchPage(plan.url, plan.output);
    break;
  case 'drive':
    process.exitCode = await runDriver(plan.args);
    break;
}
