import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { expect, type Page } from '@playwright/test';

import { readOriginal } from '../../lib/testing/staging/original';
import { MEMBER_ROLES, type MemberRole } from '../../lib/testing/staging/readers';
import { StagingFailure, newRunId, runOrganizationName } from '../../lib/testing/staging/runs';
import { SEND_INVITE_MESSAGES } from '../../components/mitarbeiter/invite-messages';
import { ROLE_LABELS } from '../../lib/roles';
import { DEFAULT_SETTINGS_SECTION_SLUG, getSettingsHref } from '../../lib/settings/sections';
import { hydrated } from '../../tests/golden/support/steps/interaction';
import {
  cleanUp,
  createActor,
  failureLine,
  loadKit,
  payInCheckout,
  pendingInviteCode,
  readDev,
  readStripe,
  runOrganization,
  signIn,
  waitFor,
  withStagingBrowser,
  type Actor,
  type CheckoutMethod,
  type RunOrganization,
} from './kit';

// `bun run staging:invoice` (.claude/skills/staging-journey/SKILL.md): E13's sandbox invoice end to
// end on staging (werk-flow/werkflow-planning#245). For the test SEPA account and then the test card,
// a new Admin pays in the sandbox Checkout and creates `Agenten-Test <run>`; Stripe's finalized invoice
// becomes WerkFlow's issued original with Stripe's number; the debit, the invoice mail and the receipt
// follow; the billing page lists the invoice and its PDF downloads as a checked ZUGFeRD original. On the
// SEPA organization a `buero` and an `employee` member join and are refused the billing page. Every
// run's rows go through the app's own deletion paths at the end.

const kit = loadKit();
const started = new Date().toISOString();
/** Every run this journey started, in cleanup order: the Admins' runs before their members'. */
const runIds: string[] = [];
/** Every sandbox subscription a run started, which its cleanup must end. */
const subscriptions: string[] = [];

/** The step that runs now and the staging runtime log query that explains its failure. */
let step = { name: 'start', logs: 'receiveSignal' };
function begin(name: string, logs: string): void {
  step = { name, logs };
}

/** How long Stripe's signals and the mails they send may take on staging. */
const SIGNAL_WAIT_MS = 4 * 60_000;
const BILLING_PATH = '/einstellungen/abonnement-abrechnung';

async function newActor(): Promise<Actor> {
  const runId = newRunId(new Date(), randomBytes(3).toString('hex'));
  runIds.push(runId);
  const actor = await createActor(kit, runId);
  kit.log('actor created', { run: runId, actor: actor.id });
  return actor;
}

type Paid = { organization: RunOrganization; subscriptionId: string; customerId: string };

/** Steps 1 and 2: the Admin pays in the sandbox Checkout and creates the run's organization. */
async function payAndCreateOrganization(page: Page, admin: Actor, method: CheckoutMethod): Promise<Paid> {
  begin(`${method}: checkout`, 'checkout');
  await signIn(page, admin);
  await page.goto('/upgrade');
  await hydrated(page);
  await page.getByRole('button', { name: 'Weiter zur Zahlung' }).click();
  await payInCheckout(page, method);
  await expect(page).toHaveURL(/\/onboarding\/create-organization/);
  await hydrated(page);
  await page.getByLabel('Name der Organisation').fill(runOrganizationName(admin.runId));
  await page.getByRole('button', { name: 'Organisation erstellen' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Organisation erstellt — Du bist jetzt Admin.' }),
  ).toBeVisible({ timeout: 30_000 });
  const organization = await runOrganization(kit, admin);
  const subscription = await waitFor(
    'active subscription on DEV',
    async () => {
      const [row] = await readDev(kit, organization, {
        table: 'werkflow_subscriptions',
        columns: ['status', 'stripe_subscription_id', 'stripe_customer_id'],
      });
      return row?.status === 'active' ? row : null;
    },
    SIGNAL_WAIT_MS,
  );
  const subscriptionId = String(subscription.stripe_subscription_id);
  const customerId = String(subscription.stripe_customer_id);
  kit.log(`${method}: paid in the sandbox Checkout`, {
    organization: organization.id,
    subscription: subscriptionId,
    customer: customerId,
  });
  return { organization, subscriptionId, customerId };
}

type Issued = { stripeInvoiceId: string; number: string; totalCents: number };

/** Step 3: Stripe's finalized invoice is WerkFlow's issued invoice with Stripe's number and amounts. */
async function issuedInvoice(method: CheckoutMethod, paid: Paid): Promise<Issued> {
  begin(`${method}: invoice issued`, 'receiveSignal');
  const [subscription] = await readStripe(kit, `subscriptions/${paid.subscriptionId}`);
  const stripeInvoiceId = String(subscription?.latest_invoice ?? '');
  if (!stripeInvoiceId.startsWith('in_')) throw new StagingFailure('The subscription has no invoice.');
  const [invoice] = await readStripe(kit, `invoices/${stripeInvoiceId}`);
  const number = String(invoice?.number ?? '');
  const totalCents = Number(invoice?.total);
  if (!number || !Number.isInteger(totalCents) || totalCents <= 0)
    throw new StagingFailure(`Stripe's invoice ${stripeInvoiceId} is not finalized with a total.`);
  const row = await waitFor(
    `werkflow_invoices row for ${stripeInvoiceId}`,
    async () =>
      (
        await readDev(kit, paid.organization, {
          table: 'werkflow_invoices',
          columns: ['id', 'number', 'type_code', 'gross_cents', 'stripe_invoice_id'],
        })
      ).find((candidate) => candidate.stripe_invoice_id === stripeInvoiceId) ?? null,
    SIGNAL_WAIT_MS,
  );
  if (row.number !== number || row.type_code !== '380' || row.gross_cents !== totalCents)
    throw new StagingFailure(
      `The issued invoice ${String(row.id)} differs from Stripe's: number, type 380 or total.`,
    );
  kit.log(`${method}: invoice issued with Stripe's number`, {
    stripe_invoice: stripeInvoiceId,
    stripe_status: String(invoice?.status),
    werkflow_invoice: String(row.id),
    number,
    type_code: String(row.type_code),
    gross_cents: totalCents,
  });
  return { stripeInvoiceId, number, totalCents };
}

/** Step 5: Stripe debited the invoice's total, and the invoice mail and the receipt are recorded as sent. */
async function debitAndMails(method: CheckoutMethod, paid: Paid, issued: Issued): Promise<void> {
  begin(`${method}: debit`, 'receiveSignal');
  await waitFor(
    `paid invoice ${issued.stripeInvoiceId} at Stripe`,
    async () => {
      const [invoice] = await readStripe(kit, `invoices/${issued.stripeInvoiceId}`);
      return invoice?.status === 'paid' && invoice.amount_paid === issued.totalCents ? invoice : null;
    },
    SIGNAL_WAIT_MS,
  );
  // The invoice's own payment leads to its charge, which names the method that paid it.
  const [payment, ...others] = (
    await readStripe(kit, `invoice_payments?invoice=${issued.stripeInvoiceId}`)
  ).filter((candidate) => candidate.status === 'paid');
  const paymentIntent = String(payment?.payment_intent ?? '');
  if (others.length || !paymentIntent.startsWith('pi_'))
    throw new StagingFailure(`Invoice ${issued.stripeInvoiceId} has no single paid PaymentIntent.`);
  const [charge] = await readStripe(kit, `charges?payment_intent=${paymentIntent}`);
  const expectedType = method === 'sepa' ? 'sepa_debit' : 'card';
  if (
    charge?.status !== 'succeeded' ||
    charge.amount !== issued.totalCents ||
    charge.payment_method_type !== expectedType
  )
    throw new StagingFailure(
      `The charge of ${paymentIntent} is no succeeded ${expectedType} of ${issued.totalCents} cents.`,
    );
  kit.log(`${method}: debited`, {
    stripe_invoice: issued.stripeInvoiceId,
    payment_intent: paymentIntent,
    charge: String(charge.id),
    charge_status: String(charge.status),
    method: expectedType,
    amount_cents: issued.totalCents,
  });

  begin(`${method}: invoice mail and receipt`, 'receiveSignal');
  let seen: Record<string, unknown>[] = [];
  try {
    await waitFor(
      'sent invoice mail and receipt',
      async () => {
        seen = (
          await readDev(kit, paid.organization, {
            table: 'werkflow_billing_mails',
            columns: ['id', 'kind', 'state', 'attempts', 'failure_code', 'stripe_object_id'],
          })
        ).filter((row) => row.stripe_object_id === issued.stripeInvoiceId);
        const sent = (kind: string) => seen.some((row) => row.kind === kind && row.state === 'sent');
        return sent('invoice') && sent('receipt') ? seen : null;
      },
      SIGNAL_WAIT_MS,
    );
  } finally {
    // The rows the last read saw, also when the wait ended without them: their states explain it.
    for (const row of seen)
      kit.log(`${method}: billing mail`, {
        mail: String(row.id),
        kind: String(row.kind),
        state: String(row.state),
        attempts: Number(row.attempts),
        failure_code: row.failure_code === null ? null : String(row.failure_code),
      });
  }
}

/** Steps 6 and 4: the Admin's billing page lists the invoice, and its PDF is the checked original. */
async function billingPageAndOriginal(page: Page, method: CheckoutMethod, issued: Issued): Promise<void> {
  begin(`${method}: billing page`, 'readWerkflowBilling');
  await page.goto(BILLING_PATH);
  await hydrated(page);
  const pdf = page.getByRole('button', { name: `Rechnung ${issued.number} als PDF herunterladen` });
  await expect(pdf).toBeVisible();
  kit.log(`${method}: billing page lists the invoice`, { number: issued.number });

  begin(`${method}: original downloaded`, 'openWerkflowInvoice');
  const downloading = page.waitForEvent('download');
  await pdf.click();
  const download = await downloading;
  const original = await readOriginal(new Uint8Array(await readFile(await download.path())));
  // Fixed words and rule ids only: the original's own text never reaches a printed line.
  const rules = original.failedRules.filter((rule) => /^[A-Z]+(?:-[A-Z0-9]+)+$/.test(rule));
  if (original.number !== issued.number || original.typeCode !== '380' || original.failedRules.length)
    throw new StagingFailure(
      `The original of ${issued.number} matches its number: ${original.number === issued.number}, is type 380: ${original.typeCode === '380'}, fails ${original.failedRules.length} EN 16931 rules (${rules.join(',')}).`,
    );
  kit.log(`${method}: original downloaded and checked`, {
    number: original.number,
    type_code: original.typeCode,
    en16931: 'passed',
    rules_release: original.rulesRelease,
  });
}

/** Invites each member role through the Admin's Mitarbeiter page, as an Admin does. */
async function inviteMembers(page: Page, members: ReadonlyMap<MemberRole, Actor>): Promise<void> {
  for (const [role, member] of members) {
    await page.goto('/mitarbeiter');
    await hydrated(page);
    await page.getByRole('button', { name: 'Mitarbeiter einladen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Mitarbeiter einladen' });
    await dialog.getByRole('textbox', { name: /^E-Mail-Adresse/ }).fill(member.email);
    await dialog.getByRole('combobox', { name: /^Rolle/ }).click();
    await page.getByRole('option', { name: ROLE_LABELS[role], exact: true }).click();
    await dialog.getByRole('button', { name: 'Einladung senden' }).click();
    const banner = page.getByText(/^Einladung an .+ (?:wurde gesendet\.|konnte nicht gesendet werden: .+)$/);
    await expect(banner).toBeVisible({ timeout: 30_000 });
    const outcome = await banner.innerText();
    if (!outcome.endsWith('wurde gesendet.')) {
      // The banner names the invitee's address: only the code of its known reason is printed.
      const reason = Object.entries(SEND_INVITE_MESSAGES).find(([, message]) => outcome.endsWith(message));
      throw new StagingFailure(`The ${role} invite failed: ${reason?.[0] ?? 'unknown reason'}.`);
    }
  }
}

/** Step 7: a member joins through its invite and is refused the billing page on the server. */
async function memberRefused(member: Actor, role: MemberRole, organization: RunOrganization): Promise<void> {
  begin(`${role}: refused`, 'readSettingsSectionMembership');
  const code = await pendingInviteCode(kit, organization, role);
  await withStagingBrowser(kit, async (page) => {
    await signIn(page, member);
    await page.goto(`/login?invite_code=${code}`);
    await hydrated(page);
    await page.getByRole('button', { name: 'Einladung annehmen' }).click();
    // Joined the run's organization, with the role its role-scoped invite code grants.
    await expect(page).toHaveURL(`/dashboard?joined=${organization.id}`, { timeout: 30_000 });
    await page.goto(BILLING_PATH);
    // The server sends a role the section is closed to to its profile (lib/settings/section-access.ts).
    await expect(page).toHaveURL(getSettingsHref(DEFAULT_SETTINGS_SECTION_SLUG));
    await hydrated(page);
    await expect(page.getByRole('button', { name: /als PDF herunterladen$/ })).toHaveCount(0);
    kit.log(`${role}: refused the billing page`, {
      member: member.id,
      landed_on: new URL(page.url()).pathname,
    });
  });
}

/** Steps 1 to 6 for one payment method; answers the Admin and the organization it paid for. */
async function invoiceJourney(
  method: CheckoutMethod,
): Promise<{ admin: Actor; organization: RunOrganization }> {
  begin(`${method}: actor`, 'checkout');
  const admin = await newActor();
  const organization = await withStagingBrowser(kit, async (page) => {
    const paid = await payAndCreateOrganization(page, admin, method);
    subscriptions.push(paid.subscriptionId);
    const issued = await issuedInvoice(method, paid);
    await debitAndMails(method, paid, issued);
    await billingPageAndOriginal(page, method, issued);
    return paid.organization;
  });
  return { admin, organization };
}

/** Step 7: a `buero` and an `employee` member join the organization and are refused its billing page. */
async function membersRefused(admin: Actor, organization: RunOrganization): Promise<void> {
  begin('members: actors', 'checkout');
  const members = new Map<MemberRole, Actor>();
  for (const role of MEMBER_ROLES) members.set(role, await newActor());
  begin('members: invited', 'createAndMailOrganizationInvite');
  await withStagingBrowser(kit, async (page) => {
    await signIn(page, admin);
    await inviteMembers(page, members);
  });
  for (const [role, member] of members) await memberRefused(member, role, organization);
}

let passed = false;
kit.log('invoice journey', { started });
try {
  const sepa = await invoiceJourney('sepa');
  await invoiceJourney('card');
  // Last, so a member's failure leaves both invoices proven.
  await membersRefused(sepa.admin, sepa.organization);
  passed = true;
} catch (error) {
  kit.log('failed', {
    step: step.name,
    reason: failureLine(kit, error),
    next: `get_runtime_logs environment=preview since=${started} query=${step.logs}`,
  });
} finally {
  begin('cleanup', 'deleteAccount');
  const failed: string[] = [];
  for (const runId of runIds) if (!(await cleanUp(kit, runId))) failed.push(runId);
  // A member's account goes only after its Admin's organization: one more pass, in the same order.
  for (const runId of failed) passed = (await cleanUp(kit, runId)) && passed;
  passed = (await cleanUp(kit, null)) && passed;
}
for (const subscriptionId of subscriptions) {
  // Deleting the organization ended its subscription at Stripe at once.
  try {
    const [ended] = await readStripe(kit, `subscriptions/${subscriptionId}`);
    kit.log('subscription after cleanup', {
      subscription: subscriptionId,
      stripe_status: String(ended?.status),
    });
    passed &&= ended?.status === 'canceled';
  } catch (error) {
    passed = false;
    kit.log('subscription check failed', { reason: failureLine(kit, error) });
  }
}
kit.log('invoice journey', { runs: runIds.join(','), result: passed ? 'passed' : 'failed' });
process.exitCode = passed ? 0 : 1;
