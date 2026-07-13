'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { clearEmailChangeChallengeBeforeSignOut } from '@/lib/settings/email-change-actions';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { clockOutBeforeSignOut } from '@/lib/time-tracking/actions';

export function useSignOut() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const signOut = async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);

    try {
      // Best-effort: ensure any open working session is clocked out before sign-out.
      try {
        await clockOutBeforeSignOut();
      } catch {
        console.error('Failed to clock out before sign out.');
      }

      try {
        const cleanupResult = await clearEmailChangeChallengeBeforeSignOut();
        if (!cleanupResult.success) {
          console.error('Failed to clear email change challenge before sign out.');
        }
      } catch {
        console.error('Failed to clear email change challenge before sign out.');
      }

      await supabase.auth.signOut();
      await fetch('/auth/callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: 'SIGNED_OUT',
          session: null,
        }),
      });

      router.replace('/login');
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  };

  return {
    isSigningOut,
    signOut,
  };
}
