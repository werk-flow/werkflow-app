// The real issue, original, settings and preview code over the action world:
// a field worker reaches nothing; another organization's invoice is refused
// by the one read; a draft the EN 16931 rules refuse is never issued and the
// office reads what to fix; a checked draft is issued under the caller's own
// organization with the snapshot it was checked with, and its original is
// rendered, stored, registered and filed, with the same bytes on a retry.
// supabase/tests/invoice_issue.sql proves the functions.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { extractText, getDocumentProxy } from 'unpdf';
import { readEmbeddedInvoiceXml } from '@/lib/invoicing/embedded-xml';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { companyProfileRow } from './company-profile-rows';
import { assertRefused } from './operations-boundary-refusals';

const invoiceId = '98100000-0000-4000-8000-000000000001';
const foreignInvoiceId = '98100000-0000-4000-8000-000000000009';
const attemptKey = '99100000-0000-4000-8000-000000000001';
const clientId = '97100000-0000-4000-8000-000000000001';

const stored: Array<{ path: string; body: Uint8Array }> = [];
const discarded: string[] = [];
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
  readStorageObject: async () => {
    throw new Error('storage_object_missing');
  },
}));

const world = installActionWorld({
  // Without USt-IdNr., Steuernummer and Handelsregisternummer the rules refuse an invoice.
  company_document_profiles: [
    companyProfileRow(ORGANIZATION_A, 'Haustechnik Sonnenberg GmbH', 'DE00 1111 1111 1111 1111 11'),
  ],
});
const { fileInvoiceOriginal, issueInvoice } = await import('@/lib/invoices/issue-actions');
const { saveInvoiceSettings } = await import('@/lib/invoices/settings-actions');
const preview = await import('@/app/api/rechnungen/vorschau/route');
const GET = (id: string) =>
  preview.GET(new Request(`http://localhost/api/rechnungen/vorschau?rechnung=${id}`));

const draft = {
  id: invoiceId,
  invoiceNumber: null,
  status: 'entwurf',
  version: 2,
  serviceStart: '2037-11-02',
  serviceEnd: '2037-11-02',
  paymentDueDays: 14,
  discountDays: null,
  discountBasisPoints: null,
  orderReference: 'BE-4711',
  buyerReference: '',
  openingText: '',
  closingText: '',
  lineNetCents: 10800,
  taxCents: 2052,
  grossCents: 12852,
  issueDate: null,
  issueSnapshot: null,
  original: null,
  client: { id: clientId, name: 'Hausverwaltung Lindenhof GmbH' },
  recipient: { id: clientId, name: 'Hausverwaltung Lindenhof GmbH', address: 'Hofweg 1, 10117 Berlin' },
  work: null,
  lines: [
    {
      name: 'Monteurstunde',
      description: '',
      quantity: '1.500',
      unit: 'hour',
      unitPriceCents: 7200,
      priceQuantity: 1,
      taxRateBasisPoints: 1900,
      netCents: 10800,
    },
  ],
};
const issueInput = { invoiceId, expectedVersion: 2, attemptKey };

// A field worker reaches nothing.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['issueInvoice', () => issueInvoice(issueInput)],
    ['fileInvoiceOriginal', () => fileInvoiceOriginal({ invoiceId })],
    [
      'saveInvoiceSettings',
      () =>
        saveInvoiceSettings({
          organizationId: ORGANIZATION_A,
          expectedVersion: 0,
          settings: {
            numberPrefix: 'RE-',
            numberWithYear: true,
            numberMinDigits: 3,
            nextNumber: 1,
            paymentDueDays: 14,
            discountDays: null,
            discountBasisPoints: null,
          },
        }),
    ],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);
world.adminClientRequests = 0;
assert.equal((await GET(invoiceId)).status, 403);
assert.equal(world.adminClientRequests, 0, 'a refused preview reached the database');

// Büro saves no settings: only an Admin sets the series.
signInAs(world, 'buero');
await assertRefused(
  world,
  [
    [
      'saveInvoiceSettings as Büro',
      () =>
        saveInvoiceSettings({
          organizationId: ORGANIZATION_A,
          expectedVersion: 0,
          settings: {
            numberPrefix: 'RE-',
            numberWithYear: true,
            numberMinDigits: 3,
            nextNumber: 1,
            paymentDueDays: 14,
            discountDays: null,
            discountBasisPoints: null,
          },
        }),
    ],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);

// Another organization's invoice reads as none: the one read, no write.
world.rpc = ({ name, args }) =>
  name === 'get_invoice' && args.p_invoice_id === invoiceId && args.p_organization_id === ORGANIZATION_A
    ? { data: draft, error: null }
    : { data: null, error: null };
await assertRefused(
  world,
  [
    ['issueInvoice foreign invoice', () => issueInvoice({ ...issueInput, invoiceId: foreignInvoiceId })],
    ['fileInvoiceOriginal foreign invoice', () => fileInvoiceOriginal({ invoiceId: foreignInvoiceId })],
  ],
  { success: false, error: 'invoice_not_found' },
  'one-call',
);
assert.equal((await GET(foreignInvoiceId)).status, 404);

// A draft the rules refuse stays a draft: no issue call, and the office reads what to fix.
world.rpcCalls.length = 0;
const refused = await issueInvoice(issueInput);
assert.equal(refused.success, false);
assert.ok(!refused.success && 'findings' in refused, JSON.stringify(refused));
assert.ok(
  'findings' in refused &&
    refused.findings.some(
      (finding) =>
        finding.label.startsWith('Firmenangaben: USt-IdNr. oder Steuernummer') &&
        finding.href === '/einstellungen/dokumente',
    ),
  JSON.stringify(refused),
);
assert.deepEqual(
  world.rpcCalls.map((call) => call.name),
  ['get_invoice'],
  'a refused draft reached the issue',
);

// A draft without a readable recipient address is refused before the rules.
world.rpc = ({ name }) =>
  name === 'get_invoice'
    ? { data: { ...draft, recipient: { ...draft.recipient, address: 'irgendwo' } }, error: null }
    : { data: null, error: null };
const noAddress = await issueInvoice(issueInput);
assert.ok(
  'findings' in noAddress && noAddress.findings[0]?.href === `/kunden/${clientId}`,
  JSON.stringify(noAddress),
);

// With a USt-IdNr. the draft passes: issued under the caller's organization, the original filed.
world.tables.company_document_profiles = [
  companyProfileRow(ORGANIZATION_A, 'Haustechnik Sonnenberg GmbH', 'DE00 1111 1111 1111 1111 11', {
    vatId: 'DE123456789',
  }),
];
let issued: Record<string, unknown> | null = null;
const documentId = '96100000-0000-4000-8000-000000000001';
world.rpc = ({ name, args }) => {
  if (name === 'get_invoice') return { data: issued ?? draft, error: null };
  if (name === 'issue_invoice') {
    issued = {
      ...draft,
      status: 'ausgestellt',
      version: 3,
      invoiceNumber: 'RE-2037-001',
      issueDate: '2037-11-20',
      issueSnapshot: args.p_snapshot,
    };
    return { data: { invoiceNumber: 'RE-2037-001', issueDate: '2037-11-20', version: 3 }, error: null };
  }
  if (name === 'register_invoice_original') {
    return { data: { documentId, replay: false, contentHash: args.p_content_hash }, error: null };
  }
  return { data: null, error: null };
};
world.rpcCalls.length = 0;
assert.deepEqual(await issueInvoice(issueInput), {
  success: true,
  invoiceNumber: 'RE-2037-001',
  originalFiled: true,
});
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id, call.args.p_actor_id ?? null]),
  [
    ['get_invoice', ORGANIZATION_A, null],
    ['issue_invoice', ORGANIZATION_A, CALLER_ID],
    ['get_invoice', ORGANIZATION_A, null],
    ['register_invoice_original', ORGANIZATION_A, CALLER_ID],
  ],
);
const issueArgs = world.rpcCalls[1]?.args;
assert.equal(issueArgs?.p_expected_version, 2);
assert.equal(issueArgs?.p_attempt_key, attemptKey);
assert.deepEqual(JSON.parse(JSON.stringify(issueArgs?.p_snapshot)).buyer, {
  name: 'Hausverwaltung Lindenhof GmbH',
  address: { lines: ['Hofweg 1'], postalCode: '10117', city: 'Berlin', countryCode: 'DE' },
});
const [first] = stored;
if (!first) throw new Error('the issue stored no original');
assert.ok(first.path.startsWith(`${ORGANIZATION_A}/`) && first.path.endsWith('/Rechnung-RE-2037-001.pdf'));
const xml = await readEmbeddedInvoiceXml(first.body);
assert.ok(xml.includes('<ram:ID>RE-2037-001</ram:ID>') && xml.includes('DE123456789'), xml);
const { text } = await extractText(await getDocumentProxy(first.body.slice()), { mergePages: true });
assert.ok(text.includes('Rechnung RE-2037-001') && text.includes('Hofweg 1') && text.includes('Std'), text);

// A retried press after a lost answer gets the first issue's number from the function.
world.rpcCalls.length = 0;
assert.deepEqual(await issueInvoice(issueInput), {
  success: true,
  invoiceNumber: 'RE-2037-001',
  originalFiled: true,
});
assert.equal(world.rpcCalls[1]?.name, 'issue_invoice');

// „Beleg erstellen“ after a lost registration renders the same bytes again; a filed original is left alone.
stored.length = 0;
const again = await fileInvoiceOriginal({ invoiceId });
assert.deepEqual(again, { success: true });
assert.deepEqual(stored[0]?.body, first.body, 'a retry rendered other bytes');
issued = { ...(issued ?? {}), original: { documentId, filed: true } };
world.rpcCalls.length = 0;
assert.deepEqual(await fileInvoiceOriginal({ invoiceId }), { success: true });
assert.deepEqual(
  world.rpcCalls.map((call) => call.name),
  ['get_invoice'],
);

// The preview of a draft: a PDF marked „Entwurf“ without e-invoice data, from the caller's organization.
issued = null;
const response = await GET(invoiceId);
assert.equal(response.status, 200);
assert.equal(response.headers.get('Content-Type'), 'application/pdf');
assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
const previewBytes = new Uint8Array(await response.arrayBuffer());
await assert.rejects(readEmbeddedInvoiceXml(previewBytes), 'a preview carries no e-invoice');
const previewText = await extractText(await getDocumentProxy(previewBytes), { mergePages: true });
assert.ok(previewText.text.includes('Rechnung Entwurf'), previewText.text);

// A form loaded for another organization than the active one saves nothing there.
signInAs(world, 'admin');
await assertRefused(
  world,
  [
    [
      'saveInvoiceSettings after an organization switch',
      () =>
        saveInvoiceSettings({
          organizationId: ORGANIZATION_B,
          expectedVersion: 0,
          settings: {
            numberPrefix: 'RG',
            numberWithYear: false,
            numberMinDigits: 5,
            nextNumber: 10234,
            paymentDueDays: 30,
            discountDays: null,
            discountBasisPoints: null,
          },
        }),
    ],
  ],
  { success: false, error: 'organization_changed' },
  'none',
);

// An Admin saves the settings for the own organization, as itself.
world.rpc = () => ({ data: 1, error: null });
world.rpcCalls.length = 0;
assert.deepEqual(
  await saveInvoiceSettings({
    organizationId: ORGANIZATION_A,
    expectedVersion: 0,
    settings: {
      numberPrefix: 'RG',
      numberWithYear: false,
      numberMinDigits: 5,
      nextNumber: 10234,
      paymentDueDays: 30,
      discountDays: 7,
      discountBasisPoints: 200,
    },
  }),
  { success: true, version: 1 },
);
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id, call.args.p_actor_id]),
  [['save_invoice_settings', ORGANIZATION_A, CALLER_ID]],
);
