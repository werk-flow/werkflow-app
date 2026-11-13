// The CSV import actions over the in-memory database: a field worker is
// refused the repeat check, the preview and the booking before any database
// access; Büro does not book another organization's batch, which the one
// booking call refuses with the caller's organization and actor; another
// organization's booking of the same file is no repeat; and a repeat names the
// person who booked, not the one who previewed.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const foreignBatchId = '91000000-0000-4000-8000-000000000001';
const contentHash = 'b'.repeat(64);
const bookedHash = 'c'.repeat(64);
const previewerId = '31000000-0000-4000-8000-000000000002';
const bookerId = '31000000-0000-4000-8000-000000000003';

const world = installActionWorld({
  inventory_import_batches: [
    {
      id: foreignBatchId,
      organization_id: ORGANIZATION_B,
      content_hash: contentHash,
      completed_at: '2026-11-02T08:00:00.000Z',
      created_by: '31000000-0000-4000-8000-000000000001',
    },
    {
      id: '91000000-0000-4000-8000-000000000002',
      organization_id: ORGANIZATION_A,
      content_hash: bookedHash,
      completed_at: '2026-11-03T09:30:00.000Z',
      created_by: previewerId,
      booked_by: bookerId,
    },
  ],
  profiles: [
    { id: previewerId, first_name: 'Vera', last_name: 'Vorschau', email: 'vera@example.test' },
    { id: bookerId, first_name: 'Bernd', last_name: 'Buchung', email: 'bernd@example.test' },
  ],
});
const { bookInventoryImport, findInventoryImportRepeat, previewInventoryImport } = await import(
  '@/lib/inventory/import-actions'
);

const preview = [
  'previewInventoryImport',
  () =>
    previewInventoryImport({
      fileName: 'nordrohr.csv',
      contentHash,
      mode: 'stock',
      columnMapping: { name: 'Bezeichnung' },
      rows: [{ name: 'Kupferrohr 15 mm', unit: 'm', quantity: 5, locationName: 'Hauptlager' }],
    }),
] as const;
const book = ['bookInventoryImport', () => bookInventoryImport({ batchId: foreignBatchId })] as const;
const repeat = ['findInventoryImportRepeat', () => findInventoryImportRepeat({ contentHash })] as const;

// A field worker never reaches the import, not even its repeat check.
signInAs(world, 'employee');
await assertRefused(world, [preview, book, repeat], { success: false, error: 'not_authorized' }, 'none');

// Büro books only its own organization's batch: the booking call carries the
// caller's organization and actor, so another organization's batch is not found.
signInAs(world, 'buero');
refuseForeignIds(world, new Map([[foreignBatchId, 'batch_not_found']]));
await assertRefused(world, [book], { success: false, error: 'batch_not_found' }, 'one-call');
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);
assert.equal(world.rpcCalls[0]?.args.p_actor_id, CALLER_ID);

// Another organization's booking of the same file is no repeat.
assert.deepEqual(await repeat[1](), { success: true, repeat: null });

// A repeat names the person who booked the file, not the one who previewed it.
assert.deepEqual(await findInventoryImportRepeat({ contentHash: bookedHash }), {
  success: true,
  repeat: { bookedAt: '2026-11-03T09:30:00.000Z', bookedBy: 'Bernd Buchung' },
});
