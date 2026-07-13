'use client';

import { useState, useMemo } from 'react';
import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { clearEmailChangeChallengeBeforeSignOut } from '@/lib/settings/email-change-actions';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

interface SignOutAndRedirectButtonProps {
  inviteCode: string;
  invitedEmail: string;
  isExistingUser: boolean;
}

export function SignOutAndRedirectButton({
  inviteCode,
  invitedEmail,
  isExistingUser
}: SignOutAndRedirectButtonProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isLoading, setIsLoading] = useState(false);

  const handleSignOutAndRedirect = async () => {
    setIsLoading(true);

    try {
      try {
        const cleanupResult = await clearEmailChangeChallengeBeforeSignOut();
        if (!cleanupResult.success) {
          console.error('Failed to clear email change challenge before sign out.');
        }
      } catch {
        console.error('Failed to clear email change challenge before sign out.');
      }

      // Sign out the current user
      await supabase.auth.signOut();

      // Redirect based on whether the invited user exists
      if (isExistingUser) {
        // Existing user: redirect to login page with invite code
        window.location.href = `/login?invite_code=${inviteCode}`;
      } else {
        // New user: redirect to signup page with email prefilled and invite code
        const signupUrl = invitedEmail
          ? `/signup?email=${encodeURIComponent(
              invitedEmail
            )}&invite_code=${inviteCode}`
          : `/signup?invite_code=${inviteCode}`;
        window.location.href = signupUrl;
      }
    } catch (error) {
      console.error('Error signing out:', error);
      setIsLoading(false);
    }
  };

  // Button text changes based on whether user needs to log in or sign up
  const buttonText = isExistingUser
    ? 'Abmelden & anmelden'
    : 'Abmelden & registrieren';

  return (
    <Button onClick={handleSignOutAndRedirect} disabled={isLoading}>
      <LogOut className="mr-2 size-4" />
      {isLoading ? 'Wird abgemeldet...' : buttonText}
    </Button>
  );
}
