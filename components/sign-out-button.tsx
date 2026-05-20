'use client';

import { Button } from '@/components/ui/button';
import { useSignOut } from '@/hooks/use-sign-out';

export function SignOutButton() {
  const { isSigningOut, signOut } = useSignOut();

  return (
    <Button
      onClick={signOut}
      disabled={isSigningOut}
      size="sm"
      variant="outline"
      aria-label="Abmelden"
    >
      {isSigningOut ? 'Abmeldung läuft...' : 'Abmelden'}
    </Button>
  );
}
