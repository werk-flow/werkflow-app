import type { SharedFailureCode } from '@/lib/action-result';

/**
 * One German sentence per shared failure code. The `Record` over the whole
 * union makes a new shared code without a sentence fail `tsc`.
 */
export const SHARED_FAILURE_MESSAGES: Readonly<Record<SharedFailureCode, string>> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  no_active_org: 'Keine Organisation ausgewählt.',
  not_a_member: 'Du bist kein Mitglied dieser Organisation.',
  not_authorized: 'Du hast keine Berechtigung für diese Aktion.',
  invalid_input: 'Bitte prüfe deine Eingaben.',
  period_closed: 'Der Monat ist bereits abgeschlossen. Ein Admin muss die Periode zuerst wieder öffnen.',
  load_failed: 'Die Daten konnten gerade nicht geladen werden. Versuche es in einem Moment erneut.',
  responsibility_load_failed:
    'Deine Freigaberechte konnten gerade nicht geprüft werden. Versuche es in einem Moment erneut.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
};

function isSharedFailureCode(code: string): code is SharedFailureCode {
  return Object.hasOwn(SHARED_FAILURE_MESSAGES, code);
}

/** A failure as an action answers it: the code, and the facts beside it. */
export type FailureFacts = { readonly error: string } & Readonly<Record<string, unknown>>;

/**
 * An area's sentence built from the facts a failure carries beside its code;
 * null when a fact it names is missing, so the shared sentence or the
 * fallback answers instead.
 */
export type FailureSentence = (failure: FailureFacts) => string | null;

/**
 * The sentence for a failure: the area's own wording first, then the shared
 * sentence, then the caller's fallback. A component lists only the codes its
 * area owns; the shared codes reach every surface from here. Pass the whole
 * failure when an area sentence names facts beside the code.
 */
export function describeFailure(
  failure: string | FailureFacts,
  areaMessages: Readonly<Partial<Record<string, string | FailureSentence>>>,
  fallback: string,
): string {
  const facts: FailureFacts = typeof failure === 'string' ? { error: failure } : failure;
  const code = facts.error;
  const areaMessage = Object.hasOwn(areaMessages, code) ? areaMessages[code] : undefined;
  const areaSentence = typeof areaMessage === 'function' ? areaMessage(facts) : areaMessage;
  if (areaSentence !== undefined && areaSentence !== null) return areaSentence;
  if (isSharedFailureCode(code)) return SHARED_FAILURE_MESSAGES[code];
  return fallback;
}

/**
 * The sentence for a refused all-or-nothing write of several records: the
 * reason, then that nothing changed. `unexpected_error` gets no note, because
 * a transport failure can follow a committed write.
 */
export function describeBatchRefusal(code: string, message: string): string {
  return code === 'unexpected_error' ? message : `${message} Es wurde nichts geändert.`;
}
