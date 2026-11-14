// The one list of units. An article's unit is its base unit: stock, job
// material, prices and offers count in it. The database refuses an article
// unit outside this list; the list in its newest migration equals this one
// (units.test.ts), so a new unit comes with a migration that replaces it.
//
// A code is stable: offer and order lines keep code and label as a snapshot.
// A unit that is no longer wanted is retired (kept here, no longer offered in
// forms), never renamed or deleted.

export type InventoryUnitDefinition = {
  code: string;
  /** The long German label, for forms and lists. */
  label: string;
  /** The short German label, for documents and narrow cells. */
  shortLabel: string;
  /** A retired unit stays valid on existing rows and is no longer offered. */
  retired: boolean;
};

export const INVENTORY_UNITS = [
  { code: 'piece', label: 'Stück', shortLabel: 'Stk', retired: false },
  { code: 'meter', label: 'Meter', shortLabel: 'm', retired: false },
  { code: 'square_meter', label: 'Quadratmeter', shortLabel: 'm²', retired: false },
  { code: 'cubic_meter', label: 'Kubikmeter', shortLabel: 'm³', retired: false },
  { code: 'kilometer', label: 'Kilometer', shortLabel: 'km', retired: false },
  { code: 'liter', label: 'Liter', shortLabel: 'l', retired: false },
  { code: 'kilogram', label: 'Kilogramm', shortLabel: 'kg', retired: false },
  { code: 'hour', label: 'Stunde', shortLabel: 'Std', retired: false },
  { code: 'day', label: 'Tag', shortLabel: 'Tag', retired: false },
  { code: 'flat_rate', label: 'Pauschal', shortLabel: 'psch', retired: false },
  { code: 'roll', label: 'Rolle', shortLabel: 'Rolle', retired: false },
  { code: 'package', label: 'Packung', shortLabel: 'Pkg', retired: false },
  { code: 'box', label: 'Karton', shortLabel: 'Ktn', retired: false },
  { code: 'set', label: 'Set', shortLabel: 'Satz', retired: false },
  { code: 'pair', label: 'Paar', shortLabel: 'Paar', retired: false },
  { code: 'sack', label: 'Sack', shortLabel: 'Sack', retired: false },
  { code: 'cartridge', label: 'Kartusche', shortLabel: 'Kart', retired: false },
  { code: 'bundle', label: 'Bund', shortLabel: 'Bd', retired: false },
  { code: 'pallet', label: 'Palette', shortLabel: 'Pal', retired: false },
  { code: 'rod', label: 'Stange', shortLabel: 'Stg', retired: false },
  { code: 'coil', label: 'Ring', shortLabel: 'Ring', retired: false },
] as const satisfies readonly InventoryUnitDefinition[];

export type InventoryUnitCode = (typeof INVENTORY_UNITS)[number]['code'];

/** The units a form offers: every unit that is not retired. */
export const OFFERED_INVENTORY_UNITS: readonly InventoryUnitDefinition[] = INVENTORY_UNITS.filter(
  (unit) => !unit.retired,
);

export function isInventoryUnitCode(value: string): value is InventoryUnitCode {
  return INVENTORY_UNITS.some((unit) => unit.code === value);
}

// Typed input after trimming, lower-casing, dropping a final dot and folding umlauts.
const UNIT_ALIASES: Record<string, InventoryUnitCode> = {
  stueck: 'piece',
  stuck: 'piece',
  stk: 'piece',
  st: 'piece',
  piece: 'piece',
  pieces: 'piece',
  meter: 'meter',
  m: 'meter',
  quadratmeter: 'square_meter',
  qm: 'square_meter',
  m2: 'square_meter',
  'm²': 'square_meter',
  square_meter: 'square_meter',
  kubikmeter: 'cubic_meter',
  cbm: 'cubic_meter',
  m3: 'cubic_meter',
  'm³': 'cubic_meter',
  cubic_meter: 'cubic_meter',
  kilometer: 'kilometer',
  km: 'kilometer',
  liter: 'liter',
  l: 'liter',
  kilogramm: 'kilogram',
  kilogram: 'kilogram',
  kg: 'kilogram',
  stunde: 'hour',
  stunden: 'hour',
  std: 'hour',
  h: 'hour',
  hour: 'hour',
  tag: 'day',
  tage: 'day',
  day: 'day',
  pauschal: 'flat_rate',
  pauschale: 'flat_rate',
  psch: 'flat_rate',
  flat_rate: 'flat_rate',
  rolle: 'roll',
  roll: 'roll',
  packung: 'package',
  paket: 'package',
  pkg: 'package',
  package: 'package',
  karton: 'box',
  box: 'box',
  set: 'set',
  satz: 'set',
  paar: 'pair',
  pair: 'pair',
  sack: 'sack',
  kartusche: 'cartridge',
  cartridge: 'cartridge',
  bund: 'bundle',
  bundle: 'bundle',
  palette: 'pallet',
  pallet: 'pallet',
  stange: 'rod',
  stangen: 'rod',
  stg: 'rod',
  rod: 'rod',
  ring: 'coil',
  ringe: 'coil',
  coil: 'coil',
};

/**
 * The unit code typed text names, or `null` when it names none. Empty text is
 * no unit either: a guessed Stück books the wrong quantity.
 */
export function normalizeInventoryUnitInput(value: string | null | undefined): InventoryUnitCode | null {
  const folded = (value ?? '')
    .trim()
    .toLowerCase()
    // An abbreviation keeps its meaning without its dot: „Stk.“, „Std.“, „Pkg.“.
    .replace(/\.$/, '')
    .replace(/ü/g, 'ue')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe');
  return Object.hasOwn(UNIT_ALIASES, folded) ? (UNIT_ALIASES[folded] ?? null) : null;
}
