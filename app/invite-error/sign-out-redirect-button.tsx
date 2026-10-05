'use client';

import { useState, useMemo } from 'react';
import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { clearEmailChangeChallengeQuietly } from '@/hooks/use-sign-out';
import { loadDocument } from '@/lib/navigation/document-load';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

interface SignOutAndRedirectButtonProps {
  inviteCode: string;
  invitedEmail: string;
  isExistingUser: boolean;
}

export function SignOutAndRedirectButton({
  inviteCode,
  invitedEmail,
  isExistingUser,
}: SignOutAndRedirectButtonProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignOutAndRedirect = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await clearEmailChangeChallengeQuietly();

      // Sign out the current user (explicit global preserves the pre-existing
      // default behavior of this flow).
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
      if (signOutError) throw signOutError;

      // A full load so the next page starts without the old session in client state.
      // The code comes from the URL unvalidated; encoding keeps it one parameter.
      const encodedInviteCode = encodeURIComponent(inviteCode);
      if (isExistingUser) {
        loadDocument(`/login?invite_code=${encodedInviteCode}`);
      } else {
        const signupUrl = invitedEmail
          ? `/signup?email=${encodeURIComponent(invitedEmail)}&invite_code=${encodedInviteCode}`
          : `/signup?invite_code=${encodedInviteCode}`;
        loadDocument(signupUrl);
      }
    } catch {
      setError('Die Abmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut.');
      setIsLoading(false);
    }
  };

  // Button text changes based on whether user needs to log in or sign up
  const buttonText = isExistingUser ? 'Abmelden & anmelden' : 'Abmelden & registrieren';

  return (
    <div className="grid gap-2">
      <Button onClick={handleSignOutAndRedirect} disabled={isLoading}>
        <LogOut className="mr-2 size-4" />
        {isLoading ? 'Wird abgemeldet…' : buttonText}
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
