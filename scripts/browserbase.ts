import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import {
  BROWSERBASE_API,
  BROWSER_MINUTES_PER_MONTH,
  type CallKind,
  type Ledger,
  MACHINE_CALL_SHARE,
  SESSION_CAP_MINUTES,
  browseEnvironment,
  callsLeft,
  parseLedger,
  planBrowserbase,
  remoteSessionRefusal,
  withCall,
} from '../lib/security/browserbase';
import { readStagingAgentKeys } from '../lib/security/staging-agent-keys';
import { z } from '../lib/zod';

/**
 * `bun run browserbase -- <command>`: the one way agents reach Browserbase
 * (.claude/skills/browserbase-research/SKILL.md). It runs the CLI pinned in package.json, hands it
 * the key from the agent key file only for a call that needs it, and never prints the key.
 * lib/security/browserbase.ts decides what a call may do.
 */
const checkout = resolve(import.meta.dir, '..');
const STATE = join(homedir(), '.local/state/werkflow');
const LEDGER_FILE = join(STATE, 'browserbase-calls.json');
/** The Stagehand extension this machine uploaded, which the driver needs in a cloud browser. */
const EXTENSION_FILE = join(STATE, 'browserbase-extension.json');
const TIMEOUT_MS = 20_000;

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

/** A Browserbase API call; the key goes in a header and no body is printed. */
async function api(key: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BROWSERBASE_API}${path}`, {
    ...init,
    headers: {
      'X-BB-API-Key': key,
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // BUN_CONFIG_VERBOSE_FETCH in the environment would print the key's header.
    verbose: false,
  });
}

const projectsSchema = z.array(z.object({ id: z.string() })).length(1);
const usageSchema = z.object({ browserMinutes: z.number() });
const sessionSchema = z.object({ id: z.string(), connectUrl: z.string() });

/** The browser minutes of the key's one project this billing month. */
async function browserMinutesUsed(key: string): Promise<number> {
  try {
    const projects = projectsSchema.parse(await (await api(key, '/projects')).json());
    const projectId = projects[0]?.id ?? '';
    const usage = usageSchema.parse(await (await api(key, `/projects/${projectId}/usage`)).json());
    return usage.browserMinutes;
  } catch {
    return refuse('Browserbase did not report the project usage. Run `bun run agent-access:check`.');
  }
}

function readLedger(): Ledger {
  let text: string | undefined;
  try {
    text = existsSync(LEDGER_FILE) ? readFileSync(LEDGER_FILE, 'utf8') : undefined;
  } catch {
    text = '';
  }
  return (
    parseLedger(text) ??
    refuse(`${LEDGER_FILE} is no call ledger. Look at it; delete it only if you know this month's calls.`)
  );
}

/** Writes a state file through a rename, so a reader never sees half of it. */
function writeState(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const next = `${path}.${process.pid}.tmp`;
  writeFileSync(next, JSON.stringify(value));
  renameSync(next, path);
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

async function runCli(args: readonly string[], key?: string): Promise<number> {
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
    env: browseEnvironment(process.env, { key, chromePath: chromePath() }),
  });
  return child.exited;
}

async function quota(): Promise<number> {
  const browserMinutes = await browserMinutesUsed(apiKey());
  const ledger = readLedger();
  const now = Date.now();
  console.log(
    `[browserbase] browser minutes used this month, all machines: ${browserMinutes} of ${BROWSER_MINUTES_PER_MONTH}`,
  );
  for (const kind of ['search', 'fetch'] as const)
    console.log(
      `[browserbase] ${kind} calls left on this machine, last 31 days: ${callsLeft(ledger, kind, now)} of ${MACHINE_CALL_SHARE}`,
    );
  return 0;
}

/** A counted call: refused once this machine's share is spent, counted before it runs. */
async function cloudCall(call: CallKind, args: readonly string[]): Promise<number> {
  const key = apiKey();
  const ledger = readLedger();
  const now = Date.now();
  if (callsLeft(ledger, call, now) === 0)
    refuse(
      `this machine spent its ${MACHINE_CALL_SHARE} ${call} calls of the last 31 days. Stop the run here.`,
    );
  writeState(LEDGER_FILE, withCall(ledger, call, now));
  return runCli(args, key);
}

async function releaseSession(key: string, sessionId: string): Promise<boolean> {
  try {
    const response = await api(key, `/sessions/${sessionId}`, {
      method: 'POST',
      body: JSON.stringify({ status: 'REQUEST_RELEASE' }),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

const extensionSchema = z.object({ id: z.string().min(1), sha256: z.string() });

/** The Stagehand extension archive that the pinned CLI's driver expects in a cloud browser. */
function extensionArchive(): string {
  try {
    const browse = createRequire(fileURLToPath(import.meta.resolve('browse/package.json')));
    return join(
      dirname(browse.resolve('@browserbasehq/stagehand/package.json')),
      'dist/assets/stagehand-extension.zip',
    );
  } catch {
    return refuse(`the pinned CLI is not installed. Run \`bun install --frozen-lockfile\` in ${checkout}.`);
  }
}

/**
 * The project's copy of the extension: the one this machine uploaded for the same archive, or a new
 * upload. Stagehand uploads one per session and deletes it after; one per machine and CLI version
 * keeps a session's start short and leaves nothing to clean up when a run dies.
 */
async function stagehandExtension(key: string, fresh: boolean): Promise<string> {
  const archive = extensionArchive();
  const bytes = readFileSync(archive);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (!fresh && existsSync(EXTENSION_FILE)) {
    const cached = extensionSchema.safeParse(JSON.parse(readFileSync(EXTENSION_FILE, 'utf8')));
    if (cached.success && cached.data.sha256 === sha256) return cached.data.id;
  }
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/zip' }), 'stagehand-extension.zip');
  const uploaded = z
    .object({ id: z.string().min(1) })
    .parse(await (await api(key, '/extensions', { method: 'POST', body: form })).json());
  writeState(EXTENSION_FILE, { id: uploaded.id, sha256 });
  return uploaded.id;
}

/** A session with recording and logging off, with the extension; a stale cached extension is uploaded again once. */
async function createSession(key: string): Promise<z.infer<typeof sessionSchema>> {
  for (const fresh of [false, true]) {
    const response = await api(key, '/sessions', {
      method: 'POST',
      body: JSON.stringify({
        extensionId: await stagehandExtension(key, fresh),
        timeout: SESSION_CAP_MINUTES * 60,
        browserSettings: { recordSession: false, logSession: false },
      }),
    });
    if (response.ok) return sessionSchema.parse(await response.json());
    await response.body?.cancel();
  }
  throw new Error('Browserbase refused the session.');
}

/** A cloud browser with recording and logging off, opened in the local driver as a named session. */
async function remoteOpen(url: string, session: string): Promise<number> {
  const key = apiKey();
  const browserMinutes = await browserMinutesUsed(key);
  const refusal = remoteSessionRefusal(browserMinutes);
  if (refusal) refuse(refusal);
  let created: z.infer<typeof sessionSchema>;
  try {
    created = await createSession(key);
  } catch {
    return refuse('Browserbase did not create the session.');
  }
  // The connect URL opens the session to whoever holds it, so it goes to the driver only.
  const opened = await runCli(['open', url, '--cdp', created.connectUrl, '--session', session]);
  if (opened !== 0) {
    const released = await releaseSession(key, created.id);
    console.error(
      `[browserbase] The page did not open; session ${created.id} released: ${released ? 'ok' : 'failed'}.`,
    );
    return opened;
  }
  console.log(
    `[browserbase] Remote session ${created.id} is open as --session ${session}, recording and logging off. ` +
      `It ends after ${SESSION_CAP_MINUTES} minutes at the latest. ` +
      `Drive it with \`bun run browserbase -- drive <command> --session ${session}\`, ` +
      `end it with \`bun run browserbase -- remote stop ${created.id}${session === 'remote' ? '' : ` --session ${session}`}\`.`,
  );
  return 0;
}

async function remoteStop(sessionId: string, session: string): Promise<number> {
  const key = apiKey();
  await runCli(['stop', '--session', session]);
  const released = await releaseSession(key, sessionId);
  console.log(`[browserbase] session ${sessionId} released: ${released ? 'ok' : 'failed'}`);
  return released ? 0 : 1;
}

const plan = planBrowserbase(process.argv.slice(2));
switch (plan.kind) {
  case 'refused':
    refuse(plan.reason);
    break;
  case 'quota':
    process.exitCode = await quota();
    break;
  case 'cloud':
    process.exitCode = await cloudCall(plan.call, plan.args);
    break;
  case 'drive':
    process.exitCode = await runCli(plan.args);
    break;
  case 'remote-open':
    process.exitCode = await remoteOpen(plan.url, plan.session);
    break;
  case 'remote-stop':
    process.exitCode = await remoteStop(plan.sessionId, plan.session);
    break;
}
