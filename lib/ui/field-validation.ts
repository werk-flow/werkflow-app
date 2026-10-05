/**
 * Submit-time validation (design canon, "Forms and Enter"): the submit button
 * stays enabled, and a submit with missing input marks the fields through
 * `Field`'s `error` and moves focus to the first one. `errors` is keyed by
 * control id (`Field htmlFor`) in visual order; an `undefined` entry is a
 * valid field. Returns true when the form must not submit.
 */
export function focusFirstInvalidField(errors: Readonly<Record<string, string | undefined>>): boolean {
  const firstInvalidId = Object.entries(errors).find(([, message]) => message)?.[0];
  if (!firstInvalidId) return false;
  document.getElementById(firstInvalidId)?.focus();
  return true;
}

export const REASON_MIN_3_MESSAGE = 'Bitte gib eine Begründung mit mindestens 3 Zeichen an.';
export const REASON_MIN_8_MESSAGE = 'Bitte gib eine Begründung mit mindestens 8 Zeichen an.';
