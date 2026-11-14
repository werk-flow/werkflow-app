import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryRoot } from '../conventions/product-sources';
import {
  INVENTORY_UNITS,
  type InventoryUnitCode,
  normalizeInventoryUnitInput,
  OFFERED_INVENTORY_UNITS,
} from './units';

// Every alias the normalizer mapped before the unit list moved into units.ts.
const EARLIER_ALIASES: Record<string, InventoryUnitCode> = {
  stueck: 'piece',
  Stück: 'piece',
  stuck: 'piece',
  stk: 'piece',
  St: 'piece',
  piece: 'piece',
  pieces: 'piece',
  meter: 'meter',
  m: 'meter',
  rolle: 'roll',
  roll: 'roll',
  packung: 'package',
  paket: 'package',
  package: 'package',
  karton: 'box',
  box: 'box',
  set: 'set',
  paar: 'pair',
  pair: 'pair',
  liter: 'liter',
  l: 'liter',
  kilogramm: 'kilogram',
  kilogram: 'kilogram',
  KG: 'kilogram',
  sack: 'sack',
  kartusche: 'cartridge',
  cartridge: 'cartridge',
  bund: 'bundle',
  bundle: 'bundle',
  palette: 'pallet',
  pallet: 'pallet',
};

const ADDED_ALIASES: Record<string, InventoryUnitCode> = {
  Std: 'hour',
  Stunde: 'hour',
  psch: 'flat_rate',
  Pauschal: 'flat_rate',
  'm²': 'square_meter',
  qm: 'square_meter',
  'm³': 'cubic_meter',
  km: 'kilometer',
  Tag: 'day',
  Pkg: 'package',
  Satz: 'set',
  'Stk.': 'piece',
  'Std.': 'hour',
  Stange: 'rod',
  Stg: 'rod',
  Ring: 'coil',
};

describe('normalizeInventoryUnitInput', () => {
  test('maps every alias it mapped before, and the added units', () => {
    for (const [input, code] of Object.entries({ ...EARLIER_ALIASES, ...ADDED_ALIASES })) {
      expect(normalizeInventoryUnitInput(` ${input} `), input).toBe(code);
    }
  });

  test('maps every unit code to itself', () => {
    for (const unit of INVENTORY_UNITS) expect(normalizeInventoryUnitInput(unit.code)).toBe(unit.code);
  });

  test('returns unknown for text it cannot map and for no text, never Stück', () => {
    for (const input of [
      'Bogen',
      'Fass',
      '.',
      'm..',
      'constructor',
      'toString',
      '',
      '   ',
      null,
      undefined,
    ]) {
      expect(normalizeInventoryUnitInput(input), String(input)).toBeNull();
    }
  });
});

describe('the unit list', () => {
  test('codes and labels are unique, and a form offers every unit that is not retired', () => {
    expect(new Set(INVENTORY_UNITS.map((unit) => unit.code)).size).toBe(INVENTORY_UNITS.length);
    expect(new Set(INVENTORY_UNITS.map((unit) => unit.label)).size).toBe(INVENTORY_UNITS.length);
    expect(OFFERED_INVENTORY_UNITS.map((unit) => unit.code)).toEqual(
      INVENTORY_UNITS.filter((unit) => !unit.retired).map((unit) => unit.code),
    );
  });
});

// The database's unit guard holds its own copy of the list, because a trigger
// cannot read this file. The newest migration that defines the guard is the one
// in force.
function databaseUnitCodes(): string[] {
  const directory = join(repositoryRoot, 'supabase/migrations');
  const newest = readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => readFileSync(join(directory, file), 'utf8'))
    .filter((sql) => /function\s+app_private\.guard_inventory_item_unit\s*\(/.test(sql))
    .at(-1);
  const list = newest
    ? /v_units\s+constant\s+text\[\]\s*:=\s*array\[([^\]]*)\]/.exec(newest)?.[1]
    : undefined;
  return list === undefined ? [] : [...list.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '');
}

describe('the database unit list', () => {
  test('the unit guard of the newest migration allows exactly the units of this list', () => {
    expect(
      databaseUnitCodes().toSorted(),
      'Add or keep each unit in a migration that replaces app_private.guard_inventory_item_unit',
    ).toEqual(INVENTORY_UNITS.map((unit) => unit.code).toSorted());
  });
});
