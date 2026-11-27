// The real Servicebericht delivery actions, E2c's sendDocument and the mail
// transport over the action world: a field worker reaches nothing; another
// organization's report or delivery is refused; the attachment is always the
// report's own filed PDF under the subject `service_report`, whatever the
// client sends; the same report sent twice puts one mail in the local outbox;
// a failed delivery is retried once; a manual send is recorded for the
// report; the „Versand“ read lists the report's sends and proposes the visit
// job's Ansprechpartner, and no address once the job's customer changed. The world stands in for the database functions, which
// supabase/tests/document_deliveries.sql proves.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mock } from 'bun:test';
import {
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';
import { companyProfileRow } from './company-profile-rows';
import { assertRefused } from './operations-boundary-refusals';

const reportId = '98300000-0000-4000-8000-000000000001';
const foreignReportId = '98300000-0000-4000-8000-000000000009';
const documentId = '98300000-0000-4000-8000-000000000101';
const foreignDocumentId = '98300000-0000-4000-8000-000000000109';
const dueWorkId = '98300000-0000-4000-8000-000000000201';
const jobId = '98300000-0000-4000-8000-000000000301';
const clientId = '98300000-0000-4000-8000-000000000401';
const contactId = '98300000-0000-4000-8000-000000000501';
const otherClientId = '98300000-0000-4000-8000-000000000409';
const planId = '98300000-0000-4000-8000-000000000701';
const reportPath = `${ORGANIZATION_A}/service-reports/${dueWorkId}/${reportId}.pdf`;
const pdf = new TextEncoder().encode('%PDF-1.7 Servicebericht A-2037-0042');
const contentHash = createHash('sha256').update(pdf).digest('hex');
const recipient = 'hausmeister@lindenhof.example';
const mailSubject = 'Servicebericht zur Wartung vom 12.11.2037 – Haustechnik Sonnenberg GmbH';
const mailText = 'Guten Tag,\n\nanbei der Servicebericht zur Wartung vom 12.11.2037.';

process.env.EMAIL_OTP_HASH_SECRET = 'fixture-only-delivery-secret';
process.env.FROM_EMAIL = 'WerkFlow <bericht@werkflow.example>';

const realStorage = await import('@/lib/storage/r2');
mock.module('@/lib/storage/r2', () => ({
  ...realStorage,
  readStorageObject: async ({ organizationId, path }: { organizationId: string; path: string }) => {
    assert.equal(organizationId, ORGANIZATION_A, 'the attachment was read outside the caller organization');
    if (path !== reportPath) throw new Error('storage_object_missing');
    return pdf;
  },
}));

const world = installActionWorld({
  company_document_profiles: [
    {
      ...companyProfileRow(ORGANIZATION_A, 'Haustechnik Sonnenberg GmbH', ''),
      email: 'buero@sonnenberg.example',
    },
  ],
  maintenance_service_reports: [
    {
      id: reportId,
      organization_id: ORGANIZATION_A,
      maintenance_due_work_id: dueWorkId,
      document_id: documentId,
      report_number: 1,
    },
    {
      id: foreignReportId,
      organization_id: ORGANIZATION_B,
      maintenance_due_work_id: '98300000-0000-4000-8000-000000000209',
      document_id: foreignDocumentId,
      report_number: 1,
    },
  ],
  maintenance_due_work: [
    {
      id: dueWorkId,
      organization_id: ORGANIZATION_A,
      completed_on: '2037-11-12',
      job_id: jobId,
      maintenance_plan_id: planId,
    },
  ],
  jobs: [
    {
      id: jobId,
      organization_id: ORGANIZATION_A,
      job_number: 'A-2037-0042',
      client_id: clientId,
      contact_id: contactId,
    },
  ],
  clients: [
    { id: clientId, organization_id: ORGANIZATION_A, email: 'verwaltung@lindenhof.example' },
    { id: otherClientId, organization_id: ORGANIZATION_A, email: 'einkauf@sonnenhof.example' },
  ],
  // The report's customer: its plan's (register_maintenance_service_report).
  maintenance_plans: [{ id: planId, organization_id: ORGANIZATION_A, client_id: clientId }],
  client_contacts: [
    {
      id: contactId,
      organization_id: ORGANIZATION_A,
      client_id: clientId,
      email: recipient,
      is_active: true,
      is_primary: false,
      site_id: null,
      created_at: '2037-01-01T00:00:00Z',
    },
  ],
});
const { memoryOutbox } = await import('@/lib/delivery/memory-outbox');
const { markServiceReportSentManually, retryServiceReportDelivery, sendServiceReportEmail } = await import(
  '@/lib/service-reports/delivery-actions'
);
const { getServiceReportDelivery } = await import('@/lib/service-reports/page-actions');

// The database functions: one row per attempt key, a claim per attempt, a settle per claim.
type Delivery = {
  id: string;
  organizationId: string;
  attemptKey: string;
  requestedAt: string;
  state: 'sending' | 'sent' | 'failed';
  attempt: number;
  failureCode: string | null;
  stored: Record<'recipient' | 'subject' | 'text' | 'senderName' | 'fromHeader' | 'replyTo', unknown>;
};
const deliveries: Delivery[] = [];
const refused = (message: string) => ({ data: null, error: { code: 'P0001', message } });
const payloadOf = (delivery: Delivery, claimed: boolean) => ({
  deliveryId: delivery.id,
  claimed,
  state: delivery.state,
  failureCode: delivery.failureCode,
  attempt: delivery.attempt,
  requestedAt: delivery.requestedAt,
  ...delivery.stored,
  storagePath: reportPath,
  fileName: 'Servicebericht A-2037-0042.pdf',
  contentType: 'application/pdf',
  contentHash,
});
world.rpc = ({ name, args }) => {
  if (name === 'consume_rate_limit') return { data: true, error: null };
  if (args.p_organization_id !== ORGANIZATION_A) return refused('not_authorized');
  if (name === 'list_document_deliveries') {
    assert.deepEqual([args.p_subject_kind, args.p_subject_id], ['service_report', reportId]);
    return { data: { total: 0, rows: [] }, error: null };
  }
  if (name === 'request_document_delivery' || name === 'record_manual_delivery') {
    if (args.p_subject_kind !== 'service_report' || args.p_subject_id !== reportId) {
      return refused('service_report_not_found');
    }
    if (args.p_document_id !== documentId) return refused('document_not_found');
    const earlier = deliveries.find((delivery) => delivery.attemptKey === args.p_attempt_key);
    if (name === 'record_manual_delivery') return { data: earlier?.id ?? crypto.randomUUID(), error: null };
    if (earlier) return { data: payloadOf(earlier, false), error: null };
    const delivery: Delivery = {
      id: crypto.randomUUID(),
      organizationId: ORGANIZATION_A,
      attemptKey: String(args.p_attempt_key),
      requestedAt: new Date().toISOString(),
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
  const delivery = deliveries.find(
    (candidate) => candidate.id === args.p_delivery_id && candidate.organizationId === args.p_organization_id,
  );
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
// A retry reads its stored recipient and subject kind from the table; one invoice delivery stands beside.
const invoiceDeliveryId = '98300000-0000-4000-8000-000000000601';
const syncTable = () => {
  world.tables.document_deliveries = [
    ...deliveries.map((delivery) => ({
      id: delivery.id,
      organization_id: delivery.organizationId,
      recipient_email: delivery.stored.recipient,
      subject_kind: 'service_report',
    })),
    {
      id: invoiceDeliveryId,
      organization_id: ORGANIZATION_A,
      recipient_email: 'buchhaltung@lindenhof.example',
      subject_kind: 'invoice',
    },
  ];
};

const mailsOf = (deliveryId: string) =>
  memoryOutbox.messages().filter((mail) => mail.idempotencyKey === `document-delivery/${deliveryId}`);
const send = (attemptKey: string, extra: Record<string, unknown> = {}) =>
  sendServiceReportEmail({ reportId, attemptKey, recipient, subject: mailSubject, text: mailText, ...extra });
const callsNamed = (name: string) => world.rpcCalls.filter((call) => call.name === name);

// A field worker reaches nothing.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['sendServiceReportEmail', () => send(crypto.randomUUID())],
    [
      'retryServiceReportDelivery',
      () => retryServiceReportDelivery({ deliveryId: crypto.randomUUID(), expectedAttempt: 1 }),
    ],
    [
      'markServiceReportSentManually',
      () => markServiceReportSentManually({ reportId, attemptKey: crypto.randomUUID(), note: '' }),
    ],
    ['getServiceReportDelivery', () => getServiceReportDelivery({ reportId })],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);

// Another organization's report reads as none: no function call, no mail.
signInAs(world, 'buero');
await assertRefused(
  world,
  [
    ['sendServiceReportEmail foreign', () => send(crypto.randomUUID(), { reportId: foreignReportId })],
    [
      'markServiceReportSentManually foreign',
      () =>
        markServiceReportSentManually({
          reportId: foreignReportId,
          attemptKey: crypto.randomUUID(),
          note: '',
        }),
    ],
    ['getServiceReportDelivery foreign', () => getServiceReportDelivery({ reportId: foreignReportId })],
  ],
  { success: false, error: 'service_report_not_found' },
  'reads',
);
// A delivery id that names none of the organization's is refused by the function under the caller's organization.
world.rpcCalls.length = 0;
assert.deepEqual(await retryServiceReportDelivery({ deliveryId: crypto.randomUUID(), expectedAttempt: 1 }), {
  success: false,
  error: 'delivery_not_found',
});
assert.deepEqual(
  callsNamed('retry_document_delivery').map((call) => call.args.p_organization_id),
  [ORGANIZATION_A],
);
assert.equal(memoryOutbox.messages().length, 0, 'a refused call sent a mail');

// „Versand“: the report's sends from E2c's reader, and the job's Ansprechpartner as recipient.
const read = await getServiceReportDelivery({ reportId });
assert.ok(read.success, JSON.stringify(read));
assert.deepEqual(read.delivery.list, { total: 0, entries: [] });
assert.equal(read.delivery.defaults?.recipient, recipient);
assert.equal(read.delivery.defaults?.subject, mailSubject);
assert.match(
  read.delivery.defaults?.text ?? '',
  /Servicebericht zur Wartung vom 12\.11\.2037 \(Auftrag A-2037-0042\)/,
);
// A job whose customer changed since the report proposes no address: the report belongs to its own customer.
const [visitJob] = tableRows(world, 'jobs');
assert.ok(visitJob);
visitJob.client_id = otherClientId;
const moved = await getServiceReportDelivery({ reportId });
assert.ok(moved.success, JSON.stringify(moved));
assert.equal(moved.delivery.defaults?.recipient, '');
visitJob.client_id = clientId;

// The same report sent twice, as after a lost answer: one delivery, one mail,
// with the report's own PDF, whatever document the client named.
const pressKey = crypto.randomUUID();
world.rpcCalls.length = 0;
assert.deepEqual(await send(pressKey, { documentId: foreignDocumentId }), {
  success: true,
  state: 'sent',
  failureCode: null,
});
assert.deepEqual(await send(pressKey, { documentId: foreignDocumentId }), {
  success: true,
  state: 'sent',
  failureCode: null,
});
const requests = callsNamed('request_document_delivery');
assert.equal(requests.length, 2);
for (const { args } of requests) {
  assert.deepEqual(
    [args.p_organization_id, args.p_subject_kind, args.p_subject_id, args.p_document_id],
    [ORGANIZATION_A, 'service_report', reportId, documentId],
    'the attachment was not the report’s own filed PDF',
  );
}
const pressed = deliveries.find((delivery) => delivery.attemptKey === pressKey);
assert.ok(pressed);
const [mail, ...extra] = mailsOf(pressed.id);
assert.equal(extra.length, 0, 'the same report sent twice put a second mail in the outbox');
assert.ok(mail);
assert.equal(mail.to, recipient);
assert.equal(mail.from, '"Haustechnik Sonnenberg GmbH" <bericht@werkflow.example>');
assert.equal(mail.replyTo, 'buero@sonnenberg.example');
assert.deepEqual(
  mail.attachments?.map((attachment) => [attachment.filename, [...attachment.content]]),
  [['Servicebericht A-2037-0042.pdf', [...pdf]]],
);
assert.equal(memoryOutbox.messages().length, 1);

// An invoice's delivery is no report's: refused before any claim.
syncTable();
world.rpcCalls.length = 0;
assert.deepEqual(await retryServiceReportDelivery({ deliveryId: invoiceDeliveryId, expectedAttempt: 1 }), {
  success: false,
  error: 'delivery_not_found',
});
assert.equal(callsNamed('retry_document_delivery').length, 0, 'an invoice delivery was claimed as a report');

// A failed delivery is retried once; a second press of the same retry sends nothing.
const failed: Delivery = {
  ...pressed,
  id: crypto.randomUUID(),
  attemptKey: crypto.randomUUID(),
  state: 'failed',
  failureCode: 'email_provider_503',
};
deliveries.push(failed);
syncTable();
for (let press = 0; press < 2; press += 1) {
  assert.deepEqual(await retryServiceReportDelivery({ deliveryId: failed.id, expectedAttempt: 1 }), {
    success: true,
    state: 'sent',
    failureCode: null,
    outcomeUnknown: false,
  });
}
assert.equal(mailsOf(failed.id).length, 1, 'the retry did not send exactly once');

// A manual send is recorded for the report's own document and sends nothing.
world.rpcCalls.length = 0;
const before = memoryOutbox.messages().length;
assert.deepEqual(
  await markServiceReportSentManually({ reportId, attemptKey: crypto.randomUUID(), note: 'per Post' }),
  { success: true },
);
assert.deepEqual(
  callsNamed('record_manual_delivery').map(({ args }) => [
    args.p_subject_kind,
    args.p_subject_id,
    args.p_document_id,
  ]),
  [['service_report', reportId, documentId]],
);
assert.equal(memoryOutbox.messages().length, before, 'a manual send sent a mail');
