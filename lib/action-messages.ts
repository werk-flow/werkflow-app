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
  responsibility_load_failed:
    'Deine Freigaberechte konnten gerade nicht geprüft werden. Versuche es in einem Moment erneut.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
};

function isSharedFailureCode(code: string): code is SharedFailureCode {
  return Object.hasOwn(SHARED_FAILURE_MESSAGES, code);
}

/**
 * The sentence for a failure code: the area's own wording first, then the
 * shared sentence, then the caller's fallback. A component lists only the
 * codes its area owns; the shared codes reach every surface from here.
 */
export function describeFailure(
  code: string,
  areaMessages: Readonly<Partial<Record<string, string>>>,
  fallback: string,
): string {
  const areaMessage = Object.hasOwn(areaMessages, code) ? areaMessages[code] : undefined;
  if (areaMessage !== undefined) return areaMessage;
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
