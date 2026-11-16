import 'server-only';

import { formatBerlinLocalDate, formatBerlinLocalDateTime } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { billingFailure } from '@/lib/werkflow-billing/failure';
import { sendDebitNotice, sendInvoiceMail, sendReceiptMail } from '@/lib/werkflow-billing/invoice-mails';
import { raiseBillingAlarm } from '@/lib/werkflow-billing/mail-delivery';
import {
  type BillingAlarmFacts,
  type BillingAlarmKind,
  isBillingAlarmKind,
} from '@/lib/werkflow-billing/mails/alarm';
import { HANDLED_EVENT_TYPES } from '@/lib/werkflow-billing/signals/dispatch';
import { handleMandateChange } from '@/lib/werkflow-billing/signals/mandate';
import { handleFailedInvoice } from '@/lib/werkflow-billing/signals/payment-failed';
import type { StripeGateway } from '@/lib/werkflow-billing/stripe';

// The daily comparison with Stripe (werk-flow/werkflow-planning#492), run by
// Vercel Cron (app/api/werkflow-billing-reconciliation/route.ts). Each run:
// 1. raises `reconciliation_missed` when the newest recorded run is older than 26 hours;
// 2. sends every mail row still `failed` again, alarms included, and raises
//    `mail_undelivered` for each one that fails again;
// 3. compares the invoices Stripe finalized in the last 7 days, older than an
//    hour, with issued originals and sent invoice mails: an issued invoice
//    without its mail gets it now, and one still without either raises
//    `invoice_undelivered`;
// 4. raises `signals_quiet` when Stripe holds an event of a handled type, older
//    than an hour, that the signal endpoint never recorded;
// 5. records itself. A failed step or alarm leaves the run incomplete, and the
//    route answers 500 so the production watcher sees it.
// Every alarm goes once per kind and object, so a daily repeat mails nobody twice.

const HOUR = 3600;
const DAY = 24 * HOUR;
const COMPARED_DAYS = 7;
const MISSED_AFTER = 26 * HOUR;
/** Stripe's own signals and retries settle within this; younger objects wait for the next run. */
const SETTLE = HOUR;
/** Stripe keeps events 30 days and retries a signal for 3. */
const SIGNAL_DAYS = 3;
const FAILED_MAILS_CAP = 1000;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type ReconciliationRun = {
  complete: boolean;
  invoicesCompared: number;
  mailsResent: number;
  alarmsRaised: number;
};

type Resend = (stripeObjectId: string, stripe: StripeGateway) => Promise<void>;

const RESEND_CUSTOMER_MAIL: Readonly<Record<string, Resend>> = {
  payment_failed: handleFailedInvoice,
  card_problem: handleFailedInvoice,
  mandate_inactive: handleMandateChange,
  invoice: (id, stripe) => sendInvoiceMail(id, stripe),
  receipt: (id, stripe) => sendReceiptMail(id, stripe),
  // The key is `<subscription>_<renewal>`: only that renewal's notice goes; a passed one stays failed.
  debit_notice: (key, stripe) =>
    sendDebitNotice(key.slice(0, key.lastIndexOf('_')), stripe, {
      renewsAt: Number(key.slice(key.lastIndexOf('_') + 1)),
    }),
};

/** Sends one failed row again; the ledger then holds its new state. */
async function resend(
  row: { kind: string; stripe_object_id: string; failure_code: string | null },
  stripe: StripeGateway,
): Promise<void> {
  const alarmKind = row.kind.replace(/^alarm\./, '');
  if (row.kind.startsWith('alarm.') && isBillingAlarmKind(alarmKind)) {
    // The first attempt's facts are not kept; the person reads the rest in Stripe.
    await raiseBillingAlarm({
      kind: alarmKind,
      stripeObjectId: row.stripe_object_id,
      facts: [
        ['Erneut gesendet', 'vom täglichen Abgleich'],
        ['Erster Fehler', row.failure_code ?? 'unbekannt'],
      ],
    });
    return;
  }
  const send = RESEND_CUSTOMER_MAIL[row.kind];
  if (!send) throw billingFailure('billing_mail_kind_unknown');
  await send(row.stripe_object_id, stripe);
}

function failedMails(admin: Admin) {
  return readCompleteRows(
    (from, to) =>
      // tenant-scope: cross-organization-by-design — the daily comparison resends every organization's failed mails and the alarms.
      admin
        .from('werkflow_billing_mails')
        .select('id, kind, stripe_object_id, failure_code')
        .eq('state', 'failed')
        .order('id')
        .range(from, to),
    FAILED_MAILS_CAP,
  );
}

async function stripeIdsIn(
  read: (
    batch: readonly string[],
  ) => PromiseLike<{ data: string[] | null; error: { message: string } | null }>,
  ids: readonly string[],
): Promise<Set<string>> {
  const { data, error } = await readInBatches(ids, read);
  if (error) throw billingFailure('reconciliation_read_failed');
  return new Set(data);
}

/** One run's shared state: what it reads with, and what it counts. */
type Run = {
  admin: Admin;
  stripe: StripeGateway;
  now: Date;
  nowSeconds: number;
  result: ReconciliationRun;
  /** Raises one alarm; a failed one leaves the run incomplete and the run goes on. */
  alarm(kind: BillingAlarmKind, stripeObjectId: string, facts: BillingAlarmFacts): Promise<void>;
};

async function alarmMissedRun({ admin, nowSeconds, alarm }: Run): Promise<void> {
  const { data, error } = await admin
    .from('werkflow_billing_reconciliations')
    .select('id, ran_at')
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw billingFailure('reconciliation_read_failed');
  if (data && nowSeconds - Date.parse(data.ran_at) / 1000 > MISSED_AFTER) {
    await alarm('reconciliation_missed', `reconciliation_${data.id.replaceAll('-', '')}`, [
      ['Letzter Lauf', formatBerlinLocalDateTime(data.ran_at)],
    ]);
  }
}

async function resendFailedMails({ admin, stripe, result, alarm }: Run): Promise<void> {
  const failed = await failedMails(admin);
  if (failed.error) throw billingFailure('reconciliation_read_failed');
  for (const row of failed.data) {
    await resend(row, stripe).catch((error: unknown) =>
      logError('reconcileWerkflowBilling: resend failed', error),
    );
    result.mailsResent += 1;
  }
  const still = await failedMails(admin);
  if (still.error) throw billingFailure('reconciliation_read_failed');
  const resent = new Set(failed.data.map((row) => row.id));
  for (const row of still.data) {
    // An undelivered-mail alarm that fails itself is resent tomorrow, never chained.
    if (!resent.has(row.id) || row.kind === 'alarm.mail_undelivered') continue;
    await alarm('mail_undelivered', `${row.kind.replace('.', '_')}_${row.stripe_object_id}`, [
      ['Mail', row.kind],
      ['Stripe-Bezug', row.stripe_object_id],
      ['Grund', row.failure_code ?? 'unbekannt'],
    ]);
  }
}

async function compareInvoices({ admin, stripe, nowSeconds, result, alarm }: Run): Promise<void> {
  const finalized = (await stripe.listFinalizedInvoices(nowSeconds - COMPARED_DAYS * DAY)).filter(
    (invoice) => invoice.finalizedAt <= nowSeconds - SETTLE,
  );
  result.invoicesCompared = finalized.length;
  const ids = finalized.map((invoice) => invoice.id);
  const issued = await stripeIdsIn(async (batch) => {
    // tenant-scope: cross-organization-by-design — the Stripe invoice ids span every customer organization.
    // One row per invoice id, so the batch bounds the read.
    const { data, error } = await admin
      .from('werkflow_invoices')
      .select('stripe_invoice_id')
      .in('stripe_invoice_id', batch)
      .limit(batch.length);
    return { data: data?.map((row) => row.stripe_invoice_id) ?? null, error };
  }, ids);
  const mailed = await stripeIdsIn(async (batch) => {
    // tenant-scope: cross-organization-by-design — the invoice mails of every customer organization.
    const { data, error } = await admin
      .from('werkflow_billing_mails')
      .select('stripe_object_id')
      .eq('kind', 'invoice')
      .eq('state', 'sent')
      .in('stripe_object_id', batch)
      .limit(batch.length);
    return { data: data?.map((row) => row.stripe_object_id) ?? null, error };
  }, ids);
  for (const id of ids) {
    const hasOriginal = issued.has(id);
    // An issued invoice without its mail gets it now; the reason it fails goes into the alarm.
    const mailFailure =
      mailed.has(id) || !hasOriginal
        ? null
        : await sendInvoiceMail(id, stripe).then(
            () => null,
            (error: unknown) => String((error instanceof Error && Reflect.get(error, 'code')) || 'unbekannt'),
          );
    const hasMail = mailed.has(id) || (hasOriginal && mailFailure === null);
    if (hasOriginal && hasMail) continue;
    await alarm('invoice_undelivered', id, [
      ['Original', hasOriginal ? 'ausgestellt' : 'fehlt'],
      ['Rechnungsmail', hasMail ? 'gesendet' : 'fehlt'],
      ...(mailFailure ? [['Grund', mailFailure] as const] : []),
    ]);
  }
}

async function alarmQuietSignals({ admin, stripe, now, nowSeconds, alarm }: Run): Promise<void> {
  const eventIds = await stripe.listEventIds(
    nowSeconds - SIGNAL_DAYS * DAY,
    nowSeconds - SETTLE,
    HANDLED_EVENT_TYPES,
  );
  const recorded = await stripeIdsIn(async (batch) => {
    const { data, error } = await admin
      .from('werkflow_billing_signals')
      .select('stripe_event_id')
      .in('stripe_event_id', batch)
      .limit(batch.length);
    return { data: data?.map((row) => row.stripe_event_id) ?? null, error };
  }, eventIds);
  const missing = eventIds.filter((id) => !recorded.has(id));
  const oldest = missing.at(-1);
  if (!oldest) return;
  await alarm('signals_quiet', `signals_${formatBerlinLocalDate(now).replaceAll('-', '')}`, [
    ['Nicht empfangen', String(missing.length)],
    ['Ältestes Ereignis', oldest],
  ]);
}

export async function reconcileWerkflowBilling(
  stripe: StripeGateway,
  now = new Date(),
): Promise<ReconciliationRun> {
  const admin = createSupabaseAdminClient();
  const result: ReconciliationRun = { complete: true, invoicesCompared: 0, mailsResent: 0, alarmsRaised: 0 };
  const guarded = async (name: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      logError(`reconcileWerkflowBilling: ${name} failed`, error);
      result.complete = false;
    }
  };
  const run: Run = {
    admin,
    stripe,
    now,
    nowSeconds: Math.floor(now.getTime() / 1000),
    result,
    alarm: (kind, stripeObjectId, facts) =>
      guarded(`alarm ${kind}`, async () => {
        await raiseBillingAlarm({ kind, stripeObjectId, facts });
        result.alarmsRaised += 1;
      }),
  };
  await guarded('missed run', () => alarmMissedRun(run));
  await guarded('failed mails', () => resendFailedMails(run));
  await guarded('invoices', () => compareInvoices(run));
  await guarded('signals', () => alarmQuietSignals(run));

  const { error } = await admin.from('werkflow_billing_reconciliations').insert({
    invoices_compared: result.invoicesCompared,
    mails_resent: result.mailsResent,
    alarms_raised: result.alarmsRaised,
    complete: result.complete,
  });
  if (error) {
    logError('reconcileWerkflowBilling: recording the run failed', error);
    result.complete = false;
  }
  return result;
}
