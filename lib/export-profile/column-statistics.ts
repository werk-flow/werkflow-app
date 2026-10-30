import { createHmac, randomBytes } from 'node:crypto';
import { maskShape } from './personal-data';

// Per-column statistics of one table. Raw values live only in this process:
// a column keeps salted hashes (for distinct counts and relations), counts,
// lengths, masked shapes and years, never a value.

export type ValueKind =
  | 'integer'
  | 'digit_code'
  | 'decimal'
  | 'date'
  | 'datetime'
  | 'time'
  | 'boolean'
  | 'email'
  | 'phone'
  | 'iban'
  | 'text';

export type ColumnType = ValueKind | 'mixed' | 'empty';

type YearRange = { from: number; to: number };

export type ColumnProfile = {
  name: string;
  type: ColumnType;
  kinds: Partial<Record<ValueKind, number>>;
  rows: number;
  nonEmpty: number;
  emptyRate: number;
  distinct: number;
  minLength: number | null;
  maxLength: number | null;
  example: string | null;
  distinctShapes: number;
  years: YearRange | null;
  unique: boolean;
  keyLike: boolean;
};

export type ClassifiedValue = { kind: ValueKind; year?: number };

const SHAPE_LIMIT = 500;
const DOMINANT_SHARE = 0.95;
const KEY_NAME = /(?:^id$|_id$|[a-z]Id$|ID$|nr\.?$|nummer$|^nr\b|schl(?:ü|ue)ssel|^key$|code$|kennung)/i;

/** A random salt for one run. It never leaves the process. */
export function newRunSalt(): Uint8Array {
  return randomBytes(32);
}

export class ColumnAccumulator {
  name: string;
  readonly hashes = new Set<string>();
  private readonly salt: Uint8Array;
  private readonly kindCounts = new Map<ValueKind, number>();
  private readonly shapes = new Map<string, number>();
  private nonEmpty = 0;
  private minLength: number | null = null;
  private maxLength: number | null = null;
  private minYear: number | null = null;
  private maxYear: number | null = null;
  private hasWhitespace = false;
  private everyValueHasDigit = true;

  constructor(name: string, salt: Uint8Array) {
    this.name = name;
    this.salt = salt;
  }

  /** The salted hash of a value, comparable across columns of one run. */
  hashOf(value: string): string {
    return createHmac('sha256', this.salt).update(value.trim()).digest('base64').slice(0, 22);
  }

  /** Records one cell. `known` carries a kind and year a binary format already knows (an Excel date). */
  add(value: string, known?: ClassifiedValue): void {
    const trimmed = value.trim();
    if (trimmed === '') return;
    this.nonEmpty += 1;
    this.hashes.add(this.hashOf(trimmed));
    const classified = known ?? classifyValue(trimmed);
    this.kindCounts.set(classified.kind, (this.kindCounts.get(classified.kind) ?? 0) + 1);
    if (classified.year !== undefined) {
      this.minYear = Math.min(this.minYear ?? classified.year, classified.year);
      this.maxYear = Math.max(this.maxYear ?? classified.year, classified.year);
    }
    if (/\s/.test(trimmed)) this.hasWhitespace = true;
    if (!/\d/.test(trimmed)) this.everyValueHasDigit = false;
    // A cell whose kind the format already knows (an Excel date serial) has
    // no meaningful length or shape.
    if (known) return;
    const length = [...trimmed].length;
    this.minLength = Math.min(this.minLength ?? length, length);
    this.maxLength = Math.max(this.maxLength ?? length, length);
    const shape = maskShape(trimmed);
    if (this.shapes.has(shape) || this.shapes.size < SHAPE_LIMIT)
      this.shapes.set(shape, (this.shapes.get(shape) ?? 0) + 1);
  }

  /** True when the column holds this value. */
  has(value: string): boolean {
    return this.hashes.has(this.hashOf(value));
  }

  profile(rows: number): ColumnProfile {
    const type = dominantType(this.kindCounts, this.nonEmpty);
    const unique = this.nonEmpty >= 3 && this.hashes.size === this.nonEmpty;
    return {
      name: this.name,
      type,
      kinds: Object.fromEntries(this.kindCounts),
      rows,
      nonEmpty: this.nonEmpty,
      emptyRate: rows === 0 ? 0 : Math.round(((rows - this.nonEmpty) / rows) * 1000) / 1000,
      distinct: this.hashes.size,
      minLength: this.minLength,
      maxLength: this.maxLength,
      example: mostFrequentShape(this.shapes),
      distinctShapes: this.shapes.size,
      years: this.minYear === null || this.maxYear === null ? null : { from: this.minYear, to: this.maxYear },
      unique,
      keyLike: isKeyLike(
        { type, unique, name: this.name, maxLength: this.maxLength },
        this.hasWhitespace,
        this.everyValueHasDigit,
      ),
    };
  }
}

/**
 * A key names itself (KdNr, ArtikelNr, id) or holds unique numbers or short
 * codes. A unique text column counts only when every value carries a digit,
 * so a small sample's unique first names do not look like a key.
 */
function isKeyLike(
  column: { type: ColumnType; unique: boolean; name: string; maxLength: number | null },
  hasWhitespace: boolean,
  everyValueHasDigit: boolean,
): boolean {
  if (!['integer', 'digit_code', 'text', 'mixed'].includes(column.type)) return false;
  if (KEY_NAME.test(column.name)) return true;
  if (!column.unique) return false;
  if (column.type === 'integer' || column.type === 'digit_code') return true;
  return everyValueHasDigit && !hasWhitespace && (column.maxLength ?? 0) <= 24;
}

function mostFrequentShape(shapes: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [shape, count] of shapes) {
    if (count > bestCount) [best, bestCount] = [shape, count];
  }
  return best;
}

function dominantType(counts: ReadonlyMap<ValueKind, number>, nonEmpty: number): ColumnType {
  if (nonEmpty === 0) return 'empty';
  const share = (...kinds: ValueKind[]): number =>
    kinds.reduce((sum, kind) => sum + (counts.get(kind) ?? 0), 0) / nonEmpty;
  for (const [kind, count] of counts) {
    if (count / nonEmpty >= DOMINANT_SHARE) return kind;
  }
  if (share('integer', 'digit_code') >= DOMINANT_SHARE) return 'digit_code';
  if (share('integer', 'decimal') >= DOMINANT_SHARE) return 'decimal';
  if (share('date', 'datetime') >= DOMINANT_SHARE) return 'datetime';
  return 'mixed';
}

const BOOLEAN_WORDS = new Set(['ja', 'nein', 'j', 'n', 'true', 'false', 'wahr', 'falsch', 'yes', 'no']);
const GERMAN_DECIMAL = /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+),\d+$/;
const ENGLISH_DECIMAL = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d+$/;
const TIME = /^\d{1,3}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** The kind of one trimmed, non-empty value, and its year when it is a date. */
export function classifyValue(value: string): ClassifiedValue {
  if (/^[+-]?\d+$/.test(value)) return { kind: /^0\d/.test(value) ? 'digit_code' : 'integer' };
  if (GERMAN_DECIMAL.test(value) || ENGLISH_DECIMAL.test(value)) return { kind: 'decimal' };
  const dated = classifyDate(value);
  if (dated) return dated;
  if (TIME.test(value)) return { kind: 'time' };
  if (BOOLEAN_WORDS.has(value.toLowerCase())) return { kind: 'boolean' };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return { kind: 'email' };
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value.replace(/\s/g, ''))) return { kind: 'iban' };
  if (isPhoneNumber(value)) return { kind: 'phone' };
  return { kind: 'text' };
}

function isPhoneNumber(value: string): boolean {
  if (!/^(?:\+|00|0|\(0)[\d\s/().-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, '').length;
  return digits >= 6 && digits <= 16 && /[\s/().+-]/.test(value);
}

function classifyDate(value: string): ClassifiedValue | null {
  const [datePart = '', ...rest] = value.split(/[ T]/);
  const timePart = rest.join(' ');
  if (timePart !== '' && !TIME.test(timePart)) return null;
  const year = yearOfDate(datePart);
  if (year === null) return null;
  return { kind: timePart === '' ? 'date' : 'datetime', year };
}

function yearOfDate(value: string): number | null {
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const parts = german
    ? { day: german[1], month: german[2], year: german[3] }
    : iso
      ? { day: iso[3], month: iso[2], year: iso[1] }
      : slashed
        ? { day: slashed[1], month: slashed[2], year: slashed[3] }
        : null;
  if (!parts) return null;
  const day = Number(parts.day);
  const month = Number(parts.month);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const year = Number(parts.year);
  if (String(parts.year).length === 2) return year < 50 ? 2000 + year : 1900 + year;
  return year;
}
