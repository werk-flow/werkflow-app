import { expect, test } from 'bun:test';
import {
  DEFAULT_IDENTITY_REALTIME_TABLES,
  REALTIME_DELETION_TABLE,
  REALTIME_PUBLISHED_TABLES,
  REALTIME_TABLES,
  TRANSACTION_STAMPED_TABLES,
} from './tables';
import { validateRealtimePublication, type PublishedTableState } from './publication-contract';

const flags = { pubinsert: true, pubupdate: true, pubdelete: false, pubtruncate: false };
const tables: PublishedTableState[] = REALTIME_PUBLISHED_TABLES.map((tablename) => ({
  schemaname: 'public',
  tablename,
  replident: DEFAULT_IDENTITY_REALTIME_TABLES.some((table) => String(table) === tablename) ? 'd' : 'i',
  replident_index: `${tablename}_replident_idx`,
  replident_index_columns: 'id,organization_id',
  deletion_trigger_valid: tablename !== REALTIME_DELETION_TABLE,
  transaction_stamp_valid: true,
}));
test('requires every business table trigger and the dedicated transport table', () => {
  expect(validateRealtimePublication(tables, [flags])).toEqual([]);
  expect(
    validateRealtimePublication(
      tables.filter((table) => table.tablename !== REALTIME_DELETION_TABLE),
      [flags],
    ),
  ).not.toEqual([]);
  expect(
    validateRealtimePublication(
      tables.map((table) =>
        table.tablename === 'clients' ? { ...table, deletion_trigger_valid: false } : table,
      ),
      [flags],
    ),
  ).not.toEqual([]);
});
test('a table listed as transaction-stamped needs its updated_at default and trigger', () => {
  const unstamped = tables.map((table) =>
    table.tablename === 'jobs' ? { ...table, transaction_stamp_valid: false } : table,
  );
  expect(validateRealtimePublication(unstamped, [flags])).toEqual([
    'jobs: listed in TRANSACTION_STAMPED_TABLES without updated_at default now() and a BEFORE UPDATE trigger that sets it to now().',
  ]);
  const unlisted = tables.map((table) =>
    table.tablename === 'job_assignments' ? { ...table, transaction_stamp_valid: false } : table,
  );
  expect(validateRealtimePublication(unlisted, [flags])).toEqual([]);
});

test('the provider lists every table once', () => {
  expect(new Set(REALTIME_TABLES).size).toBe(REALTIME_TABLES.length);
  expect(new Set(TRANSACTION_STAMPED_TABLES).size).toBe(TRANSACTION_STAMPED_TABLES.length);
});

test('rejects unsafe transport operations and unexpected publication schemas', () => {
  for (const changed of [
    { ...flags, pubdelete: true },
    { ...flags, pubtruncate: true },
    { ...flags, pubinsert: false },
    { ...flags, pubupdate: false },
  ]) {
    expect(validateRealtimePublication(tables, [changed])).not.toEqual([]);
  }
  expect(
    validateRealtimePublication(
      [...tables, ...tables.slice(0, 1).map((table) => ({ ...table, schemaname: 'private' }))],
      [flags],
    ),
  ).not.toEqual([]);
});
test('retains minimal identities and forbids self-emitting cleanup notifications', () => {
  expect(
    validateRealtimePublication(
      tables.map((table) => (table.tablename === 'clients' ? { ...table, replident: 'f' } : table)),
      [flags],
    ),
  ).not.toEqual([]);
  expect(
    validateRealtimePublication(
      tables.map((table) =>
        table.tablename === REALTIME_DELETION_TABLE ? { ...table, deletion_trigger_valid: true } : table,
      ),
      [flags],
    ),
  ).not.toEqual([]);
});

test('rejects missing or multiple publication records', () => {
  expect(validateRealtimePublication(tables, [])).not.toEqual([]);
  expect(validateRealtimePublication(tables, [flags, flags])).not.toEqual([]);
});
