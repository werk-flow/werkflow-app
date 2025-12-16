'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { clockOutBeforeSignOut } from '@/lib/time-tracking/actions';

export function SignOutButton() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    // Best-effort: ensure any open working session is clocked out before sign-out.
    // Ignore errors and proceed with sign-out regardless.
    try {
      await clockOutBeforeSignOut();
    } catch (e) {
      console.error('Failed to clock out before sign out:', e);
    }
    await supabase.auth.signOut();
    await fetch('/auth/callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event: 'SIGNED_OUT',
        session: null
      })
    });
    router.replace('/login');
    router.refresh();
  };

  return (
    <Button
      onClick={handleSignOut}
      disabled={isSigningOut}
      size="sm"
      variant="outline"
      aria-label="Abmelden"
    >
      {isSigningOut ? 'Abmeldung läuft...' : 'Abmelden'}
    </Button>
  );
}
