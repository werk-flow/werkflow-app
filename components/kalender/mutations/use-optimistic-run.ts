'use client';

import { useCallback } from 'react';
import { calendarActionResult } from '@/lib/calendar/action-result';
import {
  calendarRefusalMessage,
  calendarUndoFailureMessage,
  type CalendarRefusalContext,
} from '@/lib/calendar/messages';
import type { MutationFeedback } from './use-mutation-feedback';
import type { UseCalendarMutationsOptions } from './use-calendar-mutations';
import type { ActionResult } from '@/lib/action-result';

export type OptimisticOperation = {
  apply: () => void;
  revert: () => void;
  execute: () => Promise<ActionResult>;
  successMessage: string;
  /** Spoken to assistive technology after success; defaults to the banner text. */
  announce?: string | undefined;
  /** Facts the refusal sentence may name. */
  context?: CalendarRefusalContext | undefined;
  /** The inverse server call; omitted when the change is not reversible. */
  undo?: (() => Promise<ActionResult>) | undefined;
};

type RunScope = Pick<UseCalendarMutationsOptions, 'beginMutation' | 'showBanner' | 'silentRefresh'> &
  Pick<
    MutationFeedback,
    'progressFeedback' | 'announce' | 'isScopeActive' | 'showFailure' | 'lastUndoRef' | 'feedbackRevisionRef'
  >;

/** A refused operation: back to the old state, then the message layer's sentence or the plain notice. */
function reportRefusal(
  operation: OptimisticOperation,
  error: string,
  feedbackRevision: number,
  { announce, showBanner, showFailure, feedbackRevisionRef }: RunScope,
): void {
  operation.revert();
  const message = calendarRefusalMessage(error, operation.context);
  if (message) {
    showFailure(message);
    announce(message);
  } else if (feedbackRevision === feedbackRevisionRef.current)
    showBanner({ variant: 'info', message: 'Änderung abgebrochen.' });
}

/** A saved operation's banner, with Undo when the operation has an inverse call. */
function confirmOperation(operation: OptimisticOperation, scope: RunScope): void {
  const { beginMutation, showBanner, silentRefresh, progressFeedback } = scope;
  const { announce, isScopeActive, showFailure, lastUndoRef, feedbackRevisionRef } = scope;
  const undo = operation.undo;
  if (!undo) {
    showBanner({ variant: 'success', message: operation.successMessage });
    return;
  }
  const runUndo = async () => {
    if (!isScopeActive() || lastUndoRef.current !== undoCallback) return;
    lastUndoRef.current = null;
    const releaseUndo = beginMutation();
    const undoRevision = ++feedbackRevisionRef.current;
    let disposeUndoProgress = () => {};
    try {
      operation.revert();
      disposeUndoProgress = progressFeedback('Änderung wird rückgängig gemacht …');
      const undoResult = await calendarActionResult(undo);
      if (!isScopeActive()) return;
      if (!undoResult.success) {
        const message = calendarUndoFailureMessage(undoResult.error, operation.context);
        showFailure(message);
        announce(message);
        silentRefresh();
        return;
      }
      announce('Rückgängig gemacht.');
      if (undoRevision === feedbackRevisionRef.current)
        showBanner({ variant: 'success', message: 'Rückgängig gemacht.' });
    } finally {
      disposeUndoProgress();
      releaseUndo();
    }
  };
  const undoCallback = () => {
    void runUndo();
  };
  lastUndoRef.current = undoCallback;
  showBanner({
    variant: 'success',
    message: operation.successMessage,
    actionLabel: 'Rückgängig',
    onAction: undoCallback,
  });
}

/**
 * `run`: take mutation ownership, apply the intended result, call the action,
 * roll back with the message layer's sentence on failure, and on success show
 * the banner with Undo, which reverses through the same ownership. The
 * release runs in `finally` on every path.
 */
export function useOptimisticRun({
  beginMutation,
  showBanner,
  silentRefresh,
  feedback,
}: Pick<UseCalendarMutationsOptions, 'beginMutation' | 'showBanner' | 'silentRefresh'> & {
  feedback: MutationFeedback;
}): (operation: OptimisticOperation) => Promise<boolean> {
  const { progressFeedback, announce, isScopeActive, showFailure, lastUndoRef, feedbackRevisionRef } =
    feedback;
  return useCallback(
    async (operation: OptimisticOperation): Promise<boolean> => {
      const scope: RunScope = {
        beginMutation,
        showBanner,
        silentRefresh,
        progressFeedback,
        announce,
        isScopeActive,
        showFailure,
        lastUndoRef,
        feedbackRevisionRef,
      };
      const release = beginMutation();
      const feedbackRevision = ++feedbackRevisionRef.current;
      lastUndoRef.current = null;
      let disposeProgress = () => {};
      try {
        operation.apply();
        disposeProgress = progressFeedback('Änderung wird gespeichert …');
        const result = await calendarActionResult(operation.execute);
        if (!isScopeActive()) return false;
        if (!result.success) {
          reportRefusal(operation, result.error, feedbackRevision, scope);
          return false;
        }
        announce(operation.announce ?? operation.successMessage);
        // An earlier response must not replace the feedback or Undo of a later gesture.
        if (feedbackRevision !== feedbackRevisionRef.current) return true;
        confirmOperation(operation, scope);
        return true;
      } finally {
        disposeProgress();
        release();
      }
    },
    // The two refs are stable objects, so listing them changes no identity.
    [
      progressFeedback,
      announce,
      beginMutation,
      isScopeActive,
      showBanner,
      showFailure,
      silentRefresh,
      lastUndoRef,
      feedbackRevisionRef,
    ],
  );
}
