import { formatBerlin, formatBerlinDateTime } from '@/lib/utils';

import { ACCESS_STATE_LABELS, EMPLOYMENT_LIFECYCLE_LABELS } from './lifecycle';
import { ACCESS_STEP_LABELS, EMPLOYMENT_STEP_LABELS } from './lifecycle-steps';

// What a Verlauf entry of an access or employment transition says: the step,
// the state before and after, when a planned step takes effect, and the
// reason. The transition functions store these facts in the event payload
// (supabase/migrations/20260902042103_add_p1_24_people_lifecycle_rpcs.sql),
// so older entries read the same way. A fact the payload lacks is left out.

export type HistoryLine = { label: string; text: string };

/** Access steps that take effect at a chosen later instant. */
const SCHEDULED_ACCESS_STEPS: ReadonlySet<string> = new Set(['schedule_activation', 'schedule_suspension']);

function labelFor(labels: Readonly<Record<string, string>>, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const entry = Object.entries(labels).find(([key]) => key === value);
  return entry ? entry[1] : null;
}

function stateChange(labels: Readonly<Record<string, string>>, from: unknown, to: unknown): string | null {
  const before = labelFor(labels, from);
  const after = labelFor(labels, to);
  if (!after) return null;
  return before && before !== after ? `${before} → ${after}` : after;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** A date or instant from the payload that parses; a malformed one is left out, never formatted. */
function parsableDate(value: unknown): string | null {
  const text = textOf(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

function effectiveText(eventType: string, payload: Readonly<Record<string, unknown>>): string | null {
  if (payload.transitionKind === 'cancel_scheduled') return null;
  if (eventType === 'employment_transition') {
    const day = parsableDate(payload.effectiveOn);
    return day ? formatBerlin(day, 'numericDate') : null;
  }
  const instant = parsableDate(payload.effectiveAt);
  return instant && SCHEDULED_ACCESS_STEPS.has(String(payload.transitionKind))
    ? formatBerlinDateTime(instant)
    : null;
}

/** The lines of an access or employment transition entry; none for any other event. */
export function lifecycleTransitionLines(event: {
  eventType: string;
  eventPayload: Readonly<Record<string, unknown>>;
}): HistoryLine[] {
  const { eventType, eventPayload: payload } = event;
  const isAccess = eventType === 'access_transition';
  if (!isAccess && eventType !== 'employment_transition') return [];
  const facts: Array<[string, string | null]> = [
    ['Übergang', labelFor(isAccess ? ACCESS_STEP_LABELS : EMPLOYMENT_STEP_LABELS, payload.transitionKind)],
    [
      isAccess ? 'Zugang' : 'Beschäftigung',
      stateChange(
        isAccess ? ACCESS_STATE_LABELS : EMPLOYMENT_LIFECYCLE_LABELS,
        payload.fromState,
        payload.toState,
      ),
    ],
    ['Wirksam ab', effectiveText(eventType, payload)],
    ['Grund', textOf(payload.reason)],
  ];
  return facts.flatMap(([label, text]) => (text ? [{ label, text }] : []));
}
