// The real offer revision delivery actions, E2c's sendDocument and the mail
// transport over the action world: a field worker reaches nothing; another
// organization's offer or delivery is refused; the attachment is always the
// named revision's own filed PDF under the subject `offer_revision`, whatever
// the client sends; one revision sent twice puts one mail in the local
// outbox; a later revision is a new delivery with its own PDF, and the
// replaced one is no longer sent; an invoice's delivery is no offer's; a
// failed delivery is retried once; the „Versand“ read lists the revision's
// sends and proposes the offer's Ansprechpartner at the Rechnungsempfänger.
// The world stands in for the database functions, which
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

const offerId = '98400000-0000-4000-8000-000000000001';
const foreignOfferId = '98400000-0000-4000-8000-000000000009';
const firstRevisionId = '98400000-0000-4000-8000-000000000011';
const secondRevisionId = '98400000-0000-4000-8000-000000000012';
const foreignRevisionId = '98400000-0000-4000-8000-000000000019';
const firstDocumentId = '98400000-0000-4000-8000-000000000101';
const secondDocumentId = '98400000-0000-4000-8000-000000000102';
const foreignDocumentId = '98400000-0000-4000-8000-000000000109';
const clientId = '98400000-0000-4000-8000-000000000401';
const recipientClientId = '98400000-0000-4000-8000-000000000402';
const contactId = '98400000-0000-4000-8000-000000000501';
const recipient = 'einkauf@lindenhof.example';
const mailSubject = 'Angebot ANG-2037-0007 – Haustechnik Sonnenberg GmbH';
const mailText = 'Guten Tag,\n\nanbei unser Angebot ANG-2037-0007.';

const filed = new Map(
  [firstDocumentId, secondDocumentId].map((documentId, index) => {
    const bytes = new TextEncoder().encode(`%PDF-1.7 Angebot ANG-2037-0007 Revision ${index + 1}`);
    return [
      documentId,
      {
        path: `${ORGANIZATION_A}/${documentId}/Angebot ANG-2037-0007.pdf`,
        bytes,
        hash: createHash('sha256').update(bytes).digest('hex'),
      },
    ];
  }),
);
const filedOf = (documentId: string) => {
  const file = filed.get(documentId);
  assert.ok(file, `no filed PDF ${documentId}`);
  return file;
};

process.env.EMAIL_OTP_HASH_SECRET = 'fixture-only-delivery-secret';
process.env.FROM_EMAIL = 'WerkFlow <angebot@werkflow.example>';

const realStorage = await import('@/lib/storage/r2');
mock.module('@/lib/storage/r2', () => ({
  ...realStorage,
  readStorageObject: async ({ organizationId, path }: { organizationId: string; path: string }) => {
    assert.equal(organizationId, ORGANIZATION_A, 'the attachment was read outside the caller organization');
    const file = [...filed.values()].find((candidate) => candidate.path === path);
    if (!file) throw new Error('storage_object_missing');
    return file.bytes;
  },
}));

const revisionRow = (id: string, revision: number, documentId: string) => ({
  id,
  organization_id: ORGANIZATION_A,
  offer_id: offerId,
  revision,
  document_id: documentId,
  offer_number: 'ANG-2037-0007',
  title: 'Heizungstausch',
  valid_until: '2037-12-31',
  gross_cents: 22_491,
  recipient_client_id: recipientClientId,
});

// Revision 1 only: revision 2 is sent later in the run.
const world = installActionWorld({
  company_document_profiles: [
    {
      ...companyProfileRow(ORGANIZATION_A, 'Haustechnik Sonnenberg GmbH', ''),
      email: 'buero@sonnenberg.example',
    },
  ],
  offer_revisions: [
    revisionRow(firstRevisionId, 1, firstDocumentId),
    {
      ...revisionRow(foreignRevisionId, 1, foreignDocumentId),
      organization_id: ORGANIZATION_B,
      offer_id: foreignOfferId,
    },
  ],
  offers: [
    { id: offerId, organization_id: ORGANIZATION_A, client_id: clientId, contact_id: contactId },
    { id: foreignOfferId, organization_id: ORGANIZATION_B, client_id: clientId, contact_id: null },
  ],
  clients: [
    { id: clientId, organization_id: ORGANIZATION_A, email: 'auftrag@sonnenhof.example' },
    { id: recipientClientId, organization_id: ORGANIZATION_A, email: 'verwaltung@lindenhof.example' },
  ],
  // The offer's Ansprechpartner works at the Rechnungsempfänger.
  client_contacts: [
    {
      id: contactId,
      organization_id: ORGANIZATION_A,
      client_id: recipientClientId,
      email: recipient,
      is_active: true,
      is_primary: false,
      site_id: null,
      created_at: '2037-01-01T00:00:00Z',
    },
  ],
});
const { memoryOutbox } = await import('@/lib/delivery/memory-outbox');
const { retryOfferRevisionDelivery, sendOfferRevisionEmail } = await import('@/lib/offers/delivery-actions');
const { getOfferRevisionDelivery } = await import('@/lib/offers/delivery-read');
const { sendDocumentEmailSchema } = await import('@/lib/delivery/delivery-types');

// The database functions: one row per attempt key, a claim per attempt, a settle per claim.
type Delivery = {
  id: string;
  organizationId: string;
  attemptKey: string;
  revisionId: string;
  documentId: string;
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
  storagePath: filedOf(delivery.documentId).path,
  fileName: 'Angebot ANG-2037-0007.pdf',
  contentType: 'application/pdf',
  contentHash: filedOf(delivery.documentId).hash,
});
world.rpc = ({ name, args }) => {
  if (name === 'consume_rate_limit') return { data: true, error: null };
  if (args.p_organization_id !== ORGANIZATION_A) return refused('not_authorized');
  if (name === 'list_document_deliveries') {
    assert.deepEqual([args.p_subject_kind, args.p_subject_id], ['offer_revision', firstRevisionId]);
    return { data: { total: 0, rows: [] }, error: null };
  }
  if (name === 'request_document_delivery') {
    const revision = tableRows(world, 'offer_revisions').find(
      (row) => row.id === args.p_subject_id && row.organization_id === ORGANIZATION_A,
    );
    if (args.p_subject_kind !== 'offer_revision' || !revision) return refused('offer_revision_not_found');
    if (args.p_document_id !== revision.document_id) return refused('document_not_found');
    const earlier = deliveries.find((delivery) => delivery.attemptKey === args.p_attempt_key);
    if (earlier) return { data: payloadOf(earlier, false), error: null };
    const delivery: Delivery = {
      id: crypto.randomUUID(),
      organizationId: ORGANIZATION_A,
      attemptKey: String(args.p_attempt_key),
      revisionId: String(args.p_subject_id),
      documentId: String(args.p_document_id),
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
const invoiceDeliveryId = '98400000-0000-4000-8000-000000000601';
const syncTable = () => {
  world.tables.document_deliveries = [
    ...deliveries.map((delivery) => ({
      id: delivery.id,
      organization_id: delivery.organizationId,
      recipient_email: delivery.stored.recipient,
      subject_kind: 'offer_revision',
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
const send = (revision: number, attemptKey: string, extra: Record<string, unknown> = {}) =>
  sendOfferRevisionEmail({
    offerId,
    revision,
    attemptKey,
    recipient,
    subject: mailSubject,
    text: mailText,
    ...extra,
  });
const callsNamed = (name: string) => world.rpcCalls.filter((call) => call.name === name);
const attachmentsOf = (
  mail: { attachments?: readonly { filename: string; content: Uint8Array }[] | undefined } | undefined,
) => mail?.attachments?.map((attachment) => [attachment.filename, [...attachment.content]]);

// A field worker reaches nothing.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['sendOfferRevisionEmail', () => send(1, crypto.randomUUID())],
    [
      'retryOfferRevisionDelivery',
      () => retryOfferRevisionDelivery({ deliveryId: crypto.randomUUID(), expectedAttempt: 1 }),
    ],
    ['getOfferRevisionDelivery', () => getOfferRevisionDelivery({ offerId, revision: 1 })],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);

// Another organization's offer reads as none: no function call, no mail.
signInAs(world, 'buero');
await assertRefused(
  world,
  [
    ['sendOfferRevisionEmail foreign', () => send(1, crypto.randomUUID(), { offerId: foreignOfferId })],
    [
      'getOfferRevisionDelivery foreign',
      () => getOfferRevisionDelivery({ offerId: foreignOfferId, revision: 1 }),
    ],
    ['sendOfferRevisionEmail unsent revision', () => send(2, crypto.randomUUID())],
  ],
  { success: false, error: 'offer_revision_not_found' },
  'reads',
);
// A delivery id that names none of the organization's is refused by the function under the caller's organization.
world.rpcCalls.length = 0;
assert.deepEqual(await retryOfferRevisionDelivery({ deliveryId: crypto.randomUUID(), expectedAttempt: 1 }), {
  success: false,
  error: 'delivery_not_found',
});
assert.deepEqual(
  callsNamed('retry_document_delivery').map((call) => call.args.p_organization_id),
  [ORGANIZATION_A],
);
assert.equal(memoryOutbox.messages().length, 0, 'a refused call sent a mail');

// „Versand“: the revision's sends from E2c's reader, and the Ansprechpartner at the Rechnungsempfänger.
const read = await getOfferRevisionDelivery({ offerId, revision: 1 });
assert.ok(read.success, JSON.stringify(read));
assert.deepEqual(read.delivery.list, { total: 0, entries: [] });
assert.equal(read.delivery.replacedBy, null);
assert.equal(read.delivery.defaults?.recipient, recipient);
assert.equal(read.delivery.defaults?.subject, mailSubject);
assert.match(
  read.delivery.defaults?.text ?? '',
  /Angebot ANG-2037-0007 „Heizungstausch“ über 224,91 €, gültig bis 31\.12\.2037\./,
);

// A company name at its full length still proposes a subject the send takes, with the number whole.
const [profile] = tableRows(world, 'company_document_profiles');
assert.ok(profile);
// A character outside the basic plane straddles the cut: it is left out whole, never split.
profile.company_name = `${'H'.repeat(175)}🔥${'H'.repeat(23)}`;
const long = await getOfferRevisionDelivery({ offerId, revision: 1 });
assert.ok(long.success && long.delivery.defaults, JSON.stringify(long));
assert.ok(long.delivery.defaults.subject.startsWith('Angebot ANG-2037-0007 – '));
assert.ok(long.delivery.defaults.subject.isWellFormed(), 'the subject was cut inside a character');
assert.ok(
  sendDocumentEmailSchema.safeParse({ attemptKey: crypto.randomUUID(), ...long.delivery.defaults }).success,
  'the proposed mail is refused by the send',
);
profile.company_name = 'Haustechnik Sonnenberg GmbH';

// One revision sent twice, as after a lost answer: one delivery, one mail,
// with that revision's own PDF, whatever document the client named.
const firstKey = crypto.randomUUID();
world.rpcCalls.length = 0;
for (let press = 0; press < 2; press += 1) {
  assert.deepEqual(await send(1, firstKey, { documentId: foreignDocumentId }), {
    success: true,
    state: 'sent',
    failureCode: null,
  });
}
const requests = callsNamed('request_document_delivery');
assert.equal(requests.length, 2);
for (const { args } of requests) {
  assert.deepEqual(
    [args.p_organization_id, args.p_subject_kind, args.p_subject_id, args.p_document_id],
    [ORGANIZATION_A, 'offer_revision', firstRevisionId, firstDocumentId],
    'the attachment was not the revision’s own filed PDF',
  );
}
const first = deliveries.find((delivery) => delivery.attemptKey === firstKey);
assert.ok(first);
const [mail, ...extra] = mailsOf(first.id);
assert.equal(extra.length, 0, 'one revision sent twice put a second mail in the outbox');
assert.equal(mail?.to, recipient);
assert.equal(mail?.from, '"Haustechnik Sonnenberg GmbH" <angebot@werkflow.example>');
assert.equal(mail?.replyTo, 'buero@sonnenberg.example');
assert.deepEqual(attachmentsOf(mail), [['Angebot ANG-2037-0007.pdf', [...filedOf(firstDocumentId).bytes]]]);
assert.equal(memoryOutbox.messages().length, 1);

// Revision 2 is sent: it is a new delivery with its own PDF, and revision 1 is no longer sent.
tableRows(world, 'offer_revisions').push(revisionRow(secondRevisionId, 2, secondDocumentId));
const secondKey = crypto.randomUUID();
assert.deepEqual(await send(2, secondKey), { success: true, state: 'sent', failureCode: null });
const second = deliveries.find((delivery) => delivery.attemptKey === secondKey);
assert.ok(second);
assert.notEqual(second.id, first.id, 'a later revision reused the earlier delivery');
assert.deepEqual([second.revisionId, second.documentId], [secondRevisionId, secondDocumentId]);
assert.deepEqual(attachmentsOf(mailsOf(second.id)[0]), [
  ['Angebot ANG-2037-0007.pdf', [...filedOf(secondDocumentId).bytes]],
]);
await assertRefused(
  world,
  [['sendOfferRevisionEmail replaced revision', () => send(1, crypto.randomUUID())]],
  { success: false, error: 'offer_revision_superseded' },
  'reads',
);
assert.equal(memoryOutbox.messages().length, 2);
// Its „Versand“ read names the revision that replaced it, so a stale page's dialog turns read-only.
const replacedRead = await getOfferRevisionDelivery({ offerId, revision: 1 });
assert.ok(replacedRead.success, JSON.stringify(replacedRead));
assert.equal(replacedRead.delivery.replacedBy, 2);

// An invoice's delivery is no offer's: refused before any claim.
syncTable();
world.rpcCalls.length = 0;
assert.deepEqual(await retryOfferRevisionDelivery({ deliveryId: invoiceDeliveryId, expectedAttempt: 1 }), {
  success: false,
  error: 'delivery_not_found',
});
assert.equal(callsNamed('retry_document_delivery').length, 0, 'an invoice delivery was claimed as an offer');

// A failed delivery is retried once; a second press of the same retry sends nothing.
const failed: Delivery = {
  ...second,
  id: crypto.randomUUID(),
  attemptKey: crypto.randomUUID(),
  state: 'failed',
  failureCode: 'email_provider_503',
};
deliveries.push(failed);
syncTable();
for (let press = 0; press < 2; press += 1) {
  assert.deepEqual(await retryOfferRevisionDelivery({ deliveryId: failed.id, expectedAttempt: 1 }), {
    success: true,
    state: 'sent',
    failureCode: null,
  });
}
assert.equal(mailsOf(failed.id).length, 1, 'the retry did not send exactly once');
