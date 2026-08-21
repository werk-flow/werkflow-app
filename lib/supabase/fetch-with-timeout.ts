/**
 * Bounded fetch for the server-side Supabase clients.
 *
 * Without a timeout, a stalled connection hangs the awaiting server action
 * forever: the user stares at a disabled button ("Wird gelöscht...") and the
 * harness burns its full test budget. Evidenced 2026-08-21 across customer
 * deletion, assignment saves, and harness logins (see the M2 entry in
 * docs/plans/golden-gate-log.md). With this bound, a stalled request rejects
 * and the callers' error handling surfaces a visible failure instead.
 *
 * 30 s is deliberately generous: the slowest legitimate calls (auth admin
 * pagination, edge-function invocations waiting on Resend) finish well under
 * it, while a genuinely dead socket no longer hangs anything.
 */
const SUPABASE_FETCH_TIMEOUT_MS = 30_000;

function boundedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;

  return fetch(input, { ...init, signal });
}

// Cast: Node's `typeof fetch` additionally declares the `preconnect` static,
// which the Supabase clients never call.
export const fetchWithTimeout = boundedFetch as typeof fetch;
