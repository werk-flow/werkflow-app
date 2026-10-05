'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Reports a form's running request to the dialog that hosts it, so the
 * dialog's `pending` refuses the user's dismissal until the request answers.
 * The report is released when the request ends or the form unmounts (a closed
 * dialog, another tab).
 */
export function useReportPending(
  pending: boolean,
  onPendingChange: ((pending: boolean) => void) | undefined,
): void {
  useEffect(() => {
    if (!pending) return;
    onPendingChange?.(true);
    return () => onPendingChange?.(false);
  }, [pending, onPendingChange]);
}

/** A form's own pending state, reported to its hosting dialog like `useReportPending`. */
export function useReportedPendingState(
  onPendingChange: ((pending: boolean) => void) | undefined,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [pending, setPending] = useState(false);
  useReportPending(pending, onPendingChange);
  return [pending, setPending];
}
