'use client';

import { useState } from 'react';

/**
 * The key every press of one attempt sends, so the server answers a retry
 * whose first answer was lost with the first result instead of writing again.
 * Renew it when the dialog opens again or the write succeeded; never after a
 * failed press, whose write may have landed.
 */
export function useAttemptKey(): { attemptKey: string; renewAttemptKey: () => void } {
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  return { attemptKey, renewAttemptKey: () => setAttemptKey(crypto.randomUUID()) };
}
