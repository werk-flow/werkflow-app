/**
 * The failure codes that the shared guards return, whatever the area: the
 * session and organization checks, the role check, the boundary parse, the
 * closed-period refusal (`timeWriteFailure` in lib/time-tracking/closed-periods.ts),
 * a responsibility read that could not complete, and the last-resort catch. `lib/action-messages.ts` gives each one German
 * sentence, so a component never repeats them.
 */
export const SHARED_FAILURE_CODES = [
  'not_authenticated',
  'no_active_org',
  'not_a_member',
  'not_authorized',
  'invalid_input',
  'period_closed',
  'responsibility_load_failed',
  'unexpected_error',
] as const;

export type SharedFailureCode = (typeof SHARED_FAILURE_CODES)[number];

/**
 * The failure arm of every Server Action and reader result: a stable error
 * code, never a message. A failure that carries more than the code (a
 * warning's evaluation, partial data) intersects this type with its extra
 * fields instead of declaring its own `success: false` literal
 * (lib/conventions/action-failure-shape.test.ts).
 */
export type ActionFailure<Code extends string = string> = { success: false; error: Code };

/**
 * The result of a Server Action. `Data` names the fields a success carries
 * beside the discriminant, so a caller narrows on `success` before reading them.
 */
export type ActionResult<Data = object, Code extends string = string> =
  | ({ success: true } & Data)
  | ActionFailure<Code>;
