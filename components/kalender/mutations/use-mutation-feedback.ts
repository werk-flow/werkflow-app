'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useCalendarAnnounce } from '../surface/live-region';
import type { UseCalendarMutationsOptions } from './use-calendar-mutations';

/**
 * The feedback state the calendar's optimistic owner shares across its
 * operations: the scope guard, progress banners disposed on unmount, the
 * reachable Undo of the latest success, and the revision that keeps an
 * earlier response from replacing a later gesture's feedback.
 */
export function useMutationFeedback({
  showBanner,
  isScopeActive: isCallerScopeActive,
}: Pick<UseCalendarMutationsOptions, 'showBanner' | 'isScopeActive'>) {
  const mountedRef = useRef(true);
  const isScopeActive = useCallback(() => mountedRef.current && isCallerScopeActive(), [isCallerScopeActive]);
  const announce = useCalendarAnnounce();
  const pendingFeedbackRef = useRef(new Set<() => void>());
  useEffect(() => {
    mountedRef.current = true;
    // The Set is created once and never replaced; the cleanup disposes its entries.
    const pendingFeedback = pendingFeedbackRef.current;
    return () => {
      mountedRef.current = false;
      for (const dispose of pendingFeedback) dispose();
      pendingFeedback.clear();
    };
  }, []);
  const progressFeedback = useCallback(
    (message: string) => {
      const dismiss = showBanner({ variant: 'progress', message });
      const dispose = () => {
        pendingFeedbackRef.current.delete(dispose);
        dismiss();
      };
      pendingFeedbackRef.current.add(dispose);
      return dispose;
    },
    [showBanner],
  );
  const lastUndoRef = useRef<(() => void) | null>(null);
  const feedbackRevisionRef = useRef(0);
  const showFailure = useCallback(
    (message: string) => {
      // Failures remain visible even when another entry finished later. Keep that entry's Undo reachable.
      const undo = lastUndoRef.current;
      showBanner({
        variant: 'error',
        message,
        ...(undo ? { actionLabel: 'Letzte Änderung rückgängig', onAction: undo } : {}),
      });
    },
    [showBanner],
  );
  return { isScopeActive, announce, progressFeedback, lastUndoRef, feedbackRevisionRef, showFailure };
}

export type MutationFeedback = ReturnType<typeof useMutationFeedback>;
