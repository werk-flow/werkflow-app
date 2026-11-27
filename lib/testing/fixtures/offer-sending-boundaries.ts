// The real offer preview route, „Als gesendet festhalten“ and the document
// signed-URL read over the action world: a field worker and a signed-out
// caller get no PDF and record nothing; another organization's offer is
// refused by the one read; the stored revision's PDF says what the preview
// said; the one send call carries the caller's own organization and actor
// and the stored PDF; a refused or replayed send discards the stored bytes;
// and a field worker assigned to a job of the offer's customer gets no signed
// URL for the sent PDF. supabase/tests/offer_sending.sql proves the function.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mock, setSystemTime } from 'bun:test';
import { extractText, getDocumentProxy } from 'unpdf';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { companyProfileRow } from './company-profile-rows';
import { assertRefused } from './operations-boundary-refusals';

const offerId = '95100000-0000-4000-8000-000000000001';
const foreignOfferId = '95100000-0000-4000-8000-000000000009';
const clientId = '94100000-0000-4000-8000-000000000001';
const recipientId = '94100000-0000-4000-8000-000000000002';
const jobId = '93100000-0000-4000-8000-000000000001';
const sentDocumentId = '92100000-0000-4000-8000-000000000001';
const today = '2037-11-20';
setSystemTime(new Date(`${today}T10:00:00.000Z`));

const stored: Array<{ path: string; body: Uint8Array }> = [];
const discarded: string[] = [];
const signed: string[] = [];
const realStorage = await import('@/lib/storage/r2');
mock.module('@/lib/storage/r2', () => ({
  ...realStorage,
  putStorageObject: async ({ path, body }: { path: string; body: Uint8Array }) => {
    stored.push({ path, body: new Uint8Array(body) });
    return { created: true };
  },
  discardStorageObjects: async ({ paths }: { paths: readonly string[] }) => {
    discarded.push(...paths);
  },
  createSignedDownloadUrl: async ({ path }: { path: string }) => {
    signed.push(path);
    return `https://storage.example.test/${path}`;
  },
}));

const sentDocument = {
  id: sentDocumentId,
  organization_id: ORGANIZATION_A,
  category: 'offer',
  created_at: `${today}T10:00:00.000Z`,
  updated_at: `${today}T10:00:00.000Z`,
  current_version_number: 1,
  display_name: 'Angebot ANG-2037-001 Revision 1.pdf',
  original_file_name: 'Angebot ANG-2037-001 Revision 1.pdf',
  size_bytes: 2048,
  storage_bucket: 'organization-documents',
  storage_path: `${ORGANIZATION_A}/${sentDocumentId}/Angebot-ANG-2037-001-Revision-1.pdf`,
  uploaded_by: CALLER_ID,
  copied_from_document_id: null,
  delete_reason: null,
  deleted_at: null,
  deleted_by: null,
  folder_id: null,
  metadata: {},
  mime_type: 'application/pdf',
};
const link = (target: Record<string, string>) => ({
  id: crypto.randomUUID(),
  organization_id: ORGANIZATION_A,
  document_id: sentDocumentId,
  job_id: null,
  project_id: null,
  client_id: null,
  employee_id: null,
  request_id: null,
  equipment_id: null,
  service_case_id: null,
  maintenance_coverage_id: null,
  offer_id: null,
  created_at: `${today}T10:00:00.000Z`,
  created_by: CALLER_ID,
  ...target,
});

const world = installActionWorld({
  company_document_profiles: [
    companyProfileRow(ORGANIZATION_A, 'Haustechnik Sonnenberg GmbH', 'DE00 1111 1111 1111 1111 11'),
    companyProfileRow(ORGANIZATION_B, 'Fremde Haustechnik GmbH', 'DE00 2222 2222 2222 2222 22'),
  ],
  // The sent PDF, linked to its offer and its customer only, as send_offer links it.
  documents: [sentDocument],
  ordinary_documents: [sentDocument],
  personnel_documents: [],
  document_links: [link({ offer_id: offerId }), link({ client_id: clientId })],
  // The caller works on a job of the same customer. The in-memory database has
  // no joins: an embedded filter column is stored on the row itself.
  jobs: [
    {
      id: jobId,
      organization_id: ORGANIZATION_A,
      client_id: clientId,
      project_id: null,
      title: 'Heizung tauschen',
      job_number: 'A-001',
      'job_assignments.user_id': CALLER_ID,
    },
  ],
  job_assignments: [
    {
      id: crypto.randomUUID(),
      organization_id: ORGANIZATION_A,
      job_id: jobId,
      user_id: CALLER_ID,
      'jobs.organization_id': ORGANIZATION_A,
      'jobs.project_id': null,
    },
  ],
  profiles: [{ id: CALLER_ID, first_name: 'Max', last_name: 'Muster', email: 'caller@example.test' }],
});

const draft = {
  id: offerId,
  offerNumber: 'ANG-2037-001',
  title: 'Heizungstausch',
  status: 'entwurf',
  version: 3,
  contentVersion: 4,
  validUntil: '2037-12-20',
  openingText: 'Sehr geehrte Damen und Herren,',
  closingText: 'Mit freundlichen Grüßen',
  client: { id: clientId, name: 'WEG Lindenstraße 5' },
  site: null,
  contact: null,
  recipient: {
    id: recipientId,
    name: 'Hausverwaltung Lindenhof GmbH',
    address: 'Hofweg 1, 10117 Berlin',
    isDefault: true,
  },
  owner: null,
  work: null,
  sections: [
    {
      title: 'Heizung',
      positions: [
        {
          kind: 'free',
          name: 'Monteurstunde',
          description: '',
          quantity: '2.000',
          unit: 'hour',
          unitPriceCents: 7200,
          priceQuantity: 1,
          taxRateBasisPoints: 1900,
          source: null,
        },
        {
          kind: 'text',
          name: 'Hinweis zur Ausführung',
          description: 'Nach Absprache mit der Hausverwaltung.',
        },
        // A Position from a Leistung, as get_offer answers it: a free Position with its source and no cost.
        {
          kind: 'free',
          name: 'Wartung Gastherme',
          description: '',
          quantity: '1.000',
          unit: 'flat_rate',
          unitPriceCents: 12900,
          priceQuantity: 1,
          taxRateBasisPoints: 1900,
          source: {
            kind: 'leistung',
            id: '97100000-0000-4000-8000-000000000001',
            number: 'L-001',
            name: 'Wartung Gastherme',
            archived: false,
          },
        },
      ],
    },
  ],
};

/** The database: the caller's own draft offer of organization A, the answer of send_offer, nothing else. */
let sendAnswer: (args: Record<string, unknown>) => {
  data: unknown;
  error: { code: string; message: string } | null;
};
/** Another tab's send that commits right after this request's first read of the draft. */
let sentElsewhere = false;
let offerReads = 0;
world.rpc = ({ name, args }) => {
  if (args.p_organization_id !== ORGANIZATION_A) return { data: null, error: null };
  if (name === 'get_offer') {
    offerReads += 1;
    const status = sentElsewhere && offerReads > 1 ? 'gesendet' : 'entwurf';
    return { data: args.p_offer_id === offerId ? { ...draft, status } : null, error: null };
  }
  if (name === 'list_offer_revisions') {
    const first = {
      revision: 1,
      sentOn: today,
      channel: 'post',
      validUntil: '2037-12-20',
      grossCents: 17136,
    };
    const revision = { ...first, recipientName: 'Hausverwaltung Lindenhof GmbH', documentId: sentDocumentId };
    return { data: sentElsewhere ? [{ ...revision, sentBy: null }] : [], error: null };
  }
  if (name === 'send_offer') return sendAnswer(args);
  return { data: null, error: { code: 'P0001', message: `${name} is outside this fixture` } };
};

const { sendOffer } = await import('@/lib/offers/send-actions');
const preview = await import('@/app/api/angebote/vorschau/route');
const { getDocumentSignedUrl } = await import('@/lib/documents/actions');
const GET = (id: string) => preview.GET(new Request(`http://localhost/api/angebote/vorschau?angebot=${id}`));
/** The SHA-256 of the preview the office saw; a well-formed stand-in until the preview below. */
let previewHash = 'f'.repeat(64);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const send = (overrides: Record<string, unknown> = {}) =>
  sendOffer({
    offerId,
    expectedVersion: 3,
    expectedContentVersion: 4,
    channel: 'post',
    previewHash,
    attemptKey: '96100000-0000-4000-8000-000000000001',
    ...overrides,
  });

async function textOf(bytes: Uint8Array): Promise<string> {
  return (await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true })).text;
}

async function expectNoPdf(id: string, status: number): Promise<void> {
  const response = await GET(id);
  assert.equal(response.status, status);
  assert.ok(!(await response.text()).startsWith('%PDF'), 'a refused caller gets no PDF bytes');
}

// A signed-out caller and a field worker get no preview and record nothing.
world.callerId = null;
await expectNoPdf(offerId, 401);
signInAs(world, 'employee');
await expectNoPdf(offerId, 403);
await assertRefused(
  world,
  [['sendOffer as employee', () => send()]],
  { success: false, error: 'not_authorized' },
  'none',
);
assert.equal(stored.length, 0);

// Another organization's offer is refused by the one read, before any rendering or storage.
for (const role of ['admin', 'buero'] as const) {
  signInAs(world, role);
  await expectNoPdf(foreignOfferId, 404);
  await assertRefused(
    world,
    [['sendOffer foreign offer', () => send({ offerId: foreignOfferId })]],
    { success: false, error: 'offer_not_found' },
    'one-call',
  );
  assert.equal(world.rpcCalls[0]?.name, 'get_offer');
  // A manager of organization B reads in B, even through a cookie that names A.
  signInAs(world, role, ORGANIZATION_B);
  world.activeOrganizationCookie = ORGANIZATION_A;
  await expectNoPdf(offerId, 404);
}
assert.equal(stored.length, 0);

// Büro previews the draft, then records it as sent: the stored PDF says what the preview said.
signInAs(world, 'buero');
const shown = await GET(offerId);
assert.equal(shown.status, 200);
assert.equal(shown.headers.get('Content-Type'), 'application/pdf');
assert.equal(shown.headers.get('Cache-Control'), 'private, no-store');
const previewBytes = new Uint8Array(await shown.arrayBuffer());
const previewText = await textOf(previewBytes);
assert.ok(previewText.includes('ANG-2037-001, Revision 1'), previewText);
// Addressed to the Rechnungsempfänger, with the customer beside it.
assert.ok(
  previewText.includes('Hausverwaltung Lindenhof GmbH') && previewText.includes('WEG Lindenstraße 5'),
);
assert.ok(previewText.includes('Hinweis zur Ausführung'), previewText);
// The Leistung's Position prints with its number and amount like the one typed by hand.
assert.ok(/1\.2\s*Wartung Gastherme/.test(previewText) && previewText.includes('129,00'), previewText);
assert.ok(
  previewText.includes('Haustechnik Sonnenberg GmbH') && !previewText.includes('Fremde'),
  previewText,
);
assert.equal(stored.length, 0, 'the preview stores nothing');

// A send that names another preview, such as one from before a change of the company profile, is refused
// before anything is stored.
assert.deepEqual(await send(), { success: false, error: 'preview_outdated' });
assert.equal(stored.length, 0);
previewHash = sha256(previewBytes);

sendAnswer = (args) => ({
  data: { revision: 1, documentId: args.p_document_id, replay: false },
  error: null,
});
world.rpcCalls.length = 0;
const sent = await send();
assert.ok(sent.success, JSON.stringify(sent));
assert.equal(stored.length, 1);
const [first] = stored;
assert.ok(first);
assert.equal(sha256(first.body), previewHash, 'the stored revision differs from its preview');
assert.equal(await textOf(first.body), previewText);
const sendCall = world.rpcCalls.find((call) => call.name === 'send_offer');
assert.equal(sendCall?.args.p_organization_id, ORGANIZATION_A);
assert.equal(sendCall?.args.p_actor_id, CALLER_ID);
assert.equal(sendCall?.args.p_channel, 'post');
assert.equal(sendCall?.args.p_sent_on, today);
assert.equal(sendCall?.args.p_recipient_name, 'Hausverwaltung Lindenhof GmbH');
assert.equal(sendCall?.args.p_recipient_address, 'Hofweg 1, 10117 Berlin');
// The snapshot keeps what the PDF printed beyond the revision's columns.
const snapshot = JSON.stringify(sendCall?.args.p_snapshot);
for (const printed of [
  '"clientName":"WEG Lindenstraße 5"',
  '"openingText":"Sehr geehrte Damen und Herren,"',
  '"closingText":"Mit freundlichen Grüßen"',
  '"companyName":"Haustechnik Sonnenberg GmbH"',
]) {
  assert.ok(snapshot.includes(printed), `${printed} missing from ${snapshot}`);
}
// The document path reads the offer without its costs: get_offer_with_costs is the office editor's read.
assert.deepEqual(
  [...new Set(world.rpcCalls.map((call) => call.name))].filter((name) => name.startsWith('get_offer')),
  ['get_offer'],
);
// The snapshot the send passes carries no cost.
assert.ok(!/cost/i.test(snapshot), snapshot);
assert.equal(sendCall?.args.p_storage_path, first.path);
assert.equal(sendCall?.args.p_document_id, sent.documentId);
assert.ok(String(first.path).startsWith(`${ORGANIZATION_A}/${sent.documentId}/`));
assert.equal(discarded.length, 0);

// A repeated press after a lost answer: the function answers the first revision, so the new bytes go.
sendAnswer = () => ({ data: { revision: 1, documentId: sentDocumentId, replay: true }, error: null });
assert.deepEqual(await send(), { success: true, offerId, revision: 1, documentId: sentDocumentId });
assert.deepEqual(discarded, [stored[1]?.path]);

// A refusal leaves nothing behind, stored bytes included.
sendAnswer = () => ({ data: null, error: { code: 'P0001', message: 'offer_expired' } });
assert.deepEqual(await send(), { success: false, error: 'offer_expired' });
assert.deepEqual(discarded.slice(1), [stored[2]?.path]);

// Another tab's send of the same draft commits between this request's reads: this one renders the
// next revision, which differs from its preview, and still answers the first revision, storing nothing.
sentElsewhere = true;
offerReads = 0;
sendAnswer = () => ({ data: { revision: 1, documentId: sentDocumentId, replay: true }, error: null });
world.rpcCalls.length = 0;
assert.deepEqual(await send(), { success: true, offerId, revision: 1, documentId: sentDocumentId });
assert.equal(world.rpcCalls.find((call) => call.name === 'send_offer')?.args.p_document_id, undefined);
assert.equal(stored.length, 3);
sentElsewhere = false;

// A draft another session saved meanwhile is refused by the one call, before anything is rendered or stored.
sendAnswer = () => ({ data: null, error: { code: 'P0001', message: 'offer_changed' } });
world.rpcCalls.length = 0;
assert.deepEqual(await send({ expectedContentVersion: 3 }), { success: false, error: 'offer_changed' });
assert.equal(stored.length, 3);
assert.equal(world.rpcCalls.find((call) => call.name === 'send_offer')?.args.p_document_id, undefined);

// A press repeated after its send committed and another tab opened revision 2 as a draft: the draft is
// at newer versions, and the one call still answers the recorded revision 1, storing nothing.
sendAnswer = () => ({ data: { revision: 1, documentId: sentDocumentId, replay: true }, error: null });
assert.deepEqual(await send({ expectedVersion: 2, expectedContentVersion: 3 }), {
  success: true,
  offerId,
  revision: 1,
  documentId: sentDocumentId,
});
assert.equal(stored.length, 3);

// The field worker on a job of the same customer gets no signed URL for the sent PDF;
// the office does.
signInAs(world, 'employee');
assert.deepEqual(await getDocumentSignedUrl(sentDocumentId), { success: false, error: 'not_authorized' });
assert.equal(signed.length, 0, 'a field worker received a signed URL for an offer document');
signInAs(world, 'buero');
assert.equal((await getDocumentSignedUrl(sentDocumentId)).success, true);
assert.equal(signed.length, 1);
