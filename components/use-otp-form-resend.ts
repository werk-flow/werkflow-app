'use client';

import { useState } from 'react';

import { usePendingTask } from '@/hooks/use-server-action';
import { useWallClockTick } from '@/hooks/use-wall-clock-tick';
import type { createSupabaseBrowserClient } from '@/lib/supabase/client';

const RESEND_COOLDOWN_MS = 60_000;

/** The resend cooldown of the OTP form and the resend request itself. */
export function useOtpResend({
  supabase,
  email,
  setFormError,
}: {
  supabase: ReturnType<typeof createSupabaseBrowserClient>;
  email: string;
  setFormError: (message: string | null) => void;
}): {
  resendCooldown: number;
  isResending: boolean;
  handleResend: () => Promise<void>;
} {
  const { run: runResend, isPending: isResending } = usePendingTask();
  const [resendAvailableAt, setResendAvailableAt] = useState(() => Date.now() + RESEND_COOLDOWN_MS);
  // Derived from the wall clock, so a tab whose timers the browser throttled still shows the true wait.
  // The tick stops at the deadline; until it restarts after a resend, the stale instant would read
  // more than the full wait, so the count never exceeds it.
  const now = useWallClockTick(1000, true, resendAvailableAt);
  const resendCooldown = Math.min(
    RESEND_COOLDOWN_MS / 1000,
    Math.max(0, Math.ceil((resendAvailableAt - now) / 1000)),
  );

  async function handleResend() {
    if (resendCooldown > 0 || isResending) {
      return;
    }

    setFormError(null);

    await runResend(async () => {
      try {
        // Use resend method to resend the signup confirmation email (OTP)
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email,
        });

        if (error) {
          setFormError('Der Code konnte nicht erneut gesendet werden. Bitte versuche es später erneut.');
        } else {
          setResendAvailableAt(Date.now() + RESEND_COOLDOWN_MS);
        }
      } catch {
        setFormError('Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es später erneut.');
      }
    });
  }

  return { resendCooldown, isResending, handleResend };
}
