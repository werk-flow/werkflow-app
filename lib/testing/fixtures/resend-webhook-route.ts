// The real Resend webhook route, the real billing mail handler and alarm path,
// over an in-memory database and the in-memory outbox
// (werk-flow/werkflow-planning#496). The database answers as its functions do;
// supabase/tests/resend_webhook_events.sql proves those. Without a usable
// secret nothing runs; a missing, forged, stale or altered signature answers
// 401 before any record; a bounce marks its billing mail and raises one
// alarm; a replayed or repeated signal changes nothing; an unknown message is
// recorded and acknowledged; a failed step records nothing and answers 5xx,
// and the next delivery succeeds without a second alarm. Logs carry no
// secret, address or signal content.
import assert from 'node:assert/strict';
import { mock, setSystemTime } from 'bun:test';
import { createHmac, randomBytes } from 'node:crypto';

const NOW = new Date('2026-03-02T08:00:00Z');
const NOW_SECONDS = NOW.getTime() / 1000;
setSystemTime(NOW);

const ORGANIZATION = '6f1d3c2a-8b4e-4f5a-9c7d-1e2f3a4b5c6d';
const RECIPIENT = 'rechnung@sonnenberg.example';

type MailRow = {
  id: string;
  kind: string;
  organizationId: string | null;
  recipient: string;
  stripeObjectId: string;
  state: 'pending' | 'sent' | 'failed';
  providerMessageId: string | null;
  deliveryProblem: 'bounced' | 'complained' | null;
};
type EventRow = {
  eventType: string;
  providerMessageId: string | null;
  occurredAt: string;
  ledger: string | null;
};

const mails: MailRow[] = [];
const events = new Map<string, EventRow>();
const calls: string[] = [];
let databaseDown = false;
let failNext: string | null = null;
const logged: string[] = [];
console.error = (...parts: unknown[]) => {
  logged.push(parts.map((part) => JSON.stringify(part)).join(' '));
};

function sentMail(id: string, kind: string, stripeObjectId: string, providerMessageId: string): MailRow {
  return {
    id,
    kind,
    organizationId: kind.startsWith('alarm.') ? null : ORGANIZATION,
    recipient: kind.startsWith('alarm.') ? 'alarm@werkflow.test' : RECIPIENT,
    stripeObjectId,
    state: 'sent',
    providerMessageId,
    deliveryProblem: null,
  };
}
const PAYMENT_MAIL = '4ef9a417-02e9-4d39-ad75-9611e0fc0001';
const CARD_MAIL = '4ef9a417-02e9-4d39-ad75-9611e0fc0002';
const ALARM_MAIL = '4ef9a417-02e9-4d39-ad75-9611e0fc0003';
mails.push(
  sentMail('00000000-0000-4000-8000-000000000001', 'payment_failed', 'in_test_0001', PAYMENT_MAIL),
  sentMail('00000000-0000-4000-8000-000000000002', 'card_problem', 'in_test_0002', CARD_MAIL),
  sentMail('00000000-0000-4000-8000-000000000003', 'alarm.debit_failed', 'in_test_0003', ALARM_MAIL),
);

const failure = { code: '08006', message: `connection lost for ${RECIPIENT}` };
function step(name: string): { data: null; error: typeof failure } | null {
  calls.push(name);
  if (databaseDown) return { data: null, error: failure };
  if (failNext === name) {
    failNext = null;
    return { data: null, error: failure };
  }
  return null;
}

// Answers as the database functions do (supabase/tests/resend_webhook_events.sql,
// supabase/tests/werkflow_billing_mails.sql).
function rpcAnswer(name: string, args: Record<string, unknown>) {
  const failed = step(name);
  if (failed) return failed;
  if (name === 'record_resend_webhook_event') {
    const id = String(args.p_svix_id);
    if (events.has(id)) return { data: false, error: null };
    events.set(id, {
      eventType: String(args.p_event_type),
      providerMessageId: typeof args.p_provider_message_id === 'string' ? args.p_provider_message_id : null,
      occurredAt: String(args.p_occurred_at),
      ledger: typeof args.p_ledger === 'string' ? args.p_ledger : null,
    });
    return { data: true, error: null };
  }
  if (name === 'mark_werkflow_billing_mail_undelivered') {
    const problem = args.p_problem;
    assert.ok(problem === 'bounced' || problem === 'complained');
    const rows = mails.filter((row) => row.providerMessageId === args.p_provider_message_id);
    for (const row of rows) row.deliveryProblem ??= problem;
    return {
      data: rows.map((row) => ({
        kind: row.kind,
        organization_id: row.organizationId,
        stripe_object_id: row.stripeObjectId,
        delivery_problem: row.deliveryProblem,
      })),
      error: null,
    };
  }
  if (name === 'claim_werkflow_billing_mail') {
    const kind = String(args.p_kind);
    const stripeObjectId = String(args.p_stripe_object_id);
    let row = mails.find((mail) => mail.kind === kind && mail.stripeObjectId === stripeObjectId);
    if (!row) {
      row = {
        ...sentMail(`00000000-0000-4000-8000-${String(mails.length + 1).padStart(12, '0')}`, kind, stripeObjectId, ''),
        recipient: String(args.p_recipient),
        state: 'pending',
        providerMessageId: null,
      };
      mails.push(row);
    }
    return { data: row.state === 'sent' ? null : row.id, error: null };
  }
  if (name === 'settle_werkflow_billing_mail') {
    const row = mails.find((mail) => mail.id === args.p_mail_id);
    if (!row || row.state === 'sent') return { data: false, error: null };
    row.state = args.p_outcome === 'sent' ? 'sent' : 'failed';
    row.providerMessageId = typeof args.p_provider_message_id === 'string' ? args.p_provider_message_id : null;
    return { data: true, error: null };
  }
  throw new Error(`unexpected function ${name}`);
}

// The two reads: one signal record by Svix id, and whether a billing mail has a message id.
function readAnswer(table: string, column: string, value: unknown) {
  const failed = step(`read ${table}`);
  if (failed) return failed;
  if (table === 'resend_webhook_events') {
    assert.equal(column, 'svix_id');
    return { data: events.has(String(value)) ? { svix_id: value } : null, error: null };
  }
  assert.equal(table, 'werkflow_billing_mails');
  assert.equal(column, 'provider_message_id');
  return { data: mails.filter((row) => row.providerMessageId === value).map((row) => ({ id: row.id })), error: null };
}

mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => rpcAnswer(name, args),
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => readAnswer(table, column, value),
          limit: async () => readAnswer(table, column, value),
        }),
      }),
    }),
  }),
}));

const { POST } = await import('../../../app/api/resend/webhook/route');
const { memoryOutbox } = await import('@/lib/delivery/memory-outbox');

const secretBytes = randomBytes(24);
const secret = `whsec_${secretBytes.toString('base64')}`;
delete process.env.VERCEL_ENV;
delete process.env.WERKFLOW_ALARM_EMAIL;

let svixCount = 0;
const nextSvixId = () => `msg_test${String((svixCount += 1)).padStart(4, '0')}`;
const payloadOf = (type: string, emailId?: string): string =>
  JSON.stringify({
    type,
    created_at: '2026-03-02T07:59:58.000Z',
    data: { ...(emailId ? { email_id: emailId } : {}), to: [RECIPIENT], subject: 'Zahlung fehlgeschlagen' },
  });
function signatureOf(svixId: string, timestamp: number, payload: string, key: Buffer = secretBytes): string {
  return `v1,${createHmac('sha256', key).update(`${svixId}.${timestamp}.${payload}`).digest('base64')}`;
}
type Delivery = { svixId?: string; timestamp?: number; signature?: string | null; signedPayload?: string };
async function deliver(payload: string, options: Delivery = {}): Promise<number> {
  const svixId = options.svixId ?? nextSvixId();
  const timestamp = options.timestamp ?? NOW_SECONDS;
  const signature =
    options.signature === undefined
      ? signatureOf(svixId, timestamp, options.signedPayload ?? payload)
      : options.signature;
  const response = await POST(
    new Request('https://app.example.test/api/resend/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': svixId,
        'svix-timestamp': String(timestamp),
        ...(signature === null ? {} : { 'svix-signature': signature }),
      },
      body: payload,
    }),
  );
  assert.equal(await response.text(), '', 'a webhook answer carried a body');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.status;
}
const alarms = () => memoryOutbox.messages().filter((message) => message.to === 'alarm@werkflow.test');
const rowOf = (messageId: string) => mails.find((row) => row.providerMessageId === messageId);

// Without a usable secret nothing runs: a 5xx failure, never acceptance.
const bounce = payloadOf('email.bounced', PAYMENT_MAIL);
for (const configured of [undefined, '', 'whsec_short', secretBytes.toString('base64')]) {
  if (configured === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
  else process.env.RESEND_WEBHOOK_SECRET = configured;
  assert.equal(await deliver(bounce), 503, `the secret ${String(configured)} was accepted`);
}
process.env.RESEND_WEBHOOK_SECRET = secret;

// A missing, forged, stale or malformed signature, or a body altered after
// signing, answers 401 and touches nothing.
const svixId = nextSvixId();
const refused: Array<[string, Delivery]> = [
  ['missing', { signature: null }],
  ['empty', { signature: '' }],
  ['forged', { signature: signatureOf(svixId, NOW_SECONDS, bounce, randomBytes(24)) }],
  ['malformed', { signature: 'v1,00' }],
  ['unversioned', { signature: signatureOf(svixId, NOW_SECONDS, bounce).replace('v1,', 'v2,') }],
  ['stale', { timestamp: NOW_SECONDS - 301 }],
  ['early', { timestamp: NOW_SECONDS + 301 }],
  ['altered', { signedPayload: payloadOf('email.delivered', PAYMENT_MAIL) }],
];
for (const [label, options] of refused) {
  assert.equal(await deliver(bounce, { svixId, ...options }), 401, `a ${label} signature was not refused`);
}
// A signature over another Svix id does not carry over.
assert.equal(
  await deliver(bounce, { svixId: nextSvixId(), signature: signatureOf(svixId, NOW_SECONDS, bounce) }),
  401,
  'a signature over another delivery was accepted',
);
assert.deepEqual(calls, [], 'a refused signal reached the database');
assert.equal(memoryOutbox.messages().length, 0);

// One valid signature among several entries verifies, as Svix sends during a secret rotation.
const rotated = payloadOf('email.delivered', CARD_MAIL);
const rotatedId = nextSvixId();
const rotation = `${signatureOf(rotatedId, NOW_SECONDS, rotated, randomBytes(24))} ${signatureOf(rotatedId, NOW_SECONDS, rotated)}`;
assert.equal(await deliver(rotated, { svixId: rotatedId, signature: rotation }), 200);
assert.deepEqual(events.get(rotatedId), {
  eventType: 'email.delivered',
  providerMessageId: CARD_MAIL,
  occurredAt: '2026-03-02T07:59:58.000Z',
  ledger: 'werkflow_billing_mails',
});
assert.equal(rowOf(CARD_MAIL)?.deliveryProblem, null, 'a delivered signal marked its mail');

// A bounce marks its billing mail and raises the alarm once.
const bounceId = nextSvixId();
assert.equal(await deliver(bounce, { svixId: bounceId }), 200);
assert.equal(rowOf(PAYMENT_MAIL)?.deliveryProblem, 'bounced');
assert.equal(events.get(bounceId)?.ledger, 'werkflow_billing_mails');
assert.equal(alarms().length, 1, 'a bounce did not raise exactly one alarm');
const [alarm] = alarms();
assert.ok(alarm?.subject.includes('Abrechnungsmail kam nicht an'));
assert.ok(alarm.text.includes('payment_failed') && alarm.text.includes('unzustellbar') && alarm.text.includes(ORGANIZATION));
assert.ok(!alarm.text.includes(RECIPIENT) && !alarm.html.includes(RECIPIENT), 'the alarm named the address');

// A replay answers 2xx after one lookup and dispatches nothing.
calls.length = 0;
assert.equal(await deliver(bounce, { svixId: bounceId }), 200, 'a replayed signal was not acknowledged');
assert.deepEqual(calls, ['read resend_webhook_events'], 'a replayed signal did more than look itself up');
// A second signal for the same mail keeps the first problem and raises no second alarm.
assert.equal(await deliver(payloadOf('email.complained', PAYMENT_MAIL)), 200);
assert.equal(rowOf(PAYMENT_MAIL)?.deliveryProblem, 'bounced');
assert.equal(alarms().length, 1, 'a second signal for one mail raised a second alarm');

// A complaint marks its mail and raises its own alarm.
assert.equal(await deliver(payloadOf('email.complained', CARD_MAIL)), 200);
assert.equal(rowOf(CARD_MAIL)?.deliveryProblem, 'complained');
assert.equal(alarms().length, 2);
assert.ok(alarms()[1]?.text.includes('als Spam gemeldet'));

// An unknown message id and a signal without one are recorded and acknowledged, and change nothing else.
const unknownId = nextSvixId();
assert.equal(await deliver(payloadOf('email.bounced', '4ef9a417-02e9-4d39-ad75-9611e0fc9999'), { svixId: unknownId }), 200);
assert.deepEqual(events.get(unknownId), {
  eventType: 'email.bounced',
  providerMessageId: '4ef9a417-02e9-4d39-ad75-9611e0fc9999',
  occurredAt: '2026-03-02T07:59:58.000Z',
  ledger: null,
});
const domainId = nextSvixId();
assert.equal(await deliver(payloadOf('domain.updated'), { svixId: domainId }), 200);
assert.equal(events.get(domainId)?.providerMessageId, null);
assert.equal(alarms().length, 2, 'an unknown message raised an alarm');

// A bounced alarm is marked and logged; no alarm goes to the address that bounced.
assert.equal(await deliver(payloadOf('email.bounced', ALARM_MAIL)), 200);
assert.equal(rowOf(ALARM_MAIL)?.deliveryProblem, 'bounced');
assert.equal(alarms().length, 2, 'a bounced alarm raised an alarm');
assert.ok(logged.join('\n').includes('billing_alarm_undelivered'));

// A failed step records nothing and answers 5xx; Resend's next delivery succeeds and raises one alarm.
mails.push(sentMail('00000000-0000-4000-8000-000000000010', 'mandate_inactive', 'mandate_test_0001', 'retry-0001'));
const retried = payloadOf('email.bounced', 'retry-0001');
for (const [failing, status] of [
  ['read resend_webhook_events', 503],
  ['mark_werkflow_billing_mail_undelivered', 500],
  ['claim_werkflow_billing_mail', 500],
  ['record_resend_webhook_event', 503],
] as const) {
  const id = nextSvixId();
  failNext = failing;
  assert.equal(await deliver(retried, { svixId: id }), status, `a failed ${failing} was acknowledged`);
  assert.equal(events.has(id), false, `a failed ${failing} recorded the signal`);
  assert.equal(await deliver(retried, { svixId: id }), 200, `the delivery after a failed ${failing} did not succeed`);
  assert.equal(events.get(id)?.ledger, 'werkflow_billing_mails');
}
assert.equal(rowOf('retry-0001')?.deliveryProblem, 'bounced');
assert.equal(alarms().length, 3, 'retried deliveries raised more than one alarm');

// A database outage answers 503 and dispatches nothing.
databaseDown = true;
calls.length = 0;
assert.equal(await deliver(payloadOf('email.bounced', CARD_MAIL)), 503);
assert.deepEqual(calls, ['read resend_webhook_events']);
databaseDown = false;

// A signed body that is no Resend signal answers 400 and records nothing.
const before = events.size;
for (const body of ['not json', '{}', JSON.stringify({ type: 'Email Bounced', created_at: 'gestern', data: {} })]) {
  assert.equal(await deliver(body), 400, `the body ${body} was accepted`);
}
assert.equal(events.size, before);

// The logs name failures by code only.
const logText = logged.join('\n');
assert.ok(logText.includes('resend_webhook_secret_missing'), 'a missing secret was not logged by its code');
for (const leak of [secret, secretBytes.toString('base64'), RECIPIENT, 'connection lost', PAYMENT_MAIL, 'Zahlung']) {
  assert.ok(!logText.includes(leak), `a log line carried ${leak}`);
}
