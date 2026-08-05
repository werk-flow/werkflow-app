// German public holidays per Bundesland, computed in code (owner decision,
// P1-04): no external holiday API — the dataset is deterministic law (fixed
// dates plus Easter-derived dates) and is unit-tested against the official
// lists so drift fails CI. One-off regional exceptions (e.g. Augsburger
// Friedensfest) are covered operationally via organization closure days.
//
// WerkFlow records the organization's *chosen* regional calendar and shows its
// effect on target time. It makes no claim of legal correctness.

export type HolidayRegion =
  | 'BW'
  | 'BY'
  | 'BY_OHNE_MARIAE'
  | 'BE'
  | 'BB'
  | 'HB'
  | 'HH'
  | 'HE'
  | 'MV'
  | 'NI'
  | 'NW'
  | 'RP'
  | 'SL'
  | 'SN'
  | 'ST'
  | 'SH'
  | 'TH';

export const HOLIDAY_REGIONS: HolidayRegion[] = [
  'BW',
  'BY',
  'BY_OHNE_MARIAE',
  'BE',
  'BB',
  'HB',
  'HH',
  'HE',
  'MV',
  'NI',
  'NW',
  'RP',
  'SL',
  'SN',
  'ST',
  'SH',
  'TH',
];

export const HOLIDAY_REGION_LABELS: Record<HolidayRegion, string> = {
  BW: 'Baden-Württemberg',
  BY: 'Bayern (mit Mariä Himmelfahrt)',
  BY_OHNE_MARIAE: 'Bayern (ohne Mariä Himmelfahrt)',
  BE: 'Berlin',
  BB: 'Brandenburg',
  HB: 'Bremen',
  HH: 'Hamburg',
  HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen',
  NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz',
  SL: 'Saarland',
  SN: 'Sachsen',
  ST: 'Sachsen-Anhalt',
  SH: 'Schleswig-Holstein',
  TH: 'Thüringen',
};

export function isHolidayRegion(value: string): value is HolidayRegion {
  return (HOLIDAY_REGIONS as string[]).includes(value);
}

export type PublicHoliday = {
  // ISO calendar date (YYYY-MM-DD); holidays are date facts, not timestamps.
  date: string;
  name: string;
};

function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Easter Sunday (Gregorian) via the Meeus/Jones/Butcher algorithm.
 * Returns { month, day } (1-based month).
 */
export function getEasterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function easterOffsetIso(year: number, offsetDays: number): string {
  const easter = getEasterSunday(year);
  // Date.UTC arithmetic keeps this independent of the host time zone.
  const ms = Date.UTC(year, easter.month - 1, easter.day) + offsetDays * 86_400_000;
  const date = new Date(ms);
  return toIsoDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate()
  );
}

/** Buß- und Bettag: the Wednesday before November 23. */
function bussUndBettagIso(year: number): string {
  const nov23Weekday = new Date(Date.UTC(year, 10, 23)).getUTCDay(); // 0 = Sunday
  // Days back from Nov 23 to the previous Wednesday (weekday 3), at least 1.
  const daysBack = ((nov23Weekday - 3 + 7) % 7) || 7;
  const ms = Date.UTC(year, 10, 23) - daysBack * 86_400_000;
  const date = new Date(ms);
  return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

const ALL_REGIONS = new Set<HolidayRegion>(HOLIDAY_REGIONS);

type HolidayRule = {
  name: string;
  regions: Set<HolidayRegion>;
  resolve: (year: number) => string;
};

const HOLIDAY_RULES: HolidayRule[] = [
  {
    name: 'Neujahr',
    regions: ALL_REGIONS,
    resolve: (year) => toIsoDate(year, 1, 1),
  },
  {
    name: 'Heilige Drei Könige',
    regions: new Set(['BW', 'BY', 'BY_OHNE_MARIAE', 'ST']),
    resolve: (year) => toIsoDate(year, 1, 6),
  },
  {
    name: 'Internationaler Frauentag',
    regions: new Set(['BE', 'MV']),
    resolve: (year) => toIsoDate(year, 3, 8),
  },
  {
    name: 'Karfreitag',
    regions: ALL_REGIONS,
    resolve: (year) => easterOffsetIso(year, -2),
  },
  {
    name: 'Ostersonntag',
    regions: new Set(['BB']),
    resolve: (year) => easterOffsetIso(year, 0),
  },
  {
    name: 'Ostermontag',
    regions: ALL_REGIONS,
    resolve: (year) => easterOffsetIso(year, 1),
  },
  {
    name: 'Tag der Arbeit',
    regions: ALL_REGIONS,
    resolve: (year) => toIsoDate(year, 5, 1),
  },
  {
    name: 'Christi Himmelfahrt',
    regions: ALL_REGIONS,
    resolve: (year) => easterOffsetIso(year, 39),
  },
  {
    name: 'Pfingstsonntag',
    regions: new Set(['BB']),
    resolve: (year) => easterOffsetIso(year, 49),
  },
  {
    name: 'Pfingstmontag',
    regions: ALL_REGIONS,
    resolve: (year) => easterOffsetIso(year, 50),
  },
  {
    name: 'Fronleichnam',
    regions: new Set(['BW', 'BY', 'BY_OHNE_MARIAE', 'HE', 'NW', 'RP', 'SL']),
    resolve: (year) => easterOffsetIso(year, 60),
  },
  {
    name: 'Mariä Himmelfahrt',
    regions: new Set(['BY', 'SL']),
    resolve: (year) => toIsoDate(year, 8, 15),
  },
  {
    name: 'Weltkindertag',
    regions: new Set(['TH']),
    resolve: (year) => toIsoDate(year, 9, 20),
  },
  {
    name: 'Tag der Deutschen Einheit',
    regions: ALL_REGIONS,
    resolve: (year) => toIsoDate(year, 10, 3),
  },
  {
    name: 'Reformationstag',
    regions: new Set(['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']),
    resolve: (year) => toIsoDate(year, 10, 31),
  },
  {
    name: 'Allerheiligen',
    regions: new Set(['BW', 'BY', 'BY_OHNE_MARIAE', 'NW', 'RP', 'SL']),
    resolve: (year) => toIsoDate(year, 11, 1),
  },
  {
    name: 'Buß- und Bettag',
    regions: new Set(['SN']),
    resolve: bussUndBettagIso,
  },
  {
    name: '1. Weihnachtstag',
    regions: ALL_REGIONS,
    resolve: (year) => toIsoDate(year, 12, 25),
  },
  {
    name: '2. Weihnachtstag',
    regions: ALL_REGIONS,
    resolve: (year) => toIsoDate(year, 12, 26),
  },
];

const holidayCache = new Map<string, Map<string, string>>();

/** Map of ISO date → holiday name for one region and year (memoized). */
export function getHolidayMapForYear(
  region: HolidayRegion,
  year: number
): Map<string, string> {
  const cacheKey = `${region}-${year}`;
  const cached = holidayCache.get(cacheKey);
  if (cached) return cached;

  const map = new Map<string, string>();
  for (const rule of HOLIDAY_RULES) {
    if (!rule.regions.has(region)) continue;
    map.set(rule.resolve(year), rule.name);
  }
  holidayCache.set(cacheKey, map);
  return map;
}

export function getPublicHolidaysForYear(
  region: HolidayRegion,
  year: number
): PublicHoliday[] {
  return [...getHolidayMapForYear(region, year).entries()]
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Holiday name for an ISO date in the given region, or null. */
export function getHolidayName(
  region: HolidayRegion,
  dateIso: string
): string | null {
  const year = Number(dateIso.slice(0, 4));
  if (!Number.isInteger(year)) return null;
  return getHolidayMapForYear(region, year).get(dateIso) ?? null;
}
