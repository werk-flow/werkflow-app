'use client';

import { useCallback, useRef } from 'react';

import { draftKey } from '@/lib/ai/chat-drafts';
import { stopTurn } from './turn-client';
import type { LiveTurn } from './use-ki-chat';

const STOP_FAILED = 'Die Antwort konnte nicht angehalten werden. Versuch es noch einmal.';

/**
 * „Antwort anhalten“: the answer holds still at once, and the server ends the
 * turn and sends its end on the turn's own stream. A stop pressed before the
 * message is saved goes once the turn has its answer (`requestStop`); one the
 * server did not take lets the answer run on and says so at its draft.
 */
export function useStop(refs: {
  liveRef: React.RefObject<LiveTurn | null>;
  leftRef: React.RefObject<boolean>;
  hostRef: React.RefObject<{ userId: string; organizationId: string }>;
  update: (change: (current: LiveTurn) => LiveTurn | null) => void;
  setError: (error: { draft: string; message: string } | null) => void;
}) {
  const { liveRef, leftRef, hostRef, update, setError } = refs;
  const stopOwnerRef = useRef<string | null>(null);
  const requestStop = useCallback(
    (turn: LiveTurn) => {
      const host = hostRef.current;
      stopOwnerRef.current = turn.commandId;
      void stopTurn({
        organizationId: host.organizationId,
        threadId: turn.threadId,
        commandId: turn.commandId,
      }).then((taken) => {
        if (taken || leftRef.current || stopOwnerRef.current !== turn.commandId) return;
        // The answer runs on: the screen shows it again, or the channel does once the turn has settled.
        if (liveRef.current?.commandId === turn.commandId)
          update((current) => ({ ...current, stoppedAt: null }));
        setError({ draft: draftKey(host.userId, host.organizationId, turn.threadId), message: STOP_FAILED });
      });
    },
    [liveRef, leftRef, stopOwnerRef, hostRef, update, setError],
  );
  const stop = useCallback(() => {
    const turn = liveRef.current;
    if (!turn || turn.stoppedAt !== null || turn.end) return;
    setError(null);
    update((current) => ({ ...current, stoppedAt: current.answer.length }));
    if (turn.started) requestStop(turn);
  }, [liveRef, update, setError, requestStop]);
  const invalidateStop = useCallback(() => {
    stopOwnerRef.current = null;
  }, []);
  return { requestStop, stop, invalidateStop };
}
