// The real cancel code over the action world: a field worker reaches nothing;
// another organization's invoice is refused by the one read; a Stornorechnung
// is not cancelled; a Stornorechnung the EN 16931 rules refuse is never
// issued; a checked one is issued under the caller's own organization, and
// its original, rendered as a corrected invoice (384) naming the cancelled
// one, is stored and passed to the one cancel call, which registers and files
// it. An original no cancel registered is discarded. A cancel that went
// through revalidates the cancelled invoice's route, so Back after
// „Korrigieren“ shows it Storniert without Realtime; a refusal revalidates
// nothing.
// supabase/tests/invoice_cancel.sql proves the function.
import assert from 'node:assert/strict';
import { mock, setSystemTime } from 'bun:test';
import { extractText, getDocumentProxy } from 'unpdf';
import { EMPTY_COMPANY_PROFILE_DETAILS } from '@/lib/company-profile/profile';
import { readEmbeddedInvoiceXml } from '@/lib/invoicing/embedded-xml';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const invoiceId = '98200000-0000-4000-8000-000000000001';
const stornoId = '98200000-0000-4000-8000-000000000002';
const correctionId = '98200000-0000-4000-8000-000000000003';
const foreignInvoiceId = '98200000-0000-4000-8000-000000000009';
const attemptKey = '99200000-0000-4000-8000-000000000001';
const clientId = '97200000-0000-4000-8000-000000000001';

const stored: Array<{ path: string; body: Uint8Array }> = [];
const discarded: string[] = [];
const realStorage = await import('@/lib/storage/r2');
mock.module('@/lib/storage/r2', () => ({
  ...realStorage,
  putStorageObject: async ({ path, body }: { path: string; body: Uint8Array }) => {
    stored.push({ path, body: new Uint8Array(body) });
    return { created: true };
  },
  discardStorageObjects: async ({ paths }: { paths: string[] }) => {
    discarded.push(...paths);
  },
  readStorageObject: async () => {
    throw new Error('storage_object_missing');
  },
}));

// The day every cancel below happens, in Berlin.
const today = '2037-11-20';
setSystemTime(new Date(`${today}T10:00:00.000Z`));

const world = installActionWorld({});
// The world ignores revalidation; this fixture records it.
const revalidatedPaths: string[] = [];
mock.module('next/cache', () => ({
  updateTag: () => {},
  revalidatePath: (path: string) => revalidatedPaths.push(path),
  revalidateTag: () => {},
  cacheTag: () => {},
  cacheLife: () => {},
  unstable_cache: () => {
    throw new Error('unexpected unstable_cache');
  },
}));
const { cancelInvoice } = await import('@/lib/invoices/cancel-actions');

const snapshot = (vatId: string) => ({
  organizationName: 'Haustechnik Sonnenberg',
  profile: {
    ...EMPTY_COMPANY_PROFILE_DETAILS,
    companyName: 'Haustechnik Sonnenberg GmbH',
    street: 'Sonnenweg 1',
    postalCode: '01234',
    city: 'Sonnenstadt',
    vatId,
    iban: 'DE00 1111 1111 1111 1111 11',
  },
  files: { logo: null, stationery_first: null, stationery_following: null },
  buyer: {
    name: 'Hausverwaltung Lindenhof GmbH',
    address: { lines: ['Hofweg 1'], postalCode: '10117', city: 'Berlin', countryCode: 'DE' },
  },
});

/** An issued invoice: 1,5 h at 72,00 € and a credit of 35,00 € at 7 %. */
const original = {
  id: invoiceId,
  invoiceNumber: 'RE-2037-001',
  status: 'ausgestellt',
  version: 3,
  serviceStart: '2037-11-02',
  serviceEnd: '2037-11-06',
  paymentDueDays: 14,
  discountDays: 7,
  discountBasisPoints: 200,
  orderReference: 'BE-4711',
  buyerReference: '',
  openingText: 'Vielen Dank für deinen Auftrag.',
  closingText: '',
  lineNetCents: 7300,
  taxCents: 1807,
  grossCents: 9107,
  issueDate: '2037-11-10',
  issueSnapshot: snapshot('DE123456789'),
  original: { documentId: '96200000-0000-4000-8000-000000000009', filed: true },
  cancels: null,
  cancellationReason: null,
  chain: [
    {
      id: invoiceId,
      invoiceNumber: 'RE-2037-001',
      status: 'ausgestellt',
      kind: 'rechnung',
      issueDate: '2037-11-10',
    },
  ],
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
    {
      name: 'Gutschrift Anfahrt',
      description: '',
      quantity: '-1.000',
      unit: 'flat_rate',
      unitPriceCents: 3500,
      priceQuantity: 1,
      taxRateBasisPoints: 700,
      netCents: -3500,
    },
  ],
};

/** The Stornorechnung as cancel_invoice stores it and get_invoice reads it back. */
const storno = {
  ...original,
  id: stornoId,
  invoiceNumber: 'RE-2037-002',
  version: 2,
  paymentDueDays: 0,
  discountDays: null,
  discountBasisPoints: null,
  openingText: '',
  lineNetCents: -7300,
  taxCents: -1807,
  grossCents: -9107,
  issueDate: '2037-11-20',
  original: null,
  cancels: { id: invoiceId, invoiceNumber: 'RE-2037-001', issueDate: '2037-11-10' },
  cancellationReason: 'Falscher Rechnungsempfänger',
  lines: [
    { ...original.lines[0], quantity: '-1.500', netCents: -10800 },
    { ...original.lines[1], quantity: '1.000', netCents: 3500 },
  ],
};
const input = { invoiceId, attemptKey, reason: '  Falscher Rechnungsempfänger ', correct: false };
/** The series as get_invoice_settings answers it: the check renders the Stornorechnung under its next number. */
const settings = {
  version: 2,
  numberPrefix: 'RE-',
  numberWithYear: true,
  numberMinDigits: 3,
  nextNumber: 2,
  nextInvoiceNumber: 'RE-2037-002',
  numbersFixed: true,
  paymentDueDays: 14,
  discountDays: null,
  discountBasisPoints: null,
};

// A field worker reaches nothing.
signInAs(world, 'employee');
await assertRefused(
  world,
  [['cancelInvoice', () => cancelInvoice(input)]],
  { success: false, error: 'not_authorized' },
  'none',
);

// Another organization's invoice reads as none, and a Stornorechnung is not cancelled: the one read, no write.
signInAs(world, 'buero');
world.rpc = ({ name, args }) => {
  if (name !== 'get_invoice' || args.p_organization_id !== ORGANIZATION_A) return { data: null, error: null };
  return { data: args.p_invoice_id === stornoId ? storno : null, error: null };
};
await assertRefused(
  world,
  [['cancelInvoice foreign invoice', () => cancelInvoice({ ...input, invoiceId: foreignInvoiceId })]],
  { success: false, error: 'invoice_not_found' },
  'one-call',
);
await assertRefused(
  world,
  [['cancelInvoice a Stornorechnung', () => cancelInvoice({ ...input, invoiceId: stornoId })]],
  { success: false, error: 'invoice_is_storno' },
  'one-call',
);

// A credit is not cancelled: its Stornorechnung would ask the customer to pay. The one read, no write.
world.rpc = ({ name }) =>
  name === 'get_invoice'
    ? { data: { ...original, lineNetCents: -7300, taxCents: -1807, grossCents: -9107 }, error: null }
    : { data: null, error: null };
await assertRefused(
  world,
  [['cancelInvoice a credit', () => cancelInvoice(input)]],
  { success: false, error: 'invoice_not_cancellable' },
  'one-call',
);

// A Stornorechnung the rules refuse is not issued: here the seller in the snapshot lacks every tax id.
world.rpc = ({ name }) => {
  if (name === 'get_invoice') return { data: { ...original, issueSnapshot: snapshot('') }, error: null };
  return { data: name === 'get_invoice_settings' ? settings : null, error: null };
};
world.rpcCalls.length = 0;
const refused = await cancelInvoice(input);
assert.ok(
  !refused.success &&
    'findings' in refused &&
    refused.findings.some((finding) =>
      finding.label.startsWith('Firmenangaben: USt-IdNr. oder Steuernummer'),
    ),
  JSON.stringify(refused),
);
assert.deepEqual(
  world.rpcCalls.map((call) => call.name),
  ['get_invoice', 'get_invoice_settings'],
  'a refused Stornorechnung reached the cancel',
);

// No refusal above revalidated a route.
assert.deepEqual(revalidatedPaths, []);

// A checked Stornorechnung: issued under the caller's organization, its original filed as a 384.
let cancelled = false;
let registeredOriginal: unknown = null;
// How often cancel_invoice answers that another issue took the checked number first.
let numberMoves = 0;
world.rpc = ({ name, args }) => {
  if (name === 'get_invoice') {
    if (args.p_invoice_id === stornoId) return { data: storno, error: null };
    return { data: cancelled ? { ...original, status: 'storniert', version: 4 } : original, error: null };
  }
  if (name === 'cancel_invoice') {
    if (numberMoves > 0) {
      numberMoves -= 1;
      return { data: null, error: { code: 'P0001', message: 'invoice_number_moved' } };
    }
    // A replay registers nothing and answers the original the first cancel registered.
    if (!cancelled) registeredOriginal = args.p_original_document_id ?? null;
    cancelled = true;
    return {
      data: {
        stornoId,
        stornoNumber: 'RE-2037-002',
        issueDate: today,
        correctionId: args.p_correct ? correctionId : null,
        originalDocumentId: registeredOriginal,
      },
      error: null,
    };
  }
  return { data: name === 'get_invoice_settings' ? settings : null, error: null };
};
world.rpcCalls.length = 0;
assert.deepEqual(await cancelInvoice(input), {
  success: true,
  stornoNumber: 'RE-2037-002',
  originalFiled: true,
  correctionId: null,
});
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id, call.args.p_actor_id ?? null]),
  [
    ['get_invoice', ORGANIZATION_A, null],
    ['get_invoice_settings', ORGANIZATION_A, null],
    ['cancel_invoice', ORGANIZATION_A, CALLER_ID],
  ],
);
// The cancelled invoice's route renders again, Storniert.
assert.deepEqual(revalidatedPaths, [`/rechnungen/${invoiceId}`]);
const cancelArgs = world.rpcCalls[2]?.args;
assert.equal(cancelArgs?.p_invoice_id, invoiceId);
assert.equal(cancelArgs?.p_attempt_key, attemptKey);
assert.equal(cancelArgs?.p_reason, 'Falscher Rechnungsempfänger');
assert.equal(cancelArgs?.p_correct, false);
// The function issues exactly the number and day the Stornorechnung was checked under.
assert.equal(cancelArgs?.p_expected_number, 'RE-2037-002');
assert.equal(cancelArgs?.p_expected_issue_date, today);
// The one cancel call registers and files the original stored under the checked number.
const [first] = stored;
if (!first) throw new Error('the cancel stored no original');
assert.ok(
  first.path.startsWith(`${ORGANIZATION_A}/`) && first.path.endsWith('/Stornorechnung-RE-2037-002.pdf'),
  first.path,
);
assert.equal(cancelArgs?.p_original_storage_path, first.path);
assert.equal(first.path.split('/')[1], cancelArgs?.p_original_document_id);
assert.equal(cancelArgs?.p_original_size_bytes, first.body.byteLength);
assert.deepEqual(discarded, []);
const xml = await readEmbeddedInvoiceXml(first.body);
for (const part of [
  '<ram:TypeCode>384</ram:TypeCode>',
  '<ram:InvoiceReferencedDocument>',
  '<ram:IssuerAssignedID>RE-2037-001</ram:IssuerAssignedID>',
  '<ram:GrandTotalAmount>-91.07</ram:GrandTotalAmount>',
]) {
  assert.ok(xml.includes(part), `the Stornorechnung's XML lacks ${part}:\n${xml}`);
}
const { text } = await extractText(await getDocumentProxy(first.body.slice()), { mergePages: true });
for (const part of ['Stornorechnung RE-2037-002', 'Storno zu', 'RE-2037-001', 'Grund der Stornierung']) {
  assert.ok(text.includes(part), `the Stornorechnung's PDF lacks ${part}:\n${text}`);
}

// A retried press after a lost answer finds the original Storniert and asks the function at once, which answers
// the first Storno.
world.rpcCalls.length = 0;
stored.length = 0;
assert.deepEqual(await cancelInvoice(input), {
  success: true,
  stornoNumber: 'RE-2037-002',
  originalFiled: true,
  correctionId: null,
});
assert.deepEqual(
  world.rpcCalls.map((call) => call.name),
  ['get_invoice', 'cancel_invoice'],
);
assert.equal(world.rpcCalls[1]?.args.p_original_document_id, undefined);
assert.equal(stored.length, 0);

// Another issue took the checked number twice: the Stornorechnung is checked again each time, then cancelled.
cancelled = false;
numberMoves = 2;
world.rpcCalls.length = 0;
const moved = await cancelInvoice({ ...input, attemptKey: crypto.randomUUID() });
assert.equal(moved.success, true, JSON.stringify(moved));
assert.equal(world.rpcCalls.filter((call) => call.name === 'get_invoice_settings').length, 3);
assert.equal(world.rpcCalls.filter((call) => call.name === 'cancel_invoice').length, 3);
// The originals of the two moved numbers are discarded; the cancel registers the third.
assert.deepEqual(discarded, [stored[0]?.path, stored[1]?.path]);
stored.length = 0;
discarded.length = 0;
// A third move is answered, not retried for ever, and revalidates nothing.
cancelled = false;
numberMoves = 3;
revalidatedPaths.length = 0;
assert.deepEqual(await cancelInvoice({ ...input, attemptKey: crypto.randomUUID() }), {
  success: false,
  error: 'invoice_number_moved',
});
assert.deepEqual(
  discarded,
  stored.map((object) => object.path),
);
assert.deepEqual(revalidatedPaths, []);

// „Korrigieren“ answers the new draft.
cancelled = false;
numberMoves = 0;
const corrected = await cancelInvoice({ ...input, attemptKey: crypto.randomUUID(), correct: true });
assert.ok(corrected.success && corrected.correctionId === correctionId, JSON.stringify(corrected));
// The page „Korrigieren“ leaves for the draft renders again, so Back shows the invoice Storniert.
assert.deepEqual(revalidatedPaths, [`/rechnungen/${invoiceId}`]);
