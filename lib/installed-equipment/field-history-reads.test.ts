import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

import type { FieldHistoryEntry, FieldHistoryEquipment, FieldHistoryVisit } from './field-history-reads';

// Every key the technician's history carries. A new field fails here first, so
// adding one is a decision about what leaves the office (werk-flow/werkflow-planning#468).
type Keys<T> = T extends unknown ? keyof T : never;
type HistoryKeys =
  | Keys<FieldHistoryEntry>
  | keyof FieldHistoryEquipment
  | keyof FieldHistoryVisit['defects'][number]
  | keyof FieldHistoryVisit['measurements'][number];
type CustomerSafeKey =
  | 'kind'
  | 'key'
  | 'date'
  | 'outcome'
  | 'equipment'
  | 'defects'
  | 'measurements'
  | 'predecessor'
  | 'successor'
  | 'equipmentNumber'
  | 'name'
  | 'isPredecessor'
  | 'description'
  | 'location'
  | 'severity'
  | 'state'
  | 'quantity'
  | 'unit';
const onlyCustomerSafeKeys: [Exclude<HistoryKeys, CustomerSafeKey>] extends [never] ? true : false = true;

test('the field history type carries only customer-safe fields', () => {
  expect(onlyCustomerSafeKeys).toBe(true);
});

test('the field history and manuals of an Anlage reach only the assigned technician of its job', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/equipment-field-history-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
