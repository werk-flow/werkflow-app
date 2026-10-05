'use client';

import { useMemo } from 'react';
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
    logError('auth.sign_out.email_change_cleanup_failed', error);
  }
}

export function useSignOut() {
  const router = useRouter();
  const { showBanner } = useBanner();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { run: runSignOut, isPending: isSigningOut } = usePendingTask();

  const signOut = async () => {
    if (isSigningOut) {
      return;
    }

    await runSignOut(async () => {
      try {
        // Best-effort: ensure any open working session is clocked out before sign-out.
        try {
          await clockOutBeforeSignOut();
        } catch (error) {
          logError('auth.sign_out.clock_out_failed', error);
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
