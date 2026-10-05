'use client';

import { useEffect, useState } from 'react';

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
  const [isResending, setIsResending] = useState(false);
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
    setIsResending(true);

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
    } finally {
      setIsResending(false);
    }
  }

  return { resendCooldown, isResending, handleResend };
}
