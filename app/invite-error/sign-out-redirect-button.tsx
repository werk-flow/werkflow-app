'use client';

import { useState, useMemo } from 'react';
import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';
import { clearEmailChangeChallengeQuietly } from '@/hooks/use-sign-out';
import { loadDocument } from '@/lib/navigation/document-load';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

interface SignOutAndRedirectButtonProps {
  /** The validated invite code, or null when it is no longer known. */
  inviteCode: string | null;
}

/**
 * Signs out and opens the login page with the invite. The login page links
 * to the sign-up with the same invite, so the page never has to know whether
 * the invited address already has an account.
 */
export function SignOutAndRedirectButton({ inviteCode }: SignOutAndRedirectButtonProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { run: runSignOut, isPending: isLoading } = usePendingTask();
  const [error, setError] = useState<string | null>(null);

  const handleSignOutAndRedirect = async () => {
    setError(null);

    await runSignOut(async () => {
      try {
        await clearEmailChangeChallengeQuietly();

        // Sign out the current user (explicit global preserves the pre-existing
        // default behavior of this flow).
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
        if (signOutError) throw signOutError;

        // A full load so the next page starts without the old session in client state.
        loadDocument(inviteCode === null ? '/login' : `/login?invite_code=${encodeURIComponent(inviteCode)}`);
        return untilPageLeaves();
      } catch {
        setError('Die Abmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut.');
      }
    });
  };

  return (
    <div className="grid gap-2">
      <Button onClick={handleSignOutAndRedirect} disabled={isLoading}>
        <LogOut className="mr-2 size-4" />
        {isLoading ? 'Wird abgemeldet…' : 'Abmelden & anmelden'}
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
