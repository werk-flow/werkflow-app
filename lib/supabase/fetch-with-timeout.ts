/**
 * Bounded fetch for the server-side Supabase clients.
 *
 * Without a timeout, a stalled connection hangs the awaiting server action
 * forever: the user stares at a disabled button ("Wird gelöscht...") and the
 * harness burns its full test budget. With this bound, a stalled request
 * rejects and the callers' error handling surfaces a visible failure instead.
 *
 * 30 s is deliberately generous: the slowest legitimate calls (auth admin
 * pagination, edge-function invocations waiting on Resend) finish well under
 * it, while a genuinely dead socket no longer hangs anything.
 */
import { getReadRequestPriority, getReadRequestSignal } from '@/lib/data/read-request-cache';
import { createRequestScheduler } from './request-scheduler';

const SUPABASE_FETCH_TIMEOUT_MS = 30_000;
const scheduleRequest = createRequestScheduler();

function boundedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS);
  const signals = [timeoutSignal];
  if (init?.signal) signals.push(init.signal);
  if (input instanceof Request) signals.push(input.signal);
  const requestSignal = getReadRequestSignal();
  const url = new URL(input instanceof Request ? input.url : input.toString());
  // A discarded view cancels its data reads, not authentication/token rotation.
  // auth-js logs rejected fetches as network failures, including expected navigation aborts.
  if (requestSignal && !url.pathname.startsWith('/auth/v1/')) signals.push(requestSignal);
  const signal = AbortSignal.any(signals);

  return scheduleRequest(getReadRequestPriority(), signal, () => fetch(input, { ...init, signal }));
}

// Cast: Node's `typeof fetch` additionally declares the `preconnect` static,
// which the Supabase clients never call.
export const fetchWithTimeout = boundedFetch as typeof fetch;
