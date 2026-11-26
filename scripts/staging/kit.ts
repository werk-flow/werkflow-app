import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { chromium, expect, type Page, type Request } from '@playwright/test';

import { supabaseProjectRefs } from '../../lib/security/production-access';
import { readStagingAgentKeys, type StagingAgentKeyName } from '../../lib/security/staging-agent-keys';
import {
  STAGING_ORIGIN,
  refusedOrigin,
  requestVerdict,
  type BrowserRequest,
} from '../../lib/testing/staging/boundary';
import { sendThroughBoundary } from '../../lib/testing/staging/route';
import {
  pendingInviteCodeQuery,
  sandboxAnswer,
  scopedReadQuery,
  type MemberRole,
  type ReadableTable,
  type ScopedRead,
  type StripeFacts,
} from '../../lib/testing/staging/readers';
import {
  RUN_PATTERNS,
  StagingFailure,
  failureText,
  factLine,
  isRunId,
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
    throw new StagingFailure(
      'Unset DEBUG, PWDEBUG and DEBUG_FILE: a staging journey runs without Playwright diagnostics.',
    );
  const read = readStagingAgentKeys();
  const refs = supabaseProjectRefs(checkout);
  if (read.file === 'missing' || !refs)
    throw new StagingFailure('No agent key file or no DEV ref: run bun run agent-access:check.');
  const missing = Object.entries(read.verdicts).filter(([, verdict]) => verdict !== 'ok');
  if (missing.length)
    throw new StagingFailure(
      `Keys not in shape: ${missing.map(([name]) => name).join(', ')}. Run bun run agent-access:check.`,
    );
  const key = (name: StagingAgentKeyName): string => {
    const value = read.values.get(name);
    if (!value) throw new StagingFailure(`${name} is missing.`);
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
    console.error(`[staging] unexpected failure: ${failureText(error, secrets)}`);
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

/** A failure as one printable line (lib/testing/staging/runs.ts, `failureText`). */
export function failureLine(kit: Kit, error: unknown): string {
  return failureText(error, kit.secrets);
}

async function call(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
}

/** A JSON answer, or a throw naming the step and the status, never the body or a parser's quote of it. */
async function json(response: Response, step: string): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new StagingFailure(`${step} answered ${response.status}.`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new StagingFailure(`${step} answered ${response.status} without JSON.`);
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
  if (!issuedActors.has(actor)) throw new StagingFailure('Use the actor createActor made.');
  const rows = z
    .array(z.object({ id: uuidSchema }))
    .parse(
      await readOnlySql(kit, 'select id from public.organizations where name = $1 and admin_id = $2::uuid', [
        runOrganizationName(actor.runId),
        actor.id,
      ]),
    );
  const [row] = rows;
  if (!row || rows.length > 1)
    throw new StagingFailure(`Found ${rows.length} organizations for run ${actor.runId}.`);
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
    throw new StagingFailure('Read only the run organization runOrganization found.');
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

/**
 * The code of the run organization's one pending invite for `role`, which only its invitee may use. It
 * joins the values no printed line may hold (lib/testing/staging/readers.ts, `pendingInviteCodeQuery`).
 */
export async function pendingInviteCode(
  kit: Kit,
  organization: RunOrganization,
  role: MemberRole,
): Promise<string> {
  if (!runOrganizations.has(organization))
    throw new StagingFailure('Read only the run organization runOrganization found.');
  const { query, parameters } = pendingInviteCodeQuery(organization.id, role);
  const rows = z
    .array(z.object({ invite_code: uuidSchema }))
    .parse(await readOnlySql(kit, query, parameters));
  const [row] = rows;
  if (!row || rows.length > 1) throw new StagingFailure(`Found ${rows.length} pending ${role} invites.`);
  kit.secrets.push(row.invite_code);
  return row.invite_code;
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
  if (!isRunId(runId)) throw new StagingFailure('No run id.');
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
    throw new StagingFailure('The created user carries another address or no run marker.');
  const actor = issue({ runId, id: created.id, email, password });
  writeFileSync(join(runFolder(runId), 'actor.json'), JSON.stringify(actor), { mode: 0o600 });
  return actor;
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
    throw new StagingFailure('The user does not carry its run address and marker; nothing changed.');
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
 * journey with its origin, whatever else failed. It takes no screenshot: a page may render a provider's
 * error body.
 */
export async function withStagingBrowser<T>(kit: Kit, journey: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ channel: 'chromium' });
  const refused = new Set<string>();
  const blocked = new Set<string>();
  let outcome: { result: T } | { error: unknown };
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
        mainFrame: isMainFrame(request),
      };
      // A refused page fails the journey; a refused asset or frame, such as a wallet button, is left out.
      const refuse = (hop: BrowserRequest) =>
        (hop.navigation && hop.mainFrame ? refused : blocked).add(refusedOrigin(hop.url));
      try {
        await sendThroughBoundary(
          {
            request: { ...asked, method: request.method(), headers: request.headers() },
            fetch: (options) => route.fetch(options),
            fulfill: (response) => route.fulfill({ response }),
            fulfillPage: (body) => route.fulfill({ status: 200, contentType: 'text/html', body }),
            abort: () => route.abort('blockedbyclient'),
          },
          kit.devRef,
          secret,
          refuse,
        );
      } catch {
        // A failed fetch's error lists the request's headers, the bypass among them: dropped unread.
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
      outcome = { result: await journey(page) };
    } catch (error) {
      if (blocked.size) kit.log('blocked', { origins: [...blocked].join(',') });
      outcome = { error };
    }
  } finally {
    await browser.close();
  }
  // Read after the close, so a hop refused while the browser closed still fails the journey.
  if (refused.size) {
    // The refusal wins, but the journey's own failure still names the step it stopped at.
    if ('error' in outcome) kit.log('journey failure', { reason: failureLine(kit, outcome.error) });
    throw new StagingFailure(`The browser refused pages outside staging: ${[...refused].join(', ')}.`);
  }
  if ('error' in outcome) throw outcome.error;
  return outcome.result;
}

/**
 * Whether a request belongs to its page's main frame. A popup's first navigation is routed before its
 * frame exists, and Playwright then throws: that request is the new page's main frame.
 */
function isMainFrame(request: Request): boolean {
  try {
    return request.frame().parentFrame() === null;
  } catch {
    return request.isNavigationRequest();
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

/** How a journey pays in the sandbox Checkout: Stripe's test card, or its test IBAN that debits at once. */
export type CheckoutMethod = 'card' | 'sepa';

/**
 * Pays the open sandbox Checkout as a payer does, with Stripe's test card or test SEPA account, and
 * waits for staging's return page. Stripe asks for postcode and town only after a first submit.
 */
export async function payInCheckout(page: Page, method: CheckoutMethod): Promise<void> {
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: TIMEOUT_MS });
  const form = page.frameLocator('iframe[src*="elements-inner"]').first();
  if (method === 'card') {
    await form.getByRole('button', { name: 'Karte', exact: true }).click({ timeout: TIMEOUT_MS * 2 });
    await form.getByRole('textbox', { name: 'Kartennummer' }).fill('4242424242424242');
    await form.getByRole('textbox', { name: 'Ablaufdatum (MM/JJ)' }).fill('12/34');
    await form.getByRole('textbox', { name: 'Sicherheitscode' }).fill('123');
  } else {
    await form
      .getByRole('button', { name: 'SEPA-Lastschrift', exact: true })
      .click({ timeout: TIMEOUT_MS * 2 });
    await form.getByRole('textbox', { name: 'IBAN' }).fill('DE89370400440532013000');
  }
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

/**
 * The first answer of `read` that is not null, read again every few seconds for at most `timeoutMs`:
 * a bounded wait on the changed fact, never a fixed delay. A read that throws ends the wait with its
 * error; no answer in time throws a failure naming `waitingFor`.
 */
export async function waitFor<T>(
  waitingFor: string,
  read: () => Promise<T | null>,
  timeoutMs: number,
): Promise<T> {
  // A holder, not a variable: the poll's callback sets it, which a narrowed `let` would hide.
  const seen: { answer: { value: T } | { error: unknown } | null } = { answer: null };
  try {
    await expect
      .poll(
        async () => {
          try {
            const value = await read();
            if (value !== null) seen.answer = { value };
          } catch (error) {
            seen.answer = { error };
          }
          return seen.answer !== null;
        },
        { timeout: timeoutMs, intervals: [2_000, 5_000] },
      )
      .toBe(true);
  } catch {
    // The poll's own message quotes the last answer; the failure names what it waited for.
  }
  const { answer } = seen;
  if (answer === null) throw new StagingFailure(`No ${waitingFor} within ${timeoutMs / 1000} s.`);
  if ('error' in answer) throw answer.error;
  return answer.value;
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
  await withStagingBrowser(kit, async (page) => {
    await signIn(page, actor);
    for (const id of run.organizationIds) {
      const name = organizationNames.get(id);
      if (!name) throw new StagingFailure(`No name for organization ${id}.`);
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
    // An Admin's run first: its organization's deletion ends its members' memberships, which their
    // account deletion waits for.
    const runs = selectRuns(before.actors, before.organizations, runId, new Date()).sort(
      (first, second) => second.organizationIds.length - first.organizationIds.length,
    );
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
