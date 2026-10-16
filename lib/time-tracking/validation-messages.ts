import type { FailureFacts, FailureSentence } from '@/lib/action-messages';
import { formatBerlin, formatBerlinTime } from '@/lib/utils';

// The one home of the time rule sentences (lib/time-tracking/validation.ts).
// A refusal carries a code and the instants it names, never the sentence: the
// server runs in UTC, so every time is formatted here as Berlin wall-clock
// time, on whichever side shows it. The failure types derive from the three
// sentence maps, so a code without a sentence cannot be written.

const OPEN_END = 'offen';

/** Codes whose sentence names nothing but the rule. */
const RULE_SENTENCES = {
  clock_in_during_break:
    'Während einer laufenden Pause kann kein manueller Arbeitsbeginn hinzugefügt werden.',
  clock_in_while_working:
    'Ein manueller Arbeitsbeginn ist nur möglich, wenn zu diesem Zeitpunkt keine laufende Arbeitszeit besteht.',
  clock_out_without_open_time:
    'Ein manuelles Ausstempeln ist nur möglich, wenn zu diesem Zeitpunkt bereits eine laufende Arbeitszeit oder Pause besteht.',
  pair_clock_in_not_before_clock_out: 'Die Einstempelzeit muss vor der Ausstempelzeit liegen.',
  pair_start_during_break: 'Während einer laufenden Pause kann kein manueller Arbeitsblock begonnen werden.',
  pair_start_while_working:
    'Ein manueller Arbeitsblock kann nur beginnen, wenn zu diesem Zeitpunkt keine laufende Arbeitszeit besteht.',
  break_start_not_before_end: 'Der Pausenbeginn muss vor dem Pausenende liegen.',
  manual_entries_missing: 'Mindestens ein Eintrag ist erforderlich.',
  manual_timestamp_invalid: 'Ungültiges Datum oder Uhrzeit.',
  manual_entry_in_future: 'Manuelle Einträge können nicht in der Zukunft liegen.',
  manual_entries_span_days: 'Manuelle Einträge müssen innerhalb desselben Tages liegen.',
  job_on_clock_out: 'Ein Auftrag kann nur einem Eintrag zugewiesen werden, der einen Arbeitsblock startet.',
  edited_entry_missing: 'Eintrag nicht gefunden.',
  edited_timestamp_in_future: 'Zeitstempel kann nicht in der Zukunft liegen.',
} satisfies Record<string, string>;

/** Codes whose sentence names one instant (`at`, an ISO timestamp). */
const INSTANT_SENTENCES = {
  entry_minute_taken: (at: string) =>
    `Ein Eintrag existiert bereits um ${formatBerlinTime(at)}. Der früheste verfügbare Zeitpunkt ist eine Minute später.`,
  sequence_clock_in_while_open: (at: string) =>
    `Ungültige Eintragsfolge um ${formatBerlinTime(at)}: Ein Arbeitsblock kann nur begonnen werden, wenn keine laufende Arbeitszeit oder Pause besteht.`,
  sequence_break_start_not_working: (at: string) =>
    `Ungültige Eintragsfolge um ${formatBerlinTime(at)}: Eine Pause kann nur während einer laufenden Arbeitszeit gestartet werden.`,
  sequence_break_end_not_on_break: (at: string) =>
    `Ungültige Eintragsfolge um ${formatBerlinTime(at)}: Eine Pause kann nur beendet werden, wenn zu diesem Zeitpunkt bereits eine Pause läuft.`,
  sequence_clock_out_while_clocked_out: (at: string) =>
    `Ungültige Eintragsfolge um ${formatBerlinTime(at)}: Ausstempeln ist nur während einer laufenden Arbeitszeit oder Pause möglich.`,
} satisfies Record<string, (at: string) => string>;

const endLabel = (end: string | null): string => (end === null ? OPEN_END : formatBerlinTime(end));

/** Codes whose sentence names an existing window (`start`, and `end` or null while it is open). */
const WINDOW_SENTENCES = {
  pair_overlaps_work: (start: string, end: string | null) =>
    `Der neue Zeitraum überschneidet sich mit einer bestehenden Arbeitszeit (${formatBerlin(start, 'dayMonthTime')} - ${endLabel(end)}). Manuelle Einträge müssen vollständig außerhalb bestehender Zeitfenster liegen.`,
  pair_overlaps_break: (start: string, end: string | null) =>
    `Der neue Zeitraum überschneidet sich mit einer bestehenden Pause (${formatBerlinTime(start)} - ${endLabel(end)}). Manuelle Arbeitszeiten müssen vollständig außerhalb bestehender Pausen liegen.`,
  clock_in_inside_work: (start: string, end: string | null) =>
    `Der gewählte Zeitpunkt liegt innerhalb einer bestehenden Arbeitszeit (${formatBerlinTime(start)} - ${endLabel(end)}).`,
  clock_in_inside_break: (start: string, end: string | null) =>
    `Der gewählte Zeitpunkt liegt innerhalb einer bestehenden Pause (${formatBerlinTime(start)} - ${endLabel(end)}). Manuelle Arbeitszeiten müssen vollständig außerhalb von Pausen liegen.`,
  clock_out_inside_closed_work: (start: string, end: string | null) =>
    `Der gewählte Zeitpunkt liegt innerhalb einer bestehenden abgeschlossenen Arbeitszeit (${formatBerlinTime(start)} - ${endLabel(end)}).`,
  clock_out_inside_closed_break: (start: string, end: string | null) =>
    `Der gewählte Zeitpunkt liegt innerhalb einer bestehenden abgeschlossenen Pause (${formatBerlinTime(start)} - ${endLabel(end)}).`,
} satisfies Record<string, (start: string, end: string | null) => string>;

type TimeRuleCode = keyof typeof RULE_SENTENCES;
type TimeInstantCode = keyof typeof INSTANT_SENTENCES;
type TimeWindowCode = keyof typeof WINDOW_SENTENCES;

/** A time rule refusal: its code and, as data beside it, the instants its sentence names. */
export type TimeValidationFailure =
  | { error: TimeRuleCode }
  | { error: TimeInstantCode; at: string }
  | { error: TimeWindowCode; start: string; end: string | null };

export type TimeValidationCode = TimeValidationFailure['error'];

/**
 * Every time rule code, for the unit tests that pin the sentences and scan
 * the calendar's codes.
 * @internal
 */
export const TIME_VALIDATION_CODES: readonly string[] = [
  ...Object.keys(RULE_SENTENCES),
  ...Object.keys(INSTANT_SENTENCES),
  ...Object.keys(WINDOW_SENTENCES),
];

function isRuleCode(code: string): code is TimeRuleCode {
  return Object.hasOwn(RULE_SENTENCES, code);
}

function isInstantCode(code: string): code is TimeInstantCode {
  return Object.hasOwn(INSTANT_SENTENCES, code);
}

function isWindowCode(code: string): code is TimeWindowCode {
  return Object.hasOwn(WINDOW_SENTENCES, code);
}

/** The German sentence of a time rule refusal, with its times in Berlin wall-clock time. */
export function describeTimeValidationFailure(failure: TimeValidationFailure): string {
  if ('at' in failure) return INSTANT_SENTENCES[failure.error](failure.at);
  if ('start' in failure) return WINDOW_SENTENCES[failure.error](failure.start, failure.end);
  return RULE_SENTENCES[failure.error];
}

/**
 * The time rule refusal an action answered, read back from its fields; null
 * when the code is not a time rule or a fact its sentence names is missing.
 */
function readTimeValidationFailure(facts: FailureFacts): TimeValidationFailure | null {
  const code = facts.error;
  if (isRuleCode(code)) return { error: code };
  if (isInstantCode(code)) {
    const at = facts['at'];
    return typeof at === 'string' ? { error: code, at } : null;
  }
  if (isWindowCode(code)) {
    const start = facts['start'];
    const end = facts['end'];
    if (typeof start !== 'string' || (typeof end !== 'string' && end !== null)) return null;
    return { error: code, start, end };
  }
  return null;
}

const timeValidationSentence: FailureSentence = (facts) => {
  const failure = readTimeValidationFailure(facts);
  return failure ? describeTimeValidationFailure(failure) : null;
};

/** The time rule sentences as an area map for `describeFailure` (lib/action-messages.ts). */
export const TIME_VALIDATION_MESSAGES: Readonly<Partial<Record<string, FailureSentence>>> =
  Object.fromEntries(TIME_VALIDATION_CODES.map((code) => [code, timeValidationSentence]));
