'use client';

import { useEffect } from 'react';

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
