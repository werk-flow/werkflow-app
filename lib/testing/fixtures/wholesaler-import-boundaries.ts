// The wholesaler import and supplier catalog actions over the in-memory
// database (werk-flow/werkflow-planning#375). A field worker is refused the
// upload ticket, the preview, the confirm, the abandon, the report, the
// catalog search and the adopt before any database or storage call. Büro gets
// no ticket for another organization's wholesaler and signs uploads only into
// its own folder; the preview reads only that folder and deletes what it read;
// the confirm, the preview's batch and the adopt carry the caller's
// organization and actor, so another organization's batch or catalog row is
// not found. supabase/tests/inventory_supplier_catalog.sql proves the database
// functions' own refusals. The reader is a fake with synthetic data.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';

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
const foreignCatalogId = '37500000-0000-4000-8000-000000000059';
const uploadId = '37500000-0000-4000-8000-000000000060';

const storageCalls: string[] = [];
mock.module('@/lib/storage/r2', () => ({
  createSignedUploadUrl: async ({ organizationId, path }: { organizationId: string; path: string }) => {
    storageCalls.push(`sign ${organizationId} ${path}`);
    return 'https://storage.example.test/signed';
  },
  uploadStagingPath: (_organizationId: string, path: string) => `staging:${path}`,
  readStorageObject: async ({ path }: { path: string }) => {
    storageCalls.push(`read ${path}`);
    return new Uint8Array([1, 2, 3]);
  },
  discardStorageObjects: async ({ paths }: { paths: readonly string[] }) => {
    for (const path of paths) storageCalls.push(`discard ${path}`);
  },
}));
mock.module('@/lib/inventory/wholesaler-reader', () => ({
  wholesalerReaderInstalled: () => true,
  readWholesalerDelivery: () => ({
    installed: true,
    delivery: {
      header: {
        formatVersion: '4',
        supplierText: 'Großhandel Nordrohr',
        date: '2037-11-02',
        currency: 'EUR',
      },
      articles: [
        {
          file: 'lieferung',
          line: 1,
          articleNumber: 'NR-1501',
          change: 'new',
          name: 'Kupferrohr 15 mm',
          nameAddition: '',
          unit: 'Meter',
          priceQuantity: 100,
          price: { kind: 'list', amountCents: 61000 },
          rebateGroup: null,
          mainProductGroup: null,
          productGroup: null,
          ean: null,
          matchcode: null,
        },
      ],
      deletions: [],
      priceChanges: [],
      productGroups: [],
      rebateGroups: [],
      skipped: [],
      rejections: [],
    },
  }),
}));

const world = installActionWorld({
  inventory_suppliers: [
    { id: ownSupplierId, organization_id: ORGANIZATION_A, name: 'Großhandel Nordrohr' },
    { id: foreignSupplierId, organization_id: ORGANIZATION_B, name: 'Fremder Großhandel' },
  ],
  inventory_supplier_catalog_imports: [
    { id: foreignImportId, organization_id: ORGANIZATION_B, status: 'confirmed', created_by: CALLER_ID },
  ],
  inventory_supplier_catalog_articles: [
    { id: foreignCatalogId, organization_id: ORGANIZATION_B, search_text: 'nr-1501 kupferrohr 15 mm' },
  ],
});
const imports = await import('@/lib/inventory/wholesaler-import-actions');
const { adoptSupplierCatalogArticle } = await import('@/lib/inventory/supplier-catalog-actions');
const { searchSupplierCatalog } = await import('@/lib/inventory/supplier-catalog-search');

const files = [{ name: 'lieferung', sizeBytes: 1024 }];
const ticket = (supplierId: string) =>
  [
    'createWholesalerImportUploadTicket',
    () => imports.createWholesalerImportUploadTicket({ supplierId, files }),
  ] as const;
const preview = (supplierId: string) =>
  [
    'previewWholesalerImport',
    () => imports.previewWholesalerImport({ uploadId, supplierId, fileNames: ['lieferung'] }),
  ] as const;
const confirm = [
  'confirmWholesalerImport',
  () => imports.confirmWholesalerImport({ importId: foreignImportId, unitMapping: { Meter: 'meter' } }),
] as const;
const abandon = [
  'abandonWholesalerImport',
  () => imports.abandonWholesalerImport({ importId: foreignImportId }),
] as const;
const report = [
  'readWholesalerImportReport',
  () => imports.readWholesalerImportReport({ importId: foreignImportId }),
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
  [ticket(ownSupplierId), preview(ownSupplierId), confirm, abandon, report, adopt, search],
  { success: false, error: 'not_authorized' },
  'none',
);
assert.deepEqual(storageCalls, [], 'a refused field worker reached storage');

// Büro gets no upload for another organization's wholesaler, and signs its own
// uploads into its organization's folder, under a folder of its own.
signInAs(world, 'buero');
await assertRefused(
  world,
  [ticket(foreignSupplierId)],
  { success: false, error: 'supplier_not_found' },
  'reads',
);
assert.deepEqual(storageCalls, [], 'a refused ticket signed an upload');
const signed = await imports.createWholesalerImportUploadTicket({ supplierId: ownSupplierId, files });
assert.ok(signed.success);
assert.match(
  storageCalls[0] ?? '',
  new RegExp(
    `^sign ${ORGANIZATION_A} ${ORGANIZATION_A}/wholesaler-imports/${signed.uploadId}/${CALLER_ID}/0$`,
  ),
);

// The preview reads the caller's own folder and deletes what it read; its
// batch names the caller's organization and actor, so another organization's
// wholesaler is not found.
storageCalls.length = 0;
refuseForeignIds(world, new Map([[foreignSupplierId, 'supplier_not_found']]));
await assertRefused(
  world,
  [preview(foreignSupplierId)],
  { success: false, error: 'supplier_not_found' },
  'one-call',
);
const ownFile = `staging:${ORGANIZATION_A}/wholesaler-imports/${uploadId}/${CALLER_ID}/0`;
assert.deepEqual(storageCalls, [`read ${ownFile}`, `discard ${ownFile}`]);

// Another organization's batch and catalog row are not found by the one call
// that carries the caller's organization and actor.
refuseForeignIds(
  world,
  new Map([
    [foreignImportId, 'import_not_found'],
    [foreignCatalogId, 'catalog_article_not_found'],
  ]),
);
await assertRefused(world, [confirm, abandon], { success: false, error: 'import_not_found' }, 'one-call');
await assertRefused(world, [adopt], { success: false, error: 'catalog_article_not_found' }, 'one-call');
await assertRefused(world, [report], { success: false, error: 'import_not_found' }, 'reads');

// The search reads only the caller's organization.
assert.deepEqual(await search[1](), { success: true, options: [] });
