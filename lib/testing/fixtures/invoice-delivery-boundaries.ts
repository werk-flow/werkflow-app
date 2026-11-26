// The real delivery actions, sendDocument and the mail transport over the
// action world: a field worker reaches nothing; another organization's
// invoice or delivery is refused; the attachment is always the invoice's own
// filed original, whatever the client sends; a press sent twice puts one mail
// in the outbox; a provider failure leaves the delivery failed, and the retry
// sends it once; a sent delivery is never sent again; the rate limit comes
// before any write; a changed original is never attached; logs carry no
// address or text. The world stands in for the database functions, which
// supabase/tests/document_deliveries.sql proves.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mock, spyOn } from 'bun:test';
import { EMPTY_COMPANY_PROFILE_DETAILS } from '@/lib/company-profile/profile';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs, tableRows } from './action-boundary-world';
import { companyProfileRow } from './company-profile-rows';
import { assertRefused } from './operations-boundary-refusals';

const invoiceId = '98200000-0000-4000-8000-000000000001';
const foreignInvoiceId = '98200000-0000-4000-8000-000000000009';
const originalId = '98200000-0000-4000-8000-000000000101';
const foreignDocumentId = '98200000-0000-4000-8000-000000000109';
const originalPath = `${ORGANIZATION_A}/${originalId}/Rechnung RE-2037-001.pdf`;
const pdf = new TextEncoder().encode('%PDF-1.7 Rechnung RE-2037-001');
let storedPdf = pdf;
const contentHash = createHash('sha256').update(pdf).digest('hex');
const recipient = 'buchhaltung@lindenhof.example';
const mailSubject = 'Rechnung RE-2037-001 – Haustechnik Sonnenberg GmbH';
const mailText = 'Guten Tag,\n\nanbei die Rechnung RE-2037-001.';

process.env.EMAIL_OTP_HASH_SECRET = 'fixture-only-delivery-secret';
process.env.FROM_EMAIL = 'WerkFlow <rechnung@werkflow.example>';
const logged: string[] = [];
spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
  logged.push(parts.map((part) => JSON.stringify(part)).join(' '));
});

const realStorage = await import('@/lib/storage/r2');
mock.module('@/lib/storage/r2', () => ({
  ...realStorage,
  readStorageObject: async ({ organizationId, path }: { organizationId: string; path: string }) => {
    assert.equal(organizationId, ORGANIZATION_A, 'the attachment was read outside the caller organization');
    if (path !== originalPath) throw new Error('storage_object_missing');
    return storedPdf;
  },
}));

const world = installActionWorld({
  company_document_profiles: [
    {
      ...companyProfileRow(ORGANIZATION_A, 'Haustechnik Sonnenberg GmbH', ''),
      email: 'buero@sonnenberg.example',
    },
  ],
});
const { memoryOutbox } = await import('@/lib/delivery/memory-outbox');
const { markInvoiceSentManually, retryInvoiceDelivery, sendInvoiceEmail } = await import(
  '@/lib/invoices/delivery-actions'
);

const issued = {
  id: invoiceId,
  invoiceNumber: 'RE-2037-001',
  status: 'ausgestellt',
  version: 3,
  serviceStart: '2037-11-02',
  serviceEnd: '2037-11-02',
  paymentDueDays: 14,
  discountDays: null,
  discountBasisPoints: null,
  orderReference: '',
  buyerReference: '',
  openingText: '',
  closingText: '',
  lineNetCents: 10800,
  taxCents: 2052,
  grossCents: 12852,
  issueDate: '2037-11-20',
  issueSnapshot: {
    organizationName: 'Haustechnik Sonnenberg',
    profile: { ...EMPTY_COMPANY_PROFILE_DETAILS, companyName: 'Haustechnik Sonnenberg GmbH' },
    files: { logo: null, stationery_first: null, stationery_following: null },
    buyer: {
      name: 'Hausverwaltung Lindenhof GmbH',
      address: { lines: ['Hofweg 1'], postalCode: '10117', city: 'Berlin', countryCode: 'DE' },
    },
  },
  original: { documentId: originalId, filed: true },
  client: { id: '97200000-0000-4000-8000-000000000001', name: 'Hausverwaltung Lindenhof GmbH' },
  recipient: {
    id: '97200000-0000-4000-8000-000000000001',
    name: 'Hausverwaltung Lindenhof GmbH',
    address: null,
  },
  work: null,
  lines: [],
  lineSources: [],
};

// The database functions: one row per attempt key, a claim per attempt, a settle per claim.
// A delivery keeps what the action forwarded, as the table does, and answers it on every attempt.
type Delivery = {
  id: string;
  attemptKey: string;
  state: 'sending' | 'sent' | 'failed';
  attempt: number;
  failureCode: string | null;
  stored: Record<'recipient' | 'subject' | 'text' | 'senderName' | 'fromHeader' | 'replyTo', unknown>;
};
const deliveries: Delivery[] = [];
// The limiter refuses every check, or only the one action it names.
let limiterAllows = true;
let limitedAction: string | null = null;
const refused = (message: string) => ({ data: null, error: { code: 'P0001', message } });
const payloadOf = (delivery: Delivery, claimed: boolean) => ({
  deliveryId: delivery.id,
  claimed,
  state: delivery.state,
  failureCode: delivery.failureCode,
  attempt: delivery.attempt,
  ...delivery.stored,
  storagePath: originalPath,
  fileName: 'Rechnung RE-2037-001.pdf',
  contentType: 'application/pdf',
  contentHash,
});
world.rpc = ({ name, args }) => {
  if (name === 'consume_rate_limit')
    return { data: limiterAllows && args.p_action !== limitedAction, error: null };
  if (name === 'get_invoice_with_line_sources') {
    const own = args.p_organization_id === ORGANIZATION_A && args.p_invoice_id === invoiceId;
    return { data: own ? issued : null, error: null };
  }
  if (args.p_organization_id !== ORGANIZATION_A) return refused('not_authorized');
  if (name === 'request_document_delivery' || name === 'record_manual_delivery') {
    if (args.p_subject_id !== invoiceId || args.p_document_id !== originalId)
      return refused('document_not_found');
    const earlier = deliveries.find((delivery) => delivery.attemptKey === args.p_attempt_key);
    if (name === 'record_manual_delivery') return { data: earlier?.id ?? crypto.randomUUID(), error: null };
    if (earlier) return { data: payloadOf(earlier, false), error: null };
    const delivery: Delivery = {
      id: crypto.randomUUID(),
      attemptKey: String(args.p_attempt_key),
      state: 'sending',
      attempt: 1,
      failureCode: null,
      stored: {
        recipient: args.p_recipient_email,
        subject: args.p_email_subject,
        text: args.p_message_text,
        senderName: args.p_sender_name,
        fromHeader: args.p_from_header,
        replyTo: args.p_reply_to,
      },
    };
    deliveries.push(delivery);
    return { data: payloadOf(delivery, true), error: null };
  }
  const delivery = deliveries.find((candidate) => candidate.id === args.p_delivery_id);
  if (!delivery) return refused('delivery_not_found');
  if (name === 'retry_document_delivery') {
    if (delivery.state !== 'failed' || delivery.attempt !== args.p_expected_attempt) {
      return { data: payloadOf(delivery, false), error: null };
    }
    Object.assign(delivery, { state: 'sending', attempt: delivery.attempt + 1, failureCode: null });
    return { data: payloadOf(delivery, true), error: null };
  }
  assert.equal(name, 'settle_document_delivery');
  const settles = delivery.state === 'sending' && delivery.attempt === args.p_attempt;
  if (settles) {
    delivery.state = args.p_outcome === 'sent' ? 'sent' : 'failed';
    delivery.failureCode = typeof args.p_failure_code === 'string' ? args.p_failure_code : null;
  }
  return { data: settles, error: null };
};
// The table rows the server reads directly: a retry's recipient, a limited press's recorded result.
const syncTable = () => {
  world.tables.document_deliveries = deliveries.map((delivery) => ({
    id: delivery.id,
    organization_id: ORGANIZATION_A,
    attempt_key: delivery.attemptKey,
    created_by: CALLER_ID,
    state: delivery.state,
    failure_code: delivery.failureCode,
    channel: 'email',
    subject_kind: 'invoice',
    invoice_id: invoiceId,
    document_id: originalId,
    recipient_email: delivery.stored.recipient,
    email_subject: delivery.stored.subject,
    message_text: delivery.stored.text,
  }));
};

const mailsOf = (deliveryId: string) =>
  memoryOutbox.messages().filter((mail) => mail.idempotencyKey === `document-delivery/${deliveryId}`);
const send = (attemptKey: string, extra: Record<string, unknown> = {}) => {
  const input = { invoiceId, attemptKey, recipient, subject: mailSubject, text: mailText, ...extra };
  return sendInvoiceEmail(input);
};
const callsNamed = (name: string) => world.rpcCalls.filter((call) => call.name === name);

// A field worker reaches nothing.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['sendInvoiceEmail', () => send(crypto.randomUUID())],
    [
      'retryInvoiceDelivery',
      () => retryInvoiceDelivery({ deliveryId: crypto.randomUUID(), expectedAttempt: 1 }),
    ],
    [
      'markInvoiceSentManually',
      () => markInvoiceSentManually({ invoiceId, attemptKey: crypto.randomUUID(), note: '' }),
    ],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);

// Another organization's invoice reads as none: the one read, no write, no mail.
signInAs(world, 'buero');
await assertRefused(
  world,
  [
    ['sendInvoiceEmail foreign', () => send(crypto.randomUUID(), { invoiceId: foreignInvoiceId })],
    [
      'markInvoiceSentManually foreign',
      () =>
        markInvoiceSentManually({ invoiceId: foreignInvoiceId, attemptKey: crypto.randomUUID(), note: '' }),
    ],
  ],
  { success: false, error: 'invoice_not_found' },
  'one-call',
);
// Another organization's delivery is refused by the function under the caller's organization.
world.rpcCalls.length = 0;
assert.deepEqual(await retryInvoiceDelivery({ deliveryId: crypto.randomUUID(), expectedAttempt: 1 }), {
  success: false,
  error: 'delivery_not_found',
});
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id ?? null]),
  [
    ['consume_rate_limit', null],
    ['retry_document_delivery', ORGANIZATION_A],
  ],
);
assert.equal(memoryOutbox.messages().length, 0, 'a refused call sent a mail');

// The limit comes first: a limited send records nothing and sends nothing.
limiterAllows = false;
world.rpcCalls.length = 0;
assert.deepEqual(await send(crypto.randomUUID()), { success: false, error: 'rate_limited' });
assert.equal(callsNamed('request_document_delivery').length, 0, 'a limited send was recorded');
limiterAllows = true;

// The same press twice, as after a lost answer: one delivery, one mail, with
// the invoice's own original, whatever document the client named.
const pressKey = crypto.randomUUID();
world.rpcCalls.length = 0;
const first = await send(pressKey, { documentId: foreignDocumentId });
const again = await send(pressKey, { documentId: foreignDocumentId });
assert.deepEqual(first, { success: true, state: 'sent', failureCode: null });
assert.equal(again.success && again.state, 'sent');
const requests = callsNamed('request_document_delivery');
assert.equal(requests.length, 2);
for (const { args } of requests) {
  assert.equal(args.p_document_id, originalId, 'the attachment was not the invoice original');
  assert.equal(args.p_organization_id, ORGANIZATION_A);
  assert.equal(args.p_sender_name, 'Haustechnik Sonnenberg GmbH');
  assert.equal(args.p_reply_to, 'buero@sonnenberg.example');
}
const pressed = deliveries.find((delivery) => delivery.attemptKey === pressKey);
assert.ok(pressed);
const [mail, ...extra] = mailsOf(pressed.id);
assert.equal(extra.length, 0, 'a repeated press sent a second mail');
assert.ok(mail);
assert.equal(mail.to, recipient);
assert.equal(mail.from, '"Haustechnik Sonnenberg GmbH" <rechnung@werkflow.example>');
assert.equal(mail.replyTo, 'buero@sonnenberg.example');
assert.equal(mail.subject, mailSubject);
assert.equal(mail.text, mailText);
assert.deepEqual(
  mail.attachments?.map((attachment) => [
    attachment.filename,
    attachment.contentType,
    [...attachment.content],
  ]),
  [['Rechnung RE-2037-001.pdf', 'application/pdf', [...pdf]]],
);
assert.equal(callsNamed('settle_document_delivery').length, 1, 'the repeated press settled again');
// Pressed again once the limit is full: the recorded result, no new request.
syncTable();
limiterAllows = false;
world.rpcCalls.length = 0;
assert.deepEqual(await send(pressKey), { success: true, state: 'sent', failureCode: null });
assert.equal(callsNamed('request_document_delivery').length, 0, 'a limited press reached the request');
// The same key with another mail never answers the earlier mail's result: the limit's refusal stands.
for (const changed of [
  { recipient: 'andere@lindenhof.example' },
  { subject: 'Andere' },
  { text: 'Anders' },
]) {
  assert.deepEqual(await send(pressKey, changed), { success: false, error: 'rate_limited' });
}
assert.equal(callsNamed('request_document_delivery').length, 0, 'a limited press reached the request');
limiterAllows = true;

// The provider fails: the delivery is failed with its code; the retry sends it once, a second retry not at all.
const realFetch = globalThis.fetch;
Object.assign(process.env, { VERCEL_ENV: 'preview', RESEND_API_KEY: 're_test_synthetic' });
globalThis.fetch = Object.assign(async () => new Response('Service Unavailable', { status: 503 }), {
  preconnect: realFetch.preconnect,
});
const failedKey = crypto.randomUUID();
const failed = await send(failedKey);
assert.deepEqual(failed, { success: true, state: 'failed', failureCode: 'email_provider_503' });
// The same press again after a lost answer reports the recorded failure with its code, and sends nothing.
assert.deepEqual(await send(failedKey), {
  success: true,
  state: 'failed',
  failureCode: 'email_provider_503',
});
const failedDelivery = deliveries.at(-1);
assert.ok(failedDelivery && failedDelivery.state === 'failed');
assert.equal(mailsOf(failedDelivery.id).length, 0);
delete process.env.VERCEL_ENV;
globalThis.fetch = realFetch;
// A changed sending address between attempts leaves the retry's payload as it was, so its key still matches.
process.env.FROM_EMAIL = 'WerkFlow <neu@werkflow.example>';
syncTable();
// The organization's budget allows, the stored recipient's is full: no claim, no mail.
limitedAction = 'document_send_per_recipient';
world.rpcCalls.length = 0;
assert.deepEqual(await retryInvoiceDelivery({ deliveryId: failedDelivery.id, expectedAttempt: 1 }), {
  success: false,
  error: 'rate_limited',
});
assert.deepEqual(
  callsNamed('consume_rate_limit').map((call) => call.args.p_action),
  ['document_send_per_organization', 'document_send_per_recipient'],
);
assert.equal(callsNamed('retry_document_delivery').length, 0, 'a retry past its recipient limit was claimed');
assert.equal(mailsOf(failedDelivery.id).length, 0, 'a retry past its recipient limit sent a mail');
limitedAction = null;
world.rpcCalls.length = 0;
assert.deepEqual(await retryInvoiceDelivery({ deliveryId: failedDelivery.id, expectedAttempt: 1 }), {
  success: true,
  state: 'sent',
  failureCode: null,
});
assert.equal(callsNamed('retry_document_delivery')[0]?.args.p_expected_attempt, 1);
assert.equal(callsNamed('consume_rate_limit').length, 2, 'the retry did not count its recipient');
assert.ok(tableRows(world, 'document_deliveries').length > 0);
// The same press again, as after a lost answer: nothing is sent.
assert.deepEqual(await retryInvoiceDelivery({ deliveryId: failedDelivery.id, expectedAttempt: 1 }), {
  success: true,
  state: 'sent',
  failureCode: null,
});
assert.equal(mailsOf(failedDelivery.id).length, 1, 'the retry did not send exactly once');
assert.equal(
  mailsOf(failedDelivery.id)[0]?.from,
  '"Haustechnik Sonnenberg GmbH" <rechnung@werkflow.example>',
);
process.env.FROM_EMAIL = 'WerkFlow <rechnung@werkflow.example>';

// An original whose bytes changed since it was filed is never attached.
storedPdf = new TextEncoder().encode('%PDF-1.7 something else');
const changed = await send(crypto.randomUUID());
assert.deepEqual(changed, { success: true, state: 'failed', failureCode: 'attachment_changed' });
const changedDelivery = deliveries.at(-1);
assert.ok(changedDelivery);
assert.equal(mailsOf(changedDelivery.id).length, 0, 'a changed original was sent');
storedPdf = pdf;

// Manual sending names the invoice's own original too.
world.rpcCalls.length = 0;
assert.deepEqual(
  await markInvoiceSentManually({ invoiceId, attemptKey: crypto.randomUUID(), note: 'per Post am 20.11.' }),
  { success: true },
);
const [manual] = callsNamed('record_manual_delivery');
assert.equal(manual?.args.p_document_id, originalId);
assert.equal(manual?.args.p_note, 'per Post am 20.11.');

// Logs name failures by code only.
const text = logged.join('\n');
for (const leak of [
  recipient,
  'buero@sonnenberg',
  'Rechnung RE-2037-001',
  'Guten Tag',
  'Service Unavailable',
]) {
  assert.ok(!text.includes(leak), `a log carried ${leak}`);
}
