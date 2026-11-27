// Two claims of one billing mail row can send it at the same moment, such as
// an invoice mail the replay after an organization's creation and Stripe's
// live payment signal both send (werk-flow/werkflow-planning#245). Resend then
// answers the later request 409 `concurrent_idempotent_requests` under the
// same idempotency key. The ledger sends again under that key until the first
// request ended, settles the row sent with its message id and answers sent,
// so the signal goes on. Any other refusal is not sent again here.
// The ledger functions answer as supabase/tests/werkflow_billing_mails.sql proves.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';

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

// A fake Resend: the next answers in order; a key it accepted answers that mail's id.
const answers: Array<{ status: number; name?: string }> = [];
const accepted = new Map<string, string>();
const requests: string[] = [];
globalThis.fetch = Object.assign(
  async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    const key = new Headers(init?.headers).get('idempotency-key') ?? '';
    requests.push(key);
    const known = accepted.get(key);
    if (known) return Response.json({ id: known });
    const answer = answers.shift() ?? { status: 200 };
    if (answer.status === 409) {
      // The other request under this key is still sending; it ends meanwhile with this id.
      accepted.set(key, 'resend-first');
      return Response.json({ name: answer.name }, { status: 409 });
    }
    if (answer.status !== 200) return Response.json({ name: answer.name }, { status: answer.status });
    accepted.set(key, `resend-${accepted.size + 1}`);
    return Response.json({ id: `resend-${accepted.size}` });
  },
  { preconnect: fetch.preconnect },
);

const { deliverBillingMail } = await import('@/lib/werkflow-billing/mail-ledger');
const environment = {
  VERCEL_ENV: 'preview',
  RESEND_API_KEY: 're_test_synthetic',
  FROM_EMAIL: 'rechnung@example.com',
};
const delivery = (subject: string) =>
  deliverBillingMail(
    {
      kind: 'invoice',
      organizationId: '24500000-0000-4000-8000-000000000001',
      recipient: 'rechnung@sonnenberg.example',
      stripeObjectId: 'in_test_inflight',
      mail: { subject, html: `<p>${subject}</p>`, text: subject },
    },
    environment,
  );

// The later request waits for the one in flight and answers its mail as sent.
answers.push({ status: 409, name: 'concurrent_idempotent_requests' });
assert.deepEqual(await delivery('Deine WerkFlow-Rechnung MUSTER-inflight'), { status: 'sent' });
assert.equal(requests.length, 2, 'the in-flight send was not asked again');
assert.equal(requests[0], requests[1], 'the second request used another idempotency key');
assert.deepEqual(
  settles.map((args) => [args.p_outcome, args.p_provider_message_id, args.p_failure_code]),
  [['sent', 'resend-first', null]],
  'the row did not settle as sent with the first request’s id',
);

// Any other refusal settles failed at once, for Stripe's next delivery.
requests.length = 0;
settles.length = 0;
answers.push({ status: 429, name: 'daily_quota_exceeded' });
assert.deepEqual(await delivery('Deine WerkFlow-Rechnung MUSTER-quota'), {
  status: 'retryable',
  code: 'email_daily_quota_exceeded',
});
assert.equal(requests.length, 1, 'a refused mail was sent again in the same attempt');
assert.deepEqual(
  settles.map((args) => [args.p_outcome, args.p_failure_code]),
  [['failed', 'email_daily_quota_exceeded']],
);
