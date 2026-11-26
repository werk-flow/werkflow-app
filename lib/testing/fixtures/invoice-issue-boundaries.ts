// The real issue, original, settings and preview code over the action world:
// a field worker reaches nothing; another organization's invoice is refused
// by the one read; a draft the EN 16931 rules refuse is never issued and the
// office reads what to fix; a checked draft is issued under the caller's own
// organization with the snapshot it was checked with, and the original
// rendered under its number is stored and passed to the one issue call, which
// registers and files it; „Beleg erstellen“ renders the same bytes again.
// The check runs under exactly the number and day the function then issues,
// and again under the new number when another issue took that one first.
// supabase/tests/invoice_issue.sql proves the functions.
import assert from 'node:assert/strict';
import { mock, setSystemTime } from 'bun:test';
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
// While set, the storage refuses every object.
let storageDown = false;
const realStorage = await import('@/lib/storage/r2');
mock.module('@/lib/storage/r2', () => ({
  ...realStorage,
  putStorageObject: async ({ path, body }: { path: string; body: Uint8Array }) => {
    if (storageDown) throw new Error('storage_unavailable');
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

// The day every issue below happens, in Berlin.
const today = '2037-11-20';
setSystemTime(new Date(`${today}T10:00:00.000Z`));

// The invoice number and Rechnungsdatum (CII format 102) of every XML the EN 16931 check read, in order.
const checkedNumbers: string[] = [];
// Captured before the mock, which rebinds the module's exports to the wrapper.
const { checkEn16931 } = await import('@/lib/invoicing/check-en16931');
mock.module('@/lib/invoicing/check-en16931', () => ({
  checkEn16931: (xml: string) => {
    const number = /<rsm:ExchangedDocument>\s*<ram:ID>([^<]*)<\/ram:ID>/.exec(xml)?.[1] ?? '';
    const date = /<ram:IssueDateTime>\s*<udt:DateTimeString format="102">(\d{8})</.exec(xml)?.[1] ?? '';
    checkedNumbers.push(`${number} ${date}`);
    return checkEn16931(xml);
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
  // The line came from a Leistung: get_invoice_with_line_sources names it beside the line.
  lineSources: [
    {
      kind: 'leistung',
      id: '96100000-0000-4000-8000-000000000071',
      number: 'L-7',
      name: 'Monteurstunde',
      archived: false,
    },
  ],
};
const issueInput = { invoiceId, expectedVersion: 2, attemptKey };
/** The series as get_invoice_settings answers it for the caller's organization; nextInvoiceNumber moves on each issue. */
let nextInvoiceNumber = 'RE-2037-001';
const settingsOf = (organizationId: unknown) =>
  organizationId === ORGANIZATION_A
    ? {
        version: 1,
        numberPrefix: 'RE-',
        numberWithYear: true,
        numberMinDigits: 3,
        nextNumber: Number(nextInvoiceNumber.slice(-3)),
        numberYear: 2037,
        nextInvoiceNumber,
        numbersFixed: false,
        paymentDueDays: 14,
        discountDays: null,
        discountBasisPoints: null,
      }
    : null;

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
            numberYear: 2037,
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
            numberYear: 2037,
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
world.rpc = ({ name, args }) => {
  if (name === 'get_invoice_settings') return { data: settingsOf(args.p_organization_id), error: null };
  return name === 'get_invoice_with_line_sources' &&
    args.p_invoice_id === invoiceId &&
    args.p_organization_id === ORGANIZATION_A
    ? { data: draft, error: null }
    : { data: null, error: null };
};
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
  ['get_invoice_with_line_sources', 'get_invoice_settings'],
  'a refused draft reached the issue',
);
// The rules read the draft under the number it would take, never under a placeholder.
assert.deepEqual(checkedNumbers, ['RE-2037-001 20371120']);

// A draft without a readable recipient address is refused before the rules.
world.rpc = ({ name }) =>
  name === 'get_invoice_with_line_sources'
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

// A used-up series advertises no number: the issue stops before the rules and reaches no issue_invoice.
world.rpc = ({ name, args }) => {
  if (name === 'get_invoice_with_line_sources') return { data: draft, error: null };
  if (name === 'get_invoice_settings') {
    return { data: { ...settingsOf(args.p_organization_id), nextInvoiceNumber: null }, error: null };
  }
  return { data: null, error: null };
};
world.rpcCalls.length = 0;
assert.deepEqual(await issueInvoice(issueInput), { success: false, error: 'invoice_numbers_exhausted' });
assert.deepEqual(
  world.rpcCalls.map((call) => call.name),
  ['get_invoice_with_line_sources', 'get_invoice_settings'],
  'a used-up series reached the issue',
);

let issued: Record<string, unknown> | null = null;
// How often issue_invoice answers that another issue took the checked number first; each move takes it.
let numberMoves = 0;
const documentId = '96100000-0000-4000-8000-000000000001';
world.rpc = ({ name, args }) => {
  if (name === 'get_invoice_with_line_sources') return { data: issued ?? draft, error: null };
  if (name === 'get_invoice_settings') return { data: settingsOf(args.p_organization_id), error: null };
  if (name === 'issue_invoice') {
    if (issued)
      return {
        data: {
          invoiceNumber: issued.invoiceNumber,
          issueDate: issued.issueDate,
          version: 3,
          originalDocumentId: issued.original ? documentId : null,
        },
        error: null,
      };
    if (numberMoves > 0) {
      numberMoves -= 1;
      nextInvoiceNumber = `RE-2037-00${Number(nextInvoiceNumber.slice(-1)) + 1}`;
      return { data: null, error: { code: 'P0001', message: 'invoice_number_moved' } };
    }
    const original = args.p_original_document_id ?? null;
    issued = {
      ...draft,
      status: 'ausgestellt',
      version: 3,
      invoiceNumber: args.p_expected_number,
      issueDate: args.p_expected_issue_date,
      issueSnapshot: args.p_snapshot,
      ...(original ? { original: { documentId: original, filed: true } } : {}),
    };
    return {
      data: {
        invoiceNumber: args.p_expected_number,
        issueDate: args.p_expected_issue_date,
        version: 3,
        originalDocumentId: original,
      },
      error: null,
    };
  }
  if (name === 'register_invoice_original') {
    return { data: { documentId, replay: false, contentHash: args.p_content_hash }, error: null };
  }
  return { data: null, error: null };
};
// Another issue took the checked number three times: the third move is answered, not checked again for ever.
numberMoves = 3;
world.rpcCalls.length = 0;
assert.deepEqual(await issueInvoice(issueInput), { success: false, error: 'invoice_number_moved' });
assert.equal(world.rpcCalls.filter((call) => call.name === 'issue_invoice').length, 3);
// Each refused issue discards the original stored for it.
assert.deepEqual(
  discarded,
  stored.map((object) => object.path),
);
nextInvoiceNumber = 'RE-2037-001';
stored.length = 0;
discarded.length = 0;

// Another issue took the checked number twice: each time the draft is checked again under the new number.
numberMoves = 2;
world.rpcCalls.length = 0;
checkedNumbers.length = 0;
assert.deepEqual(await issueInvoice(issueInput), {
  success: true,
  invoiceNumber: 'RE-2037-003',
  originalFiled: true,
});
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id, call.args.p_actor_id ?? null]),
  [
    ['get_invoice_with_line_sources', ORGANIZATION_A, null],
    ['get_invoice_settings', ORGANIZATION_A, null],
    ['issue_invoice', ORGANIZATION_A, CALLER_ID],
    ['get_invoice_settings', ORGANIZATION_A, null],
    ['issue_invoice', ORGANIZATION_A, CALLER_ID],
    ['get_invoice_settings', ORGANIZATION_A, null],
    ['issue_invoice', ORGANIZATION_A, CALLER_ID],
  ],
);
// The function issues exactly the number and day the draft was checked under; the original reads the same.
assert.deepEqual(
  world.rpcCalls
    .filter((call) => call.name === 'issue_invoice')
    .map((call) => [call.args.p_expected_number, call.args.p_expected_issue_date]),
  [
    ['RE-2037-001', today],
    ['RE-2037-002', today],
    ['RE-2037-003', today],
  ],
);
// Each check read the number and Rechnungsdatum its issue_invoice call got.
assert.deepEqual(checkedNumbers, ['RE-2037-001 20371120', 'RE-2037-002 20371120', 'RE-2037-003 20371120']);
const issueArgs = world.rpcCalls[6]?.args;
assert.equal(issueArgs?.p_expected_version, 2);
assert.equal(issueArgs?.p_attempt_key, attemptKey);
assert.deepEqual(JSON.parse(JSON.stringify(issueArgs?.p_snapshot)).buyer, {
  name: 'Hausverwaltung Lindenhof GmbH',
  address: { lines: ['Hofweg 1'], postalCode: '10117', city: 'Berlin', countryCode: 'DE' },
});
// The originals of the two moved numbers are discarded; the issue registers the third, which it was passed.
const first = stored[2];
if (!first) throw new Error('the issue stored no original');
assert.deepEqual(discarded, [stored[0]?.path, stored[1]?.path]);
assert.ok(first.path.startsWith(`${ORGANIZATION_A}/`) && first.path.endsWith('/Rechnung-RE-2037-003.pdf'));
assert.equal(issueArgs?.p_original_storage_path, first.path);
assert.equal(first.path.split('/')[1], issueArgs?.p_original_document_id);
assert.equal(issueArgs?.p_original_size_bytes, first.body.byteLength);
const xml = await readEmbeddedInvoiceXml(first.body);
assert.ok(xml.includes('<ram:ID>RE-2037-003</ram:ID>') && xml.includes('DE123456789'), xml);
const { text } = await extractText(await getDocumentProxy(first.body.slice()), { mergePages: true });
assert.ok(text.includes('Rechnung RE-2037-003') && text.includes('Hofweg 1') && text.includes('Std'), text);

// A retried press after a lost answer gets the first issue's number from the function and stores nothing.
world.rpcCalls.length = 0;
stored.length = 0;
assert.deepEqual(await issueInvoice(issueInput), {
  success: true,
  invoiceNumber: 'RE-2037-003',
  originalFiled: true,
});
assert.equal(world.rpcCalls[1]?.name, 'issue_invoice');
assert.equal(world.rpcCalls[1]?.args.p_expected_number, 'RE-2037-003');
assert.equal(stored.length, 0);

// With the storage down the draft is issued with its original pending, and the call names no original.
const issuedOriginal = first.body;
issued = null;
storageDown = true;
world.rpcCalls.length = 0;
assert.deepEqual(await issueInvoice(issueInput), {
  success: true,
  invoiceNumber: 'RE-2037-003',
  originalFiled: false,
});
assert.equal(world.rpcCalls.at(-1)?.args.p_original_document_id, undefined);
storageDown = false;

// „Beleg erstellen“ renders the stored invoice to the bytes its number was checked with; a filed original is left alone.
const again = await fileInvoiceOriginal({ invoiceId });
assert.deepEqual(again, { success: true });
assert.deepEqual(stored[0]?.body, issuedOriginal, 'a retry rendered other bytes');
assert.deepEqual(world.rpcCalls.at(-1)?.name, 'register_invoice_original');
issued = { ...(issued ?? {}), original: { documentId, filed: true } };
world.rpcCalls.length = 0;
assert.deepEqual(await fileInvoiceOriginal({ invoiceId }), { success: true });
assert.deepEqual(
  world.rpcCalls.map((call) => call.name),
  ['get_invoice_with_line_sources'],
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
            numberYear: 2037,
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
      numberYear: 2037,
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
