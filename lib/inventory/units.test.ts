import { describe, expect, test } from 'bun:test';
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
      'Stange',
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
