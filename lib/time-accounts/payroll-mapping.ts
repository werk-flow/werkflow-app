import { TIME_ACTIVITY_LABELS, type TimeSegmentKind } from '@/lib/time-tracking/types';
import type { PayrollValueKind } from './types';

/**
 * The payroll code mapping: one Lohnart code per classification the export
 * writes. The export refuses a mapping version without a code for every row
 * here (`missing_code_mapping` in reserve_payroll_export), so the rows are
 * every value kind and, for the credited time, every activity.
 */
export type PayrollCodeRow = {
  /** The form field name: the value kind, for credited time with its activity. */
  key: string;
  valueKind: PayrollValueKind;
  activityKind: TimeSegmentKind | null;
  label: string;
  defaultCode: string;
};

/** The JSON shape of one code row of `confirm_payroll_mapping_version`. */
export type PayrollCodeMapping = {
  value_kind: PayrollValueKind;
  activity_kind: TimeSegmentKind | null;
  output_code: string;
};

/** A payroll program's Lohnart is a short number or abbreviation. */
export const PAYROLL_CODE_MAX_LENGTH = 40;

function payrollCodeKey(valueKind: PayrollValueKind, activityKind: TimeSegmentKind | null): string {
  return activityKind ? `${valueKind}.${activityKind}` : valueKind;
}

const row = (
  valueKind: PayrollValueKind,
  label: string,
  defaultCode: string,
  activityKind: TimeSegmentKind | null = null,
): PayrollCodeRow => ({
  key: payrollCodeKey(valueKind, activityKind),
  valueKind,
  activityKind,
  label,
  defaultCode,
});

const credited = (activityKind: TimeSegmentKind, defaultCode: string): PayrollCodeRow =>
  row('credited_activity', `Gewertet: ${TIME_ACTIVITY_LABELS[activityKind]}`, defaultCode, activityKind);

/** In the order the office reads a month: time, absences, classifications, account. */
export const PAYROLL_CODE_ROWS: readonly PayrollCodeRow[] = [
  row('target', 'Sollzeit', 'SOLL'),
  row('source_attendance', 'Anwesenheit erfasst', 'ANWESEND'),
  row('effective_attendance', 'Anwesenheit gewertet', 'EFFEKTIV'),
  credited('work', 'ARBEIT'),
  credited('travel', 'FAHRT'),
  credited('break', 'PAUSE'),
  credited('standby', 'BEREITSCHAFT'),
  credited('callout', 'EINSATZ'),
  credited('internal_activity', 'INTERN'),
  row('vacation', 'Urlaub', 'URLAUB'),
  row('sickness', 'Krankheit', 'KRANK'),
  row('overtime', 'Mehrarbeit', 'MEHRARBEIT'),
  row('night_supplement', 'Nachtarbeit', 'NACHT'),
  row('sunday_supplement', 'Sonntagsarbeit', 'SONNTAG'),
  row('public_holiday_supplement', 'Feiertagsarbeit', 'FEIERTAG'),
  row('manual_adjustment', 'Korrektur', 'KORREKTUR'),
  row('expiry', 'Verfall', 'VERFALL'),
  row('payout', 'Auszahlung', 'AUSZAHLUNG'),
  row('opening_balance', 'Anfangssaldo', 'START'),
  row('closing_balance', 'Schlusssaldo', 'SALDO'),
];

/** The codes the form shows: the stored version's, or the proposal before the first version. */
export function payrollCodesByKey(stored: readonly PayrollCodeMapping[] | null): Record<string, string> {
  const storedByKey = new Map(
    (stored ?? []).map((mapping) => [
      payrollCodeKey(mapping.value_kind, mapping.activity_kind),
      mapping.output_code,
    ]),
  );
  return Object.fromEntries(
    PAYROLL_CODE_ROWS.map((codeRow) => [
      codeRow.key,
      stored ? (storedByKey.get(codeRow.key) ?? '') : codeRow.defaultCode,
    ]),
  );
}

/** The rows whose typed code is empty or too long, in the order of the table. */
export function invalidPayrollCodeKeys(codes: Readonly<Record<string, string | undefined>>): string[] {
  return PAYROLL_CODE_ROWS.filter((codeRow) => {
    const code = codes[codeRow.key]?.trim() ?? '';
    return code === '' || code.length > PAYROLL_CODE_MAX_LENGTH;
  }).map((codeRow) => codeRow.key);
}

/** The mapping rows of a complete set of typed codes; null when a code is missing or too long. */
export function toPayrollCodeMappings(
  codes: Readonly<Record<string, string | undefined>>,
): PayrollCodeMapping[] | null {
  if (invalidPayrollCodeKeys(codes).length > 0) return null;
  return PAYROLL_CODE_ROWS.map((codeRow) => ({
    value_kind: codeRow.valueKind,
    activity_kind: codeRow.activityKind,
    output_code: codes[codeRow.key]?.trim() ?? '',
  }));
}

/**
 * The code table an Admin edits: the version it was read from, its codes then,
 * the typed codes, and whether a save of them still runs.
 */
export type PayrollMappingDraft = {
  basedOnVersion: number | null;
  readCodes: Readonly<Record<string, string>>;
  codes: Readonly<Record<string, string>>;
  saving: boolean;
};

const sameCodes = (
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean => PAYROLL_CODE_ROWS.every((codeRow) => (left[codeRow.key] ?? '') === (right[codeRow.key] ?? ''));

/** Version numbers only grow, so a read of an older one is a refresh that arrived late. */
const isNewerVersion = (version: number | null, basedOn: number | null): boolean =>
  version !== null && (basedOn === null || version > basedOn);

/**
 * The draft after a read of the current mapping. Only a newer version replaces
 * the table, and only a table without edits. A table with unsaved edits keeps
 * them and the version they were read from, so their save is refused with
 * `stale_version` and its reload sentence instead of losing them to a live
 * refresh (werk-flow/werkflow-planning#360). While the own save runs, no read
 * replaces the table: its result says which version it made (`recordMappingSave`).
 */
export function followMappingVersion(
  draft: PayrollMappingDraft,
  current: { version: number | null; codes: Readonly<Record<string, string>> },
): PayrollMappingDraft {
  if (draft.saving || !isNewerVersion(current.version, draft.basedOnVersion)) return draft;
  if (!sameCodes(draft.codes, draft.readCodes)) return draft;
  return { basedOnVersion: current.version, readCodes: current.codes, codes: current.codes, saving: false };
}

/**
 * The draft after its own save of `saved.codes` was accepted as
 * `saved.version`. Codes typed while the save ran stay as edits based on that
 * version, so only a version another session commits later makes them stale.
 */
export function recordMappingSave(
  draft: PayrollMappingDraft,
  saved: { version: number; codes: Readonly<Record<string, string>> },
): PayrollMappingDraft {
  return { ...draft, basedOnVersion: saved.version, readCodes: saved.codes, saving: false };
}
