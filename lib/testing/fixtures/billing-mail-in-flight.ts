// Two claims of one billing mail row can send it at the same moment, such as
// an invoice mail the replay after an organization's creation and Stripe's
// live payment signal both send (werk-flow/werkflow-planning#245). Resend then
// answers the later request 409 `concurrent_idempotent_requests` under the
// same idempotency key. The ledger asks again under that key after each of its
// waits until the first request ended, settles the row sent with Resend's
// message id and answers sent, so the signal goes on. A send still in flight
// after every wait, and any other refusal, settles failed for Stripe's next delivery.
// The ledger functions answer as supabase/tests/werkflow_billing_mails.sql proves.
import assert from 'node:assert/strict';
import { jest, mock } from 'bun:test';

const MAIL_ID = '24500000-0000-4000-8000-0000000000a1';
const settles: Record<string, unknown>[] = [];
mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_werkflow_billing_mail') return { data: MAIL_ID, error: null };
      assert.equal(name, 'settle_werkflow_billing_mail');
      settles.push(args);
      return { data: true, error: null };
    },
  }),
}));

// A fake Resend: the next answers in order, then 200; 409 is a request under the same key still sending.
const answers: number[] = [];
const requests: string[] = [];
globalThis.fetch = Object.assign(
  async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    requests.push(new Headers(init?.headers).get('idempotency-key') ?? '');
    const status = answers.shift() ?? 200;
    if (status === 409) return Response.json({ name: 'concurrent_idempotent_requests' }, { status });
    if (status !== 200) return Response.json({ name: 'daily_quota_exceeded' }, { status });
    return Response.json({ id: 'resend-first' });
  },
  { preconnect: fetch.preconnect },
);

const { deliverBillingMail } = await import('@/lib/werkflow-billing/mail-ledger');
const environment = {
  VERCEL_ENV: 'preview',
  RESEND_API_KEY: 're_test_synthetic',
  FROM_EMAIL: 'rechnung@example.com',
};
// testing.md: no wall clock. The ledger's waits run on fake timers, advanced only while it waits.
jest.useFakeTimers();
async function delivery(subject: string, conflicts: number[]) {
  requests.length = 0;
  settles.length = 0;
  answers.push(...conflicts);
  let done = false;
  const outcome = deliverBillingMail(
    {
      kind: 'invoice',
      organizationId: '24500000-0000-4000-8000-000000000001',
      recipient: 'rechnung@sonnenberg.example',
      stripeObjectId: 'in_test_inflight',
      mail: { subject, html: `<p>${subject}</p>`, text: subject },
    },
    environment,
  ).finally(() => {
    done = true;
  });
  while (!done) {
    for (let turn = 0; turn < 100 && !done; turn += 1) await Promise.resolve();
    jest.advanceTimersByTime(1_000);
  }
  const keys = new Set(requests);
  assert.equal(keys.size, 1, 'the requests of one attempt used more than one idempotency key');
  assert.ok(
    [...keys][0]?.startsWith(`werkflow-billing-mail/${MAIL_ID}/`),
    'the idempotency key names no row',
  );
  return outcome;
}
const settled = () =>
  settles.map((args) => [args.p_outcome, args.p_provider_message_id, args.p_failure_code]);

// The later request asks again under the same key until the one in flight ended, and answers its mail as sent.
assert.deepEqual(await delivery('Deine WerkFlow-Rechnung MUSTER-inflight', [409]), { status: 'sent' });
assert.equal(requests.length, 2);
assert.deepEqual(settled(), [['sent', 'resend-first', null]], 'the row did not settle sent with Resend’s id');
assert.deepEqual(await delivery('Deine WerkFlow-Rechnung MUSTER-slow', [409, 409, 409]), { status: 'sent' });
assert.equal(requests.length, 4, 'a send still in flight after the first wait was given up');
assert.deepEqual(settled(), [['sent', 'resend-first', null]]);

// A send still in flight after every wait settles failed, for Stripe's next delivery.
assert.deepEqual(await delivery('Deine WerkFlow-Rechnung MUSTER-stuck', [409, 409, 409, 409, 409]), {
  status: 'retryable',
  code: 'email_concurrent_idempotent_requests',
});
assert.equal(requests.length, 5, 'the in-flight send was not asked again after each wait');
assert.deepEqual(settled(), [['failed', null, 'email_concurrent_idempotent_requests']]);

// Any other refusal settles failed at once.
assert.deepEqual(await delivery('Deine WerkFlow-Rechnung MUSTER-quota', [429]), {
  status: 'retryable',
  code: 'email_daily_quota_exceeded',
});
assert.equal(requests.length, 1, 'a refused mail was sent again in the same attempt');
assert.deepEqual(settled(), [['failed', null, 'email_daily_quota_exceeded']]);
jest.useRealTimers();
