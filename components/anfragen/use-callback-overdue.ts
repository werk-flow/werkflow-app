'use client';

import { useMountedWallClockTick } from '@/hooks/use-wall-clock-tick';
import { isCallbackOverdue, type ClientRequest } from '@/lib/requests/types';

type CallbackFacts = Pick<ClientRequest, 'status' | 'callbackDueAt'>;

/**
 * Whether a shown request's promised callback has passed. While one of them
 * is open with a callback, the shared minute tick reads it again, so
 * „Rückruf überfällig“ appears when the deadline passes without a database
 * event. While hydrating, the reading of the server render holds.
 */
export function useCallbackOverdue(
  requests: readonly CallbackFacts[],
): (request: CallbackFacts, readOverdue: boolean) => boolean {
  const hasPromise = requests.some(
    (request) =>
      (request.status === 'offen' || request.status === 'in_klaerung') && request.callbackDueAt !== null,
  );
  const now = useMountedWallClockTick(60_000, hasPromise);
  return (request, readOverdue) => (now === null ? readOverdue : isCallbackOverdue(request, new Date(now)));
}
