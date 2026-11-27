'use client';

import { useState } from 'react';

/** The attempt key of what the office last pressed, until the server answers it. */
export type PayloadAttemptKey = {
  /** The key for `payload`: the pressed one's again when it is unchanged, else a new one. */
  keyFor: (payload: string) => string;
  /** The server answered: the next press is a new attempt. */
  settle: () => void;
};

/**
 * One retry key per payload, kept by the component that holds the form: an
 * unchanged press after a lost answer replays the same attempt in the
 * database instead of writing twice, and changed values are a new attempt.
 */
export function usePayloadAttemptKey(): PayloadAttemptKey {
  const [pressed, setPressed] = useState<{ payload: string; key: string } | null>(null);
  return {
    keyFor: (payload) => {
      if (pressed?.payload === payload) return pressed.key;
      const key = crypto.randomUUID();
      setPressed({ payload, key });
      return key;
    },
    settle: () => setPressed(null),
  };
}
