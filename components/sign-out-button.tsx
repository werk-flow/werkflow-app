'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
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



