import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { chromium, expect, type Page } from '@playwright/test';

import { supabaseProjectRefs } from '../../lib/security/production-access';
import { readStagingAgentKeys, type StagingAgentKeyName } from '../../lib/security/staging-agent-keys';
import {
  STAGING_ORIGIN,
  bypassHeaders,
  refusedOrigin,
  requestVerdict,
} from '../../lib/testing/staging/boundary';
import {
  sandboxAnswer,
  scopedReadQuery,
  type ReadableTable,
  type ScopedRead,
  type StripeFacts,
} from '../../lib/testing/staging/readers';
import {
  RUN_PATTERNS,
  factLine,
  isRunId,
  redact,
  runActorEmail,
  runOrganizationName,
  selectRuns,
  type ActorRow,
  type Fact,
  type OrganizationRow,
  type RunRows,
} from '../../lib/testing/staging/runs';
import { uuidSchema } from '../../lib/validation/uuid';
import { z } from '../../lib/zod';
import { hydrated } from '../../tests/golden/support/steps/interaction';

// The staging journey kit (.claude/skills/staging-journey/SKILL.md): a DEV actor, a browser that
// passes staging's Vercel Authentication, read-only readers, and the cleanup. It reads the machine's
// agent keys through lib/security/staging-agent-keys.ts and prints ids and states only: never a key,
// the actor's password, an address or a response body.

const checkout = resolve(import.meta.dir, '../..');
const MANAGEMENT_API = 'https://api.supabase.com/v1';
const TIMEOUT_MS = 30_000;

export type Kit = {
  devRef: string;
  keys: Readonly<Record<StagingAgentKeyName, string>>;
  /** Values no printed line may hold; the actor's password joins once it exists. */
  secrets: string[];
  log(step: string, facts?: Readonly<Record<string, Fact>>): void;
};

/**
 * The kit with every agent key in its shape, or a throw that names the missing ones. An error that
 * escapes a journey prints only its redacted first line: Playwright's messages can list request headers.
 */
export function loadKit(): Kit {
  // Playwright's debug log lists request headers, the bypass among them.
  if (process.env.DEBUG || process.env.PWDEBUG || process.env.DEBUG_FILE)
    throw new Error(
      'Unset DEBUG, PWDEBUG and DEBUG_FILE: a staging journey runs without Playwright diagnostics.',
    );
  const read = readStagingAgentKeys();
  const refs = supabaseProjectRefs(checkout);
  if (read.file === 'missing' || !refs)
    throw new Error('No agent key file or no DEV ref: run bun run agent-access:check.');
  const missing = Object.entries(read.verdicts).filter(([, verdict]) => verdict !== 'ok');
  if (missing.length)
    throw new Error(
      `Keys not in shape: ${missing.map(([name]) => name).join(', ')}. Run bun run agent-access:check.`,
    );
  const key = (name: StagingAgentKeyName): string => {
    const value = read.values.get(name);
    if (!value) throw new Error(`${name} is missing.`);
    return value;
  };
  const keys = {
    SUPABASE_DEV_ACCESS_TOKEN: key('SUPABASE_DEV_ACCESS_TOKEN'),
    SUPABASE_DEV_SECRET_KEY: key('SUPABASE_DEV_SECRET_KEY'),
    STRIPE_SANDBOX_KEY: key('STRIPE_SANDBOX_KEY'),
    VERCEL_STAGING_BYPASS_SECRET: key('VERCEL_STAGING_BYPASS_SECRET'),
  };
  const secrets = Object.values(keys);
  const escaped = (error: unknown) => {
    console.error(
      `[staging] unexpected failure: ${redact(error instanceof Error ? error.message : String(error), secrets)}`,
    );
    process.exitCode = 1;
  };
  process.on('uncaughtException', escaped);
  process.on('unhandledRejection', escaped);
  return {
    devRef: refs.dev,
    keys,
    secrets,
    log: (step, facts) => console.log(factLine(step, facts, secrets)),
  };
}

/** A failure's first line, safe to print (lib/testing/staging/runs.ts, `redact`). */
export function failureLine(kit: Kit, error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error), kit.secrets);
}

async function call(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
}

/** A JSON answer, or a throw naming the step and the status, never the body or a parser's quote of it. */
async function json(response: Response, step: string): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${step} answered ${response.status}.`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${step} answered ${response.status} without JSON.`);
  }
}

// --- DEV readers: the read-only token through the Management API ---

async function readOnlySql(kit: Kit, query: string, parameters: readonly string[]): Promise<unknown[]> {
  const response = await call(`${MANAGEMENT_API}/projects/${kit.devRef}/database/query/read-only`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kit.keys.SUPABASE_DEV_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, parameters }),
  });
  return z.array(z.unknown()).parse(await json(response, 'The DEV read'));
}

/** The run's own organization; only `runOrganization` makes one, so a reader never takes another id. */
export type RunOrganization = { readonly runId: string; readonly id: string };
const runOrganizations = new WeakSet<RunOrganization>();

/** The organization named for the actor's run that the actor administers, and no other. */
export async function runOrganization(kit: Kit, actor: Actor): Promise<RunOrganization> {
  if (!issuedActors.has(actor)) throw new Error('Use the actor createActor made.');
  const rows = z
    .array(z.object({ id: uuidSchema }))
    .parse(
      await readOnlySql(kit, 'select id from public.organizations where name = $1 and admin_id = $2::uuid', [
        runOrganizationName(actor.runId),
        actor.id,
      ]),
    );
  const [row] = rows;
  if (!row || rows.length > 1) throw new Error(`Found ${rows.length} organizations for run ${actor.runId}.`);
  const organization = Object.freeze({ runId: actor.runId, id: row.id });
  runOrganizations.add(organization);
  return organization;
}

/** One table's rows of the run's organization, allowlisted columns only (lib/testing/staging/readers.ts). */
export async function readDev<T extends ReadableTable>(
  kit: Kit,
  organization: RunOrganization,
  read: Omit<ScopedRead<T>, 'organizationId'>,
): Promise<Record<string, unknown>[]> {
  if (!runOrganizations.has(organization))
    throw new Error('Read only the run organization runOrganization found.');
  const { query, parameters } = scopedReadQuery({ ...read, organizationId: organization.id });
  return z.array(z.record(z.string(), z.unknown())).parse(await readOnlySql(kit, query, parameters));
}

const actorRows = z.array(
  z.object({ id: uuidSchema, email: z.string(), created_at: z.string(), run_marker: z.string().nullable() }),
);
const organizationRows = z.array(z.object({ id: uuidSchema, name: z.string(), admin_id: uuidSchema }));

/** Every run's actor and organization on DEV: the database filters, so no other row reaches the kit. */
async function readRunRows(kit: Kit): Promise<{ actors: ActorRow[]; organizations: OrganizationRow[] }> {
  const [actors, organizations] = await Promise.all([
    readOnlySql(
      kit,
      "select id, email, created_at, raw_app_meta_data->>'werkflow_agent_run' as run_marker from auth.users where email like $1",
      [RUN_PATTERNS.actorEmail],
    ),
    readOnlySql(kit, 'select id, name, admin_id from public.organizations where name like $1', [
      RUN_PATTERNS.organizationName,
    ]),
  ]);
  return {
    actors: actorRows
      .parse(actors)
      .map((row) => ({ id: row.id, email: row.email, createdAt: row.created_at, runMarker: row.run_marker })),
    organizations: organizationRows
      .parse(organizations)
      .map((row) => ({ id: row.id, name: row.name, adminId: row.admin_id })),
  };
}

/** A Stripe sandbox object, or a list's items, as allowed fields; a live answer throws (lib/testing/staging/readers.ts). */
export async function readStripe(kit: Kit, path: string): Promise<StripeFacts[]> {
  const response = await call(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${kit.keys.STRIPE_SANDBOX_KEY}` },
  });
  return sandboxAnswer(await json(response, 'The Stripe read'));
}

// --- The actor: a confirmed DEV user through the secret key, so no mail goes out ---

export type Actor = {
  readonly runId: string;
  readonly id: string;
  readonly email: string;
  readonly password: string;
};
/** Actors this kit created or re-keyed after checking their run marker; no caller makes one. */
const issuedActors = new WeakSet<Actor>();
/** The run marker in the user's app metadata, which only the secret key can write. */
const RUN_MARKER = 'werkflow_agent_run';

function issue(actor: Actor): Actor {
  const issued = Object.freeze({ ...actor });
  issuedActors.add(issued);
  writeFileSync(join(runFolder(actor.runId), 'actor.json'), JSON.stringify(issued), { mode: 0o600 });
  return issued;
}

function authAdmin(kit: Kit, path: string, init: RequestInit = {}): Promise<Response> {
  const secret = kit.keys.SUPABASE_DEV_SECRET_KEY;
  return call(`https://${kit.devRef}.supabase.co/auth/v1/admin/${path}`, {
    ...init,
    headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
  });
}

const userAnswer = z.object({
  id: uuidSchema,
  email: z.string(),
  app_metadata: z.record(z.string(), z.unknown()),
});

/** The run's folder under the gitignored `.agent-logs/`, private to this user. */
function runFolder(runId: string): string {
  if (!isRunId(runId)) throw new Error('No run id.');
  const folder = join(checkout, '.agent-logs', 'staging', runId);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  return folder;
}

function newPassword(): string {
  return `${randomBytes(24).toString('base64url')}-Aa1`;
}

export async function createActor(kit: Kit, runId: string): Promise<Actor> {
  const email = runActorEmail(runId);
  const password = newPassword();
  kit.secrets.push(password);
  const created = userAnswer.parse(
    await json(
      await authAdmin(kit, 'users', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          app_metadata: { [RUN_MARKER]: runId },
          user_metadata: { first_name: 'Agent', last_name: runId },
        }),
      }),
      'Creating the actor',
    ),
  );
  if (created.email !== email || created.app_metadata[RUN_MARKER] !== runId)
    throw new Error('The created user carries another address or no run marker.');
  return issue({ runId, id: created.id, email, password });
}

/**
 * The run's actor with a new password set through the secret key, so a cleanup works from any machine
 * and after any other machine's attempt. The user must still carry the run's address and run marker.
 */
async function actorFor(kit: Kit, run: RunRows): Promise<Actor> {
  const email = runActorEmail(run.runId);
  const user = userAnswer.parse(
    await json(await authAdmin(kit, `users/${run.actorId}`), 'Reading the actor'),
  );
  if (user.email !== email || user.app_metadata[RUN_MARKER] !== run.runId)
    throw new Error('The user does not carry its run address and marker; nothing changed.');
  const password = newPassword();
  kit.secrets.push(password);
  await json(
    await authAdmin(kit, `users/${run.actorId}`, { method: 'PUT', body: JSON.stringify({ password }) }),
    'Setting the actor password',
  );
  return issue({ runId: run.runId, id: run.actorId, email, password });
}

// --- The browser: staging pages only, the bypass to staging's host only ---

/**
 * Runs `journey` on a fresh browser whose pages come from staging only, with the bypass sent to
 * staging's host only (lib/testing/staging/boundary.ts), and closes it after. A refused page fails the
 * journey with its origin, whatever else failed; any failure leaves a screenshot in the run folder.
 */
export async function withStagingBrowser<T>(
  kit: Kit,
  runId: string,
  journey: (page: Page) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({ channel: 'chromium' });
  const refused = new Set<string>();
  const blocked = new Set<string>();
  try {
    // No service worker: its requests pass no route, so they would miss the bypass.
    const context = await browser.newContext({
      baseURL: STAGING_ORIGIN,
      serviceWorkers: 'block',
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
    });
    const secret = kit.keys.VERCEL_STAGING_BYPASS_SECRET;
    await context.route('**/*', async (route) => {
      const request = route.request();
      const asked = {
        url: request.url(),
        navigation: request.isNavigationRequest(),
        mainFrame: request.frame().parentFrame() === null,
      };
      if (requestVerdict(asked, kit.devRef) === 'refused') {
        // A refused page fails the journey; a refused asset or frame, such as a wallet button, is left out.
        (asked.navigation && asked.mainFrame ? refused : blocked).add(refusedOrigin(asked.url));
        await route.abort('blockedbyclient').catch(() => undefined);
        return;
      }
      // Every request is sent here without following redirects, so each redirect's target comes back
      // through this route and its verdict before it is requested, and Playwright never carries the
      // bypass to it. A failed fetch's error lists the request's headers: it is dropped unread.
      try {
        const bypass = bypassHeaders(asked, secret);
        const response = await route.fetch({
          // Another origin's request keeps its own headers: a rewritten set breaks Stripe's pages.
          ...(Object.keys(bypass).length ? { headers: { ...request.headers(), ...bypass } } : {}),
          maxRedirects: 0,
        });
        await route.fulfill({ response });
      } catch {
        await route.abort('failed').catch(() => undefined);
      }
    });
    // Realtime's socket passes no request route: DEV's project only.
    await context.routeWebSocket(/.*/, async (socket) => {
      const asked = { url: socket.url(), navigation: false, mainFrame: false };
      if (requestVerdict(asked, kit.devRef) === 'elsewhere') socket.connectToServer();
      else {
        blocked.add(refusedOrigin(asked.url));
        await socket.close();
      }
    });
    const page = await context.newPage();
    try {
      const result = await journey(page);
      if (refused.size === 0) return result;
    } catch (error) {
      if (blocked.size) kit.log('blocked', { origins: [...blocked].join(',') });
      if (refused.size === 0) {
        const path = join(runFolder(runId), `failure-${Date.now()}.png`);
        if (
          await page.screenshot({ path }).then(
            () => true,
            () => false,
          )
        )
          kit.log('screenshot', { path: relative(checkout, path) });
        throw error;
      }
    }
    throw new Error(`The browser refused pages outside staging: ${[...refused].join(', ')}.`);
  } finally {
    await browser.close();
  }
}

export async function signIn(page: Page, actor: Actor): Promise<void> {
  await page.goto('/login');
  await hydrated(page);
  await page.getByRole('textbox', { name: /^E-Mail/ }).fill(actor.email);
  await page.getByRole('textbox', { name: /^Passwort/ }).fill(actor.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: TIMEOUT_MS });
}

/**
 * Pays the open sandbox Checkout with Stripe's test card, as a payer does, and waits for staging's
 * return page. Stripe asks for postcode and town only after a first submit.
 */
export async function payWithTestCard(page: Page): Promise<void> {
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: TIMEOUT_MS });
  const form = page.frameLocator('iframe[src*="elements-inner"]').first();
  await form.getByRole('button', { name: 'Karte', exact: true }).click({ timeout: TIMEOUT_MS * 2 });
  await form.getByRole('textbox', { name: 'Kartennummer' }).fill('4242424242424242');
  await form.getByRole('textbox', { name: 'Ablaufdatum (MM/JJ)' }).fill('12/34');
  await form.getByRole('textbox', { name: 'Sicherheitscode' }).fill('123');
  await form.getByRole('textbox', { name: 'Vollständiger Name' }).fill('Agenten-Test');
  await form.getByRole('combobox', { name: 'Adresse' }).fill('Teststraße 1');
  await form.getByRole('combobox', { name: 'Adresse' }).press('Escape');
  const submit = form.getByRole('button', { name: 'Kostenpflichtig abonnieren' });
  await submit.click();
  await form.getByRole('textbox', { name: 'Postleitzahl' }).fill('10115');
  await form.getByRole('textbox', { name: 'Ort' }).fill('Berlin');
  await submit.click();
  await expect(page).toHaveURL(new RegExp(`^${STAGING_ORIGIN}/`), { timeout: TIMEOUT_MS * 2 });
}

// --- The cleanup: through the app's own deletion paths ---

/** Deletes the actor's organization in its settings, as its Admin does. */
async function deleteOrganization(page: Page, organizationName: string): Promise<void> {
  await page.goto('/einstellungen/organisation');
  await hydrated(page);
  await page.getByRole('button', { name: 'Organisation löschen', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Organisation löschen' });
  await dialog.getByRole('textbox').fill(organizationName);
  await dialog.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page).toHaveURL(/\/onboarding\/start|\/dashboard/, { timeout: TIMEOUT_MS });
}

/** Deletes the account on the onboarding page, which ends a paid reservation at Stripe first. */
async function deleteAccount(page: Page): Promise<void> {
  await page.goto('/onboarding/start');
  await hydrated(page);
  await page.getByRole('button', { name: 'Konto löschen', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Konto löschen?' });
  await dialog.getByRole('button', { name: 'Konto löschen' }).click();
  await expect(page).toHaveURL(/\/login\?message=account_deleted/, { timeout: TIMEOUT_MS });
}

/** Removes one run's rows through the app: each organization in its settings, then the account. */
async function cleanUpRun(
  kit: Kit,
  run: RunRows,
  organizationNames: ReadonlyMap<string, string>,
): Promise<void> {
  const actor = await actorFor(kit, run);
  await withStagingBrowser(kit, run.runId, async (page) => {
    await signIn(page, actor);
    for (const id of run.organizationIds) {
      const name = organizationNames.get(id);
      if (!name) throw new Error(`No name for organization ${id}.`);
      // Each deletion moves the active organization to the next one, or to the onboarding page.
      await deleteOrganization(page, name);
      kit.log('organization deleted', { run: run.runId, organization: id });
    }
    await deleteAccount(page);
  });
  kit.log('actor deleted', { run: run.runId, actor: run.actorId });
}

/**
 * Removes `runId`'s rows, or with `null` every run older than a day, and proves on DEV that they are
 * gone. Answers whether every selected run went.
 */
export async function cleanUp(kit: Kit, runId: string | null): Promise<boolean> {
  try {
    const before = await readRunRows(kit);
    const runs = selectRuns(before.actors, before.organizations, runId, new Date());
    const names = new Map(before.organizations.map((row) => [row.id, row.name]));
    let passed = true;
    for (const run of runs) {
      try {
        await cleanUpRun(kit, run, names);
      } catch (error) {
        passed = false;
        kit.log('cleanup failed', { run: run.runId, reason: failureLine(kit, error) });
      }
    }
    const after = await readRunRows(kit);
    const left = selectRuns(after.actors, after.organizations, runId, new Date());
    for (const run of left)
      kit.log('left on DEV', { run: run.runId, organizations: run.organizationIds.length });
    kit.log('cleanup', { selected: runs.length, left: left.length });
    return passed && left.length === 0;
  } catch (error) {
    // A DEV read that fails proves nothing is gone.
    kit.log('cleanup failed', { reason: failureLine(kit, error) });
    return false;
  }
}
