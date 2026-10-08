'use client';

import { useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useBanner } from '@/components/ui/banner';
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';

import { clearEmailChangeChallengeBeforeSignOut } from '@/lib/settings/email-change-actions';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { logError } from '@/lib/logging';
import { clockOutBeforeSignOut } from '@/lib/time-tracking/actions';

/**
 * Best-effort step before every sign-out: a pending email-change challenge
 * must not outlive the session. A failure must not block the sign-out, so it
 * only reaches the log.
 */
export async function clearEmailChangeChallengeQuietly(): Promise<void> {
  try {
    const cleanupResult = await clearEmailChangeChallengeBeforeSignOut();
    if (!cleanupResult.success) logError('auth.sign_out.email_change_cleanup_failed');
  } catch (error) {
    // best-effort: the challenge expires on its own, and a failed cleanup must not keep the user signed in.
    logError('auth.sign_out.email_change_cleanup_failed', error);
  }
}

/** Ends the user's open working sessions; false when one may still be running. */
async function endOpenWorkBeforeSignOut(): Promise<boolean> {
  try {
    const result = await clockOutBeforeSignOut();
    if (result.success) return true;
    logError('auth.sign_out.clock_out_failed', { code: result.error });
    return false;
  } catch (error) {
    logError('auth.sign_out.clock_out_failed', error);
    return false;
  }
}

export function useSignOut() {
  const router = useRouter();
  const { showBanner } = useBanner();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { run: runSignOut, isPending: isSigningOut } = usePendingTask();
  // A failed clock-out stops the first sign-out with a warning; the next click signs out anyway.
  const clockOutWarningShownRef = useRef(false);

  const signOut = async () => {
    if (isSigningOut) {
      return;
    }

    await runSignOut(async () => {
      try {
        const clockedOut = await endOpenWorkBeforeSignOut();
        if (clockedOut) clockOutWarningShownRef.current = false;
        if (!clockedOut && !clockOutWarningShownRef.current) {
          clockOutWarningShownRef.current = true;
          showBanner({
            variant: 'error',
            message:
              'Wir konnten dich vor der Abmeldung nicht ausstempeln. Stemple dich selbst aus oder klicke erneut auf „Abmelden“, um dich trotzdem abzumelden.',
          });
          return;
        }

        await clearEmailChangeChallengeQuietly();

        // Explicit global: the menu sign-out currently ends the user's sessions
        // on every device (pre-existing behavior, made explicit by the scope
        // lint from decision 0005).
        const { error } = await supabase.auth.signOut({ scope: 'global' });
        if (error) throw error;
        const response = await fetch('/auth/callback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            event: 'SIGNED_OUT',
            session: null,
          }),
        });
        if (!response.ok) throw new Error('Server session cleanup failed.');

        router.replace('/login');
        router.refresh();
        // The sign-out stays pending until the login page replaces this one.
        await untilPageLeaves();
      } catch {
        // The next attempt starts over, including the clock-out warning.
        clockOutWarningShownRef.current = false;
        showBanner({
          variant: 'error',
          message: 'Die Abmeldung konnte nicht vollständig abgeschlossen werden. Bitte versuche es erneut.',
        });
      }
    });
  };

  return {
    isSigningOut,
    signOut,
  };
}
