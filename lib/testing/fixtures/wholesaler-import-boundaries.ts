// The wholesaler import and supplier catalog actions over the in-memory
// database (werk-flow/werkflow-planning#375, #477). A field worker is refused
// the open, the staging, the preview, the price preview, the confirm, the
// abandon, the report, the catalog search and the adopt before any database
// call; a rebate that is no percentage never reaches the database. The browser reads a
// delivery, so no action takes a file: each takes parsed lines and carries the
// caller's organization and actor in its one call, so another organization's
// wholesaler, batch or catalog row is not found.
// supabase/tests/inventory_supplier_catalog.sql proves the database functions'
// own refusals. Synthetic data only.
import assert from 'node:assert/strict';

import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const ownSupplierId = '37500000-0000-4000-8000-000000000030';
const foreignSupplierId = '37500000-0000-4000-8000-000000000039';
const foreignImportId = '37500000-0000-4000-8000-000000000049';
const ownImportId = '37500000-0000-4000-8000-000000000048';
const foreignCatalogId = '37500000-0000-4000-8000-000000000059';

const world = installActionWorld({
  inventory_suppliers: [
    { id: ownSupplierId, organization_id: ORGANIZATION_A, name: 'Großhandel Nordrohr' },
    { id: foreignSupplierId, organization_id: ORGANIZATION_B, name: 'Fremder Großhandel' },
  ],
  inventory_supplier_catalog_imports: [
    { id: foreignImportId, organization_id: ORGANIZATION_B, status: 'confirmed', created_by: CALLER_ID },
    { id: ownImportId, organization_id: ORGANIZATION_A, status: 'confirmed', created_by: CALLER_ID },
  ],
  // A report longer than one part: 20 500 articles whose unit stayed unmapped.
  inventory_supplier_catalog_import_lines: Array.from({ length: 20_500 }, (_, ordinal) => ({
    organization_id: ORGANIZATION_A,
    import_id: ownImportId,
    ordinal,
    kind: 'article',
    file_name: 'lieferung',
    line_number: ordinal + 1,
    article_number: `NR-${ordinal}`,
    unit_text: 'XYZ',
    reason: null,
  })),
  inventory_supplier_catalog_articles: [{ id: foreignCatalogId, organization_id: ORGANIZATION_B }],
});
const imports = await import('@/lib/inventory/wholesaler-import-actions');
const { WHOLESALER_IMPORT_MAX_LINES } = await import('@/lib/inventory/wholesaler-import-schemas');
const { adoptSupplierCatalogArticle } = await import('@/lib/inventory/supplier-catalog-actions');
const { searchSupplierCatalog } = await import('@/lib/inventory/supplier-catalog-search');

const LINE = {
  ordinal: 0,
  kind: 'article',
  file_name: 'lieferung',
  line_number: 1,
  article_number: 'NR-1501',
  name: 'Kupferrohr 15 mm',
  name_addition: '',
  unit_text: 'Meter',
  price_quantity: 100,
  price_kind: 'list',
  price_cents: 61000,
  rebate_group: null,
  main_product_group: null,
  product_group: null,
  ean: null,
  matchcode: null,
  reason_code: null,
  reason: null,
} as const;
const open = (supplierId: string) =>
  [
    'openWholesalerImport',
    () =>
      imports.openWholesalerImport({
        supplierId,
        fileNames: ['lieferung'],
        contentHash: 'a'.repeat(64),
        header: {
          formatVersion: '4',
          supplierText: 'Großhandel Nordrohr',
          date: '2037-11-02',
          currency: 'EUR',
        },
        rebateGroups: [],
        skipped: [],
      }),
  ] as const;
const stage = [
  'stageWholesalerImportLines',
  () => imports.stageWholesalerImportLines({ importId: foreignImportId, lines: [LINE] }),
] as const;
const preview = [
  'previewWholesalerImport',
  () => imports.previewWholesalerImport({ importId: foreignImportId }),
] as const;
const prices = [
  'previewWholesalerPrices',
  () => imports.previewWholesalerPrices({ importId: foreignImportId, rebates: { CU1: 2500 } }),
] as const;
const confirm = [
  'confirmWholesalerImport',
  () =>
    imports.confirmWholesalerImport({
      importId: foreignImportId,
      unitMapping: { Meter: 'meter' },
      rebates: { CU1: 2500, AR1: null },
      priceFingerprint: '0'.repeat(32),
    }),
] as const;
const abandon = [
  'abandonWholesalerImport',
  () => imports.abandonWholesalerImport({ importId: foreignImportId }),
] as const;
const report = [
  'readWholesalerImportReport',
  () => imports.readWholesalerImportReport({ importId: foreignImportId, from: 0 }),
] as const;
const adopt = [
  'adoptSupplierCatalogArticle',
  () => adoptSupplierCatalogArticle({ catalogArticleId: foreignCatalogId }),
] as const;
const search = ['searchSupplierCatalog', () => searchSupplierCatalog('Kupferrohr')] as const;

// A field worker never reaches the import or the catalog, not even its search.
signInAs(world, 'employee');
await assertRefused(
  world,
  [open(ownSupplierId), stage, preview, prices, confirm, abandon, report, adopt, search],
  { success: false, error: 'not_authorized' },
  'none',
);

// Büro opens no batch for another organization's wholesaler: the one call
// carries the caller's organization and actor.
signInAs(world, 'buero');
refuseForeignIds(world, new Map([[foreignSupplierId, 'supplier_not_found']]));
await assertRefused(
  world,
  [open(foreignSupplierId)],
  { success: false, error: 'supplier_not_found' },
  'one-call',
);

// A part of more lines than one call carries, or a line of another shape, is refused before the database.
world.rpcCalls.length = 0;
const tooMany = Array.from({ length: 2001 }, (_, ordinal) => ({ ...LINE, ordinal }));
assert.deepEqual(await imports.stageWholesalerImportLines({ importId: ownImportId, lines: tooMany }), {
  success: false,
  error: 'invalid_input',
});
assert.deepEqual(
  await imports.stageWholesalerImportLines({
    importId: ownImportId,
    lines: [{ ...LINE, price_cents: -1 }],
  }),
  { success: false, error: 'invalid_input' },
);
// A price kind without its amount would pass the staging and fail the confirm.
assert.deepEqual(
  await imports.stageWholesalerImportLines({
    importId: ownImportId,
    lines: [{ ...LINE, price_cents: null }],
  }),
  { success: false, error: 'invalid_input' },
);
// An article without its price quantity would pass the staging's check, which reads NULL as passed, and fail the confirm.
assert.deepEqual(
  await imports.stageWholesalerImportLines({
    importId: ownImportId,
    lines: [{ ...LINE, price_quantity: null }],
  }),
  { success: false, error: 'invalid_input' },
);
// The batch's key is (batch, ordinal), so a bounded ordinal bounds the lines one batch holds, however many parts arrive.
assert.deepEqual(
  await imports.stageWholesalerImportLines({
    importId: ownImportId,
    lines: [{ ...LINE, ordinal: WHOLESALER_IMPORT_MAX_LINES }],
  }),
  { success: false, error: 'invalid_input' },
);
// A rebate over 100 %, of a fraction of a hundredth, or of a group with
// surrounding spaces is refused before the database.
for (const rebates of [{ CU1: 10_001 }, { CU1: 12.5 }, { CU1: -1 }, { ' CU1': 100 }, { '': 100 }]) {
  assert.deepEqual(await imports.previewWholesalerPrices({ importId: ownImportId, rebates }), {
    success: false,
    error: 'invalid_input',
  });
  assert.deepEqual(
    await imports.confirmWholesalerImport({
      importId: ownImportId,
      unitMapping: {},
      rebates,
      priceFingerprint: '0'.repeat(32),
    }),
    { success: false, error: 'invalid_input' },
  );
}
assert.equal(world.rpcCalls.length, 0, 'a refused part reached the database');

// The staging and the preview name the batch only together with the caller's
// organization and actor, so another person's batch of the same organization
// is not found (supabase/tests/inventory_supplier_catalog.sql proves the refusal).
refuseForeignIds(world, new Map());
for (const call of [
  () => imports.stageWholesalerImportLines({ importId: ownImportId, lines: [LINE] }),
  () => imports.previewWholesalerImport({ importId: ownImportId }),
  () => imports.previewWholesalerPrices({ importId: ownImportId, rebates: null }),
]) {
  world.rpcCalls.length = 0;
  await call();
  assert.equal(world.rpcCalls.length, 1);
  assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);
  assert.equal(world.rpcCalls[0]?.args.p_actor_id, CALLER_ID);
}

// The confirm names the price preview the dialog shows, so it writes only those changes.
world.rpcCalls.length = 0;
await imports.confirmWholesalerImport({
  importId: ownImportId,
  unitMapping: { Meter: 'meter' },
  rebates: { CU1: 2500 },
  priceFingerprint: 'a'.repeat(32),
});
assert.equal(world.rpcCalls.length, 1);
assert.equal(world.rpcCalls[0]?.args.p_price_fingerprint, 'a'.repeat(32));
assert.deepEqual(world.rpcCalls[0]?.args.p_rebates, { CU1: 2500 });

// Another organization's batch and catalog row are not found by the one call
// that carries the caller's organization and actor.
refuseForeignIds(
  world,
  new Map([
    [foreignImportId, 'import_not_found'],
    [foreignCatalogId, 'catalog_article_not_found'],
  ]),
);
await assertRefused(
  world,
  [stage, preview, prices, confirm, abandon],
  { success: false, error: 'import_not_found' },
  'one-call',
);
await assertRefused(world, [adopt], { success: false, error: 'catalog_article_not_found' }, 'one-call');
await assertRefused(world, [report], { success: false, error: 'import_not_found' }, 'reads');

// The search reads only the caller's organization: its one call carries it.
refuseForeignIds(world, new Map(), []);
world.rpcCalls.length = 0;
assert.deepEqual(await search[1](), { success: true, options: [], hasMore: false });
assert.equal(world.rpcCalls.length, 1);
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);

// The report reaches every line in parts: 20 000, then the remaining 500.
const firstPart = await imports.readWholesalerImportReport({ importId: ownImportId, from: 0 });
assert.ok(firstPart.success);
assert.equal(firstPart.lines.length, 20_000);
assert.equal(firstPart.next, 20_000);
const lastPart = await imports.readWholesalerImportReport({ importId: ownImportId, from: 20_000 });
assert.ok(lastPart.success);
assert.equal(lastPart.lines.length, 500);
assert.equal(lastPart.next, null);
assert.deepEqual(lastPart.lines.at(-1), {
  fileName: 'lieferung',
  lineNumber: 20_500,
  articleNumber: 'NR-20499',
  reason: 'Die Einheit „XYZ“ ist keiner Einheit zugeordnet.',
});
