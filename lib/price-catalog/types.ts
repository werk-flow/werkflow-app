import type { InventoryUnitCode } from '@/lib/inventory/units';
import { z } from '@/lib/zod';

// A Leistung is a priced service without an article: labour by the hour,
// travel, a flat service, a fee or subcontracted work. Its prices are dated
// versions (supabase/migrations/20261201140000_keep_dated_leistung_prices.sql).

export const LEISTUNG_KINDS = ['arbeit', 'anfahrt', 'pauschale', 'gebuehr', 'fremdleistung'] as const;
export type LeistungKind = (typeof LEISTUNG_KINDS)[number];
export const leistungKindSchema = z.enum(LEISTUNG_KINDS);

export const LEISTUNG_KIND_LABELS: Record<LeistungKind, string> = {
  arbeit: 'Arbeit',
  anfahrt: 'Anfahrt',
  pauschale: 'Pauschale',
  gebuehr: 'Gebühr',
  fremdleistung: 'Fremdleistung',
};

/** The German VAT rates a Leistung can carry, in basis points (1900 is 19 %). */
export const LEISTUNG_TAX_RATES = [1900, 700, 0] as const;
export type LeistungTaxRate = (typeof LEISTUNG_TAX_RATES)[number];

/** One dated price of a Leistung, in net cents per unit. Never changed once recorded. */
export type LeistungPriceVersion = {
  id: string;
  /** The first Berlin day the price applies, `YYYY-MM-DD`. */
  validFrom: string;
  salePriceCents: number;
  /** The internal cost per unit; `null` when the office keeps none. */
  costRateCents: number | null;
  recordedAt: string;
  /** A later recording for the same first day replaced this one. */
  superseded: boolean;
};

export type LeistungListEntry = {
  id: string;
  leistungNumber: string;
  name: string;
  description: string;
  kind: LeistungKind;
  /** `null` for a stored code outside the unit list („Einheit prüfen“). */
  unit: InventoryUnitCode | null;
  taxRateBasisPoints: number;
  archived: boolean;
  /** The version that applies on the day the list was read; `null` before the first one starts. */
  currentVersionId: string | null;
  /** The first day of the next coming price, if one is recorded. */
  nextValidFrom: string | null;
  /** Every version, latest first day first. */
  versions: LeistungPriceVersion[];
};
