'use client';

import { useEffect, useState } from 'react';

import { usePendingTask } from '@/hooks/use-server-action';
import type { createSupabaseBrowserClient } from '@/lib/supabase/client';

const RESEND_COOLDOWN_SECONDS = 60;

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
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (resendCooldown <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setResendCooldown((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [resendCooldown]);

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
          setResendCooldown(RESEND_COOLDOWN_SECONDS);
        }
      } catch {
        setFormError('Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es später erneut.');
      }
    });
  }

  return { resendCooldown, isResending, handleResend };
}
