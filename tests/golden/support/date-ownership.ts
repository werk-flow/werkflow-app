// Fixture-date ownership for the audit battery (Tier 1, Stage C 2026-08-29).
//
// A no-grep audit run executes every wave in ONE shared world, so two specs
// claiming the same run-day offset for a uniqueness-constrained fixture
// (employment_conditions.valid_from, closure days, vacation/sickness
// overlaps, planning uniqueness) collide deterministically. The windows
// below encode the partition from docs/plans/wave-1-audit.md (+20…+69,
// including the R1 reconciliation reserve) and docs/plans/wave-2-audit.md
// (+70 onward, five days per slice). The module throws on overlapping
// registry entries at import and on any out-of-window claim at call time,
// so a new spec cannot silently squat on another spec's dates.
//
// Only uniqueness-constrained fixtures go through ownedBerlinDateAtOffset;
// facts without a uniqueness constraint use a purpose-specific bounded helper
// when one exists. Dispatch-visible visit dates use the panel-window helper
// below. Other facts, such as expiry horizons, use the unchecked formatter.

import { DISPATCH_OVERVIEW_MAX_OFFSET_DAYS } from "@/lib/dispatch/types";

type OffsetRange = { readonly from: number; readonly to: number };

const AUDIT_DATE_WINDOWS = {
  "a1-grundstock": [
    { from: 20, to: 24 },
    { from: 65, to: 65 },
  ],
  "a2-kunden": [
    { from: 25, to: 29 },
    { from: 66, to: 66 },
  ],
  "a3-personal": [
    { from: 30, to: 34 },
    { from: 67, to: 67 },
  ],
  "a4-abwesenheit": [
    { from: 35, to: 39 },
    { from: 68, to: 69 },
  ],
  "a5-aufgaben-qualifikationen": [{ from: 40, to: 44 }],
  "a6-planung": [{ from: 45, to: 54 }],
  "a7-einsaetze": [{ from: 55, to: 64 }],
  "p1-13": [{ from: 70, to: 74 }],
  "p1-14": [{ from: 75, to: 79 }],
  "p1-15": [{ from: 80, to: 84 }],
  "p1-16": [{ from: 85, to: 89 }],
  "p1-17": [{ from: 90, to: 94 }],
  "p1-18": [{ from: 95, to: 99 }],
  "p1-19": [{ from: 100, to: 104 }],
  "p1-20": [{ from: 105, to: 109 }],
  "p1-21": [{ from: 110, to: 114 }],
} as const satisfies Record<string, readonly OffsetRange[]>;

export type AuditSpecName = keyof typeof AUDIT_DATE_WINDOWS;

function assertDisjointWindows(): void {
  const claims = new Map<number, string>();
  for (const [spec, ranges] of Object.entries(AUDIT_DATE_WINDOWS)) {
    for (const range of ranges) {
      for (let offset = range.from; offset <= range.to; offset += 1) {
        const existing = claims.get(offset);
        if (existing) {
          throw new Error(
            `Audit date-ownership registry overlap: run-day offset +${offset} is claimed by both "${existing}" and "${spec}". Fix the registry (and the wave audit doc) before running anything.`,
          );
        }
        claims.set(offset, spec);
      }
    }
  }
}
assertDisjointWindows();

/** Formats run-day + offset as a Berlin-calendar YYYY-MM-DD date. */
export function berlinDateAtOffset(offsetDays: number): string {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const berlinToday = formatter.format(new Date());
  const date = new Date(`${berlinToday}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/** Formats a date that the manager dispatch overview can display. */
export function dispatchOverviewBerlinDateAtOffset(offsetDays: number): string {
  if (
    !Number.isInteger(offsetDays) ||
    offsetDays < 0 ||
    offsetDays > DISPATCH_OVERVIEW_MAX_OFFSET_DAYS
  ) {
    throw new Error(
      `Dispatch overview offset must be an integer from 0 through ${DISPATCH_OVERVIEW_MAX_OFFSET_DAYS}; received ${offsetDays}.`,
    );
  }
  return berlinDateAtOffset(offsetDays);
}

/**
 * The checked variant for uniqueness-constrained fixtures: throws unless the
 * claiming spec owns the offset in the registry above.
 */
export function ownedBerlinDateAtOffset(
  spec: AuditSpecName,
  offsetDays: number,
): string {
  const owned = AUDIT_DATE_WINDOWS[spec].some(
    (range) => offsetDays >= range.from && offsetDays <= range.to,
  );
  if (!owned) {
    const windows = AUDIT_DATE_WINDOWS[spec]
      .map((range) =>
        range.from === range.to
          ? `+${range.from}`
          : `+${range.from}…+${range.to}`,
      )
      .join(", ");
    throw new Error(
      `Spec "${spec}" claimed run-day offset +${offsetDays} for a uniqueness-constrained fixture, but owns only ${windows} (docs/plans/wave-1-audit.md / wave-2-audit.md). Pick a date inside the owned window or renegotiate the partition in the docs first.`,
    );
  }
  return berlinDateAtOffset(offsetDays);
}
