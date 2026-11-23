import type { ShiftPhase } from '@/lib/on-call/rules';
import type { OnCallHistoryKind, OnCallMember } from '@/lib/on-call/types';
import { formatBerlin } from '@/lib/utils';

// The German words of Bereitschaft, shared by the office list, its dialogs
// and the dashboard card.

/** The sentence of each refusal of the on-call writes. */
export const ON_CALL_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  on_call_shift_changed:
    'Jemand hat diese Bereitschaft gerade geändert. Schließe den Dialog und versuche es mit dem neuen Stand erneut.',
  on_call_shift_over: 'Diese Bereitschaft ist schon vorbei oder abgesagt.',
  on_call_shift_started: 'Die Bereitschaft läuft schon, deshalb bleibt der Beginn, wie er war.',
  on_call_shift_not_running: 'Übergeben kannst du nur eine Bereitschaft, die gerade läuft.',
  on_call_shift_invalid_range: 'Das Ende muss nach dem Beginn liegen, höchstens 31 Tage später.',
  on_call_shift_in_past: 'Das Ende liegt schon in der Vergangenheit.',
  on_call_member_required: 'Bitte wähle mindestens eine Person.',
  on_call_member_invalid: 'Eine gewählte Person gehört nicht mehr zum Team.',
  on_call_shift_not_found: 'Diese Bereitschaft gibt es nicht mehr.',
  on_call_shift_exists: 'Diese Bereitschaft gibt es schon. Schließe den Dialog und versuche es erneut.',
};

export const PHASE_BADGES: Readonly<
  Record<ShiftPhase, { label: string; variant: 'success' | 'secondary' | 'outline' }>
> = {
  running: { label: 'Läuft', variant: 'success' },
  planned: { label: 'Geplant', variant: 'outline' },
  over: { label: 'Vorbei', variant: 'secondary' },
  cancelled: { label: 'Abgesagt', variant: 'secondary' },
};

export const HISTORY_KIND_LABELS: Readonly<Record<OnCallHistoryKind, string>> = {
  planned: 'Geplant',
  changed: 'Geändert',
  ended: 'Beendet',
  cancelled: 'Abgesagt',
  handed_over: 'Übergeben',
  taken_over: 'Übernommen',
};

/** „Fr., 20.11.2026, 16:00 – Mo., 23.11.2026, 07:00“. */
export function shiftSpanLabel(shift: { startsAt: string; endsAt: string }): string {
  return `${formatBerlin(shift.startsAt, 'weekdayDateTime')} – ${formatBerlin(shift.endsAt, 'weekdayDateTime')}`;
}

export function memberNames(members: readonly OnCallMember[]): string {
  return members.map((member) => member.name).join(', ');
}

/** A phone number as a `tel:` link target: its digits and plus signs. */
export function phoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
