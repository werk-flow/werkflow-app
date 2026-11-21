// The real invoice actions and pages over the in-memory database: a field
// worker is refused before any database access, another organization's
// customer or draft is refused by the one database function each action
// calls, the office's write carries its own organization, actor and the
// amounts the server computed, and the pages read only the caller's
// organization. supabase/tests/invoice_drafts.sql proves the functions'
// refusals, grants and history.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { CALLER_ID, ORGANIZATION_A, signInAs } from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';
import { installPageWorld, refusal, renderTree } from './page-render';

const ownClientId = '97000000-0000-4000-8000-000000000001';
const foreignClientId = '97000000-0000-4000-8000-000000000009';
const ownInvoiceId = '98000000-0000-4000-8000-000000000001';
const foreignInvoiceId = '98000000-0000-4000-8000-000000000009';
const attemptKey = '99000000-0000-4000-8000-000000000001';

const world = await installPageWorld({ invoices: [], invoice_lines: [], invoice_events: [] });
mock.module('next/cache', () => ({ updateTag: () => {}, revalidatePath: () => {}, revalidateTag: () => {} }));

const { createInvoice, deleteInvoiceDraft, saveInvoiceDraft } = await import('@/lib/invoices/actions');
const { default: InvoicesPage } = await import('@/app/(app)/rechnungen/page');
const { default: InvoicePage } = await import('@/app/(app)/rechnungen/[invoiceId]/page');

const terms = {
  serviceStart: null,
  serviceEnd: null,
  paymentDueDays: 14,
  discountDays: null,
  discountBasisPoints: null,
  orderReference: '',
  buyerReference: '',
  openingText: '',
  closingText: '',
};
const lines = [
  {
    name: 'Monteurstunde',
    description: '',
    quantity: '1.5',
    unit: 'hour',
    unitPriceCents: 7200,
    priceQuantity: 1,
    taxRateBasisPoints: 1900,
  },
  {
    name: 'Gutschrift',
    description: '',
    quantity: '-1',
    unit: 'flat_rate',
    unitPriceCents: 4500,
    priceQuantity: 1,
    taxRateBasisPoints: 0,
  },
] as const;
const save = (invoiceId: string) =>
  saveInvoiceDraft({ invoiceId, expectedVersion: 1, attemptKey, terms, lines: [...lines] });
const remove = (invoiceId: string) => deleteInvoiceDraft({ invoiceId, expectedVersion: 1, attemptKey });

// A field worker neither writes an invoice nor opens a page of them.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['createInvoice', () => createInvoice({ attemptKey, clientId: ownClientId, work: null })],
    ['saveInvoiceDraft', () => save(ownInvoiceId)],
    ['deleteInvoiceDraft', () => remove(ownInvoiceId)],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);
world.adminClientRequests = 0;
assert.equal(await refusal(() => InvoicesPage({ searchParams: Promise.resolve({}) })), 'redirect:/dashboard');
assert.equal(
  await refusal(() => InvoicePage({ params: Promise.resolve({ invoiceId: ownInvoiceId }) })),
  'redirect:/dashboard',
);
assert.equal(world.adminClientRequests, 0, 'a refused page reached the database');

// Another organization's customer or draft is refused by the one function call, with its code.
signInAs(world, 'buero');
refuseForeignIds(
  world,
  new Map([
    [foreignClientId, 'client_not_found'],
    [foreignInvoiceId, 'invoice_not_found'],
  ]),
  ownInvoiceId,
);
await assertRefused(
  world,
  [
    [
      'createInvoice foreign customer',
      () => createInvoice({ attemptKey, clientId: foreignClientId, work: null }),
    ],
  ],
  { success: false, error: 'client_not_found' },
  'one-call',
);
await assertRefused(
  world,
  [
    ['saveInvoiceDraft foreign draft', () => save(foreignInvoiceId)],
    ['deleteInvoiceDraft foreign draft', () => remove(foreignInvoiceId)],
  ],
  { success: false, error: 'invoice_not_found' },
  'one-call',
);

// A bad id, a unit outside the list or a fourth decimal never reaches the database.
await assertRefused(
  world,
  [
    [
      'createInvoice bad customer id',
      () => createInvoice({ attemptKey, clientId: 'not-a-uuid', work: null }),
    ],
    [
      'saveInvoiceDraft unknown unit',
      () =>
        saveInvoiceDraft({
          invoiceId: ownInvoiceId,
          expectedVersion: 1,
          attemptKey,
          terms,
          lines: [{ ...lines[0], unit: 'barrel' }],
        }),
    ],
    [
      'saveInvoiceDraft four decimals',
      () =>
        saveInvoiceDraft({
          invoiceId: ownInvoiceId,
          expectedVersion: 1,
          attemptKey,
          terms,
          lines: [{ ...lines[0], quantity: '1.0001' }],
        }),
    ],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);

// Büro writes in its own organization, as itself, with the amounts the server computed.
world.rpcCalls.length = 0;
world.rpc = ({ name }) => ({
  data: name === 'save_invoice_draft' ? 2 : name === 'create_invoice' ? ownInvoiceId : null,
  error: null,
});
assert.deepEqual(await createInvoice({ attemptKey, clientId: ownClientId, work: null }), {
  success: true,
  invoiceId: ownInvoiceId,
});
assert.deepEqual(await save(ownInvoiceId), { success: true, version: 2 });
assert.deepEqual(await remove(ownInvoiceId), { success: true });
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id, call.args.p_actor_id]),
  [
    ['create_invoice', ORGANIZATION_A, CALLER_ID],
    ['save_invoice_draft', ORGANIZATION_A, CALLER_ID],
    ['delete_invoice_draft', ORGANIZATION_A, CALLER_ID],
  ],
);
const saved = world.rpcCalls[1]?.args;
// 1,5 × 72,00 € at 19 % and a credit of 45,00 € at 0 %: 63,00 € net, 20,52 € VAT.
assert.deepEqual(saved?.p_totals, { lineNetCents: 6300, taxCents: 2052, grossCents: 8352 });
assert.deepEqual(Array.isArray(saved?.p_lines) ? saved.p_lines.map((line: unknown) => line) : null, [
  { ...lines[0], taxCategory: 'S', netCents: 10800 },
  { ...lines[1], taxCategory: 'Z', netCents: -4500 },
]);

// The pages read only the caller's organization.
world.rpc = ({ name }) =>
  name === 'list_invoice_page'
    ? { data: { total: 0, hasAny: false, rows: [] }, error: null }
    : { data: null, error: null };
world.rpcCalls.length = 0;
await renderTree(() => InvoicesPage({ searchParams: Promise.resolve({}) }));
await renderTree(() => InvoicePage({ params: Promise.resolve({ invoiceId: foreignInvoiceId }) }));
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id]),
  [
    ['list_invoice_page', ORGANIZATION_A],
    ['get_invoice', ORGANIZATION_A],
  ],
);
